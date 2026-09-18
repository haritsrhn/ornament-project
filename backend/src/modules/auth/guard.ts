/**
 * Guard sesi & izin untuk `/v1/admin/*` (ADR K7, kontrak §2.4 dan §3).
 *
 * ── Cara rute menyatakan izinnya ─────────────────────────────────────────────
 * Setiap rute admin **wajib** menyatakan aksesnya lewat `config.adminAccess`:
 *
 * ```ts
 * app.get('/admin/users', { config: { adminAccess: adminPermission('user.manage') } }, handler);
 * app.get('/admin/auth/me', { config: { adminAccess: adminSession() } }, handler);
 * app.post('/admin/auth/login', { config: { adminAccess: adminPublic('login') } }, handler);
 * ```
 *
 * Hook `onRoute` di bawah membaca penanda itu dan **memasang sendiri** hook
 * `onRequest` yang sesuai (`requireSession`, lalu `requirePermission`). Jadi:
 *
 * 1. Rute admin yang lupa menyatakan akses **gagal saat registrasi** (server
 *    tidak start, tes berkas mana pun gagal) — bukan diam-diam terbuka. Ini
 *    pengaman utama untuk modul Tahap 4+; tes `test/unit/admin-access.test.ts`
 *    menyisir ulang daftar rute sebagai jaring kedua.
 * 2. Tidak ada rute yang bisa "punya izin tapi lupa `requireSession`": kedua
 *    hook selalu dipasang bersamaan oleh satu tempat.
 *
 * ── Urutan pemeriksaan (kontrak §1.10) ───────────────────────────────────────
 * `Origin` (onRequest, `plugins/admin-origin.ts`) → sesi `401` → izin `403` →
 * validasi Zod `400`. Guard dipasang di **`onRequest`**, bukan `preHandler`,
 * justru supaya ia berjalan sebelum body di-parse dan divalidasi: pemanggil
 * tanpa hak tidak pernah mendapat bocoran detail validasi.
 */

import {
  rolesWithPermission,
  roleHasPermission,
  type Permission,
  type UserRole,
} from '@ornament/shared';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteOptions,
  onRequestAsyncHookHandler,
  onRequestHookHandler,
} from 'fastify';

import { forbidden, unauthenticated } from '../../lib/errors.js';
import { isAdminPath } from '../../plugins/admin-origin.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.js';
import { resolveSession, touchSession, type AuthSession } from './session.js';

/** Penanda akses sebuah rute admin. */
export type AdminAccess =
  /** Sengaja tanpa sesi (login, logout, verifikasi/terima undangan). */
  | { readonly kind: 'public'; readonly reason: string }
  /** Butuh sesi; semua peran boleh (mis. `GET /admin/auth/me`). */
  | { readonly kind: 'session' }
  /** Butuh sesi **dan** izin dari matriks kontrak §3. */
  | { readonly kind: 'permission'; readonly permission: Permission };

/** Rute admin tanpa sesi. `reason` wajib supaya pilihannya terbaca di review. */
export const adminPublic = (reason: string): AdminAccess => ({ kind: 'public', reason });

export const adminSession = (): AdminAccess => ({ kind: 'session' });

export const adminPermission = (permission: Permission): AdminAccess => ({
  kind: 'permission',
  permission,
});

declare module 'fastify' {
  interface FastifyRequest {
    /** Sesi aktif, diisi `requireSession`. `null` bila belum/tidak terautentikasi. */
    authSession: AuthSession | null;
  }

  interface FastifyContextConfig {
    /** Wajib pada setiap rute `/v1/admin/*`; lihat dokumentasi modul ini. */
    adminAccess?: AdminAccess;
  }

  interface FastifyInstance {
    /** onRequest: memuat sesi dari cookie atau menolak `401 UNAUTHENTICATED`. */
    requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * onRequest tambahan: menolak `403 FORBIDDEN` bila peran sesi tidak ada di
     * daftar. Dipakai untuk aturan yang tidak diungkapkan sebagai `Permission`.
     */
    requireRole: (
      ...roles: readonly UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * onRequest tambahan: menolak `403 FORBIDDEN` bila peran sesi tidak memiliki
     * izin (matriks kontrak §3). Biasanya tidak dipanggil langsung — pakai
     * `config.adminAccess = adminPermission(...)`.
     */
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Sesi yang sudah divalidasi. Melempar bila dipanggil di rute tanpa
 * `requireSession` — itu bug rute, bukan kondisi runtime.
 */
export function currentSession(request: FastifyRequest): AuthSession {
  if (request.authSession === null) {
    throw new Error('rute ini memakai currentSession() tanpa penanda adminAccess bersesi');
  }
  return request.authSession;
}

/** Kesalahan konfigurasi rute; dilempar saat registrasi, bukan saat request. */
export class MissingAdminAccessError extends Error {
  constructor(method: string, url: string) {
    super(
      `Rute admin ${method} ${url} tidak menyatakan config.adminAccess. ` +
        'Pakai adminPermission("…"), adminSession(), atau adminPublic("alasan").',
    );
    this.name = 'MissingAdminAccessError';
  }
}

/** Hook `onRequest` rute, sinkron maupun async. */
type AnyOnRequestHook = onRequestHookHandler | onRequestAsyncHookHandler;

function asHookArray(hook: RouteOptions['onRequest']): AnyOnRequestHook[] {
  if (hook === undefined) return [];
  return Array.isArray(hook) ? [...hook] : [hook];
}

export function registerAuthGuard(app: FastifyInstance): void {
  app.decorateRequest('authSession', null);

  app.decorate('requireSession', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readSessionCookie(request);
    if (token === undefined) {
      // Tidak ada cookie: tidak perlu menyentuh DB.
      throw unauthenticated();
    }

    const authSession = await resolveSession(request.server.prisma, token);
    if (authSession === null) {
      // Token tak dikenal / kedaluwarsa / user REVOKED → 401 + cookie penghapus
      // (kontrak §2.4), supaya browser tidak terus mengirim cookie mati.
      clearSessionCookie(reply);
      throw unauthenticated();
    }

    request.authSession = authSession;

    // Sliding refresh (maks 1×/menit). Gagal menulis tidak boleh menjatuhkan
    // request yang sah — sesi masih valid sampai `expiresAt` yang lama.
    try {
      const touched = await touchSession(request.server.prisma, authSession);
      if (touched) setSessionCookie(reply, token, touched.maxAgeSeconds);
    } catch (err) {
      request.log.warn({ err }, 'gagal memperbarui lastSeenAt sesi');
    }
  });

  app.decorate('requireRole', (...roles: readonly UserRole[]) => (request: FastifyRequest) => {
    const { user } = currentSession(request);
    if (!roles.includes(user.role)) {
      throw forbidden('Peran Anda tidak cukup untuk aksi ini.', { requiredRoles: [...roles] });
    }
    return Promise.resolve();
  });

  app.decorate('requirePermission', (permission: Permission) => (request: FastifyRequest) => {
    const { user } = currentSession(request);
    if (!roleHasPermission(user.role, permission)) {
      // `requiredRoles` sesuai kontrak §1.10; `requiredPermission` ditambahkan
      // agar klien (dan log) tahu kemampuan mana yang kurang.
      request.log.info(
        { code: 'FORBIDDEN', userId: user.id, role: user.role, requiredPermission: permission },
        'izin tidak cukup',
      );
      throw forbidden('Anda tidak memiliki izin untuk aksi ini.', {
        requiredPermission: permission,
        requiredRoles: rolesWithPermission(permission),
      });
    }
    return Promise.resolve();
  });

  // Satu-satunya tempat yang memasang guard pada rute admin.
  app.addHook('onRoute', (routeOptions) => {
    if (!isAdminPath(routeOptions.url)) return;
    // Rute HEAD dibuat otomatis Fastify dari GET; ia mewarisi config yang sama.
    const access = routeOptions.config?.adminAccess;
    if (access === undefined) {
      throw new MissingAdminAccessError(
        Array.isArray(routeOptions.method) ? routeOptions.method.join('|') : routeOptions.method,
        routeOptions.url,
      );
    }
    if (access.kind === 'public') return;

    const guards: AnyOnRequestHook[] = [app.requireSession];
    if (access.kind === 'permission') {
      guards.push(app.requirePermission(access.permission));
    }
    // Tipe Fastify tidak punya varian "campuran sinkron + async" untuk satu
    // array hook, padahal runtime-nya menerima keduanya.
    routeOptions.onRequest = [
      ...guards,
      ...asHookArray(routeOptions.onRequest),
    ] as onRequestAsyncHookHandler[];
  });
}
