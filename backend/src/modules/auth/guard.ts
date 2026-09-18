/**
 * Guard sesi & peran untuk `/v1/admin/*` (ADR K7, kontrak §2.4).
 *
 * Dipasang sebagai dekorator instance supaya rute cukup menulis
 * `{ preHandler: app.requireSession }` atau
 * `{ preHandler: [app.requireSession, app.requireRole('ADMINISTRATOR')] }`.
 *
 * Urutan sesuai kontrak §1.10 (`401` sebelum `403`, keduanya sebelum validasi):
 * guard berjalan di `preHandler`, jadi selalu setelah cek `Origin`
 * (`onRequest`, lihat `plugins/cors.ts`) dan — untuk rute yang punya `schema` —
 * setelah validasi Zod. Rute yang wajib menolak tanpa membocorkan detail
 * validasi karena itu tidak memasang `schema.body` pada rute terproteksi tanpa
 * kebutuhan (`logout`/`me` tidak punya body).
 */

import type { UserRole } from '@ornament/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { forbidden, unauthenticated } from '../../lib/errors.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.js';
import { resolveSession, touchSession, type AuthSession } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Sesi aktif, diisi `requireSession`. `null` bila belum/tidak terautentikasi. */
    authSession: AuthSession | null;
  }

  interface FastifyInstance {
    /** preHandler: memuat sesi dari cookie atau menolak `401 UNAUTHENTICATED`. */
    requireSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * preHandler tambahan: menolak `403 FORBIDDEN` bila peran sesi tidak ada di
     * daftar. Fondasi untuk matriks izin per endpoint (#15) — PR ini belum
     * memasang matriks itu.
     */
    requireRole: (
      ...roles: readonly UserRole[]
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Sesi yang sudah divalidasi. Melempar bila dipanggil di rute tanpa
 * `requireSession` — itu bug rute, bukan kondisi runtime.
 */
export function currentSession(request: FastifyRequest): AuthSession {
  if (request.authSession === null) {
    throw new Error('rute ini memakai currentSession() tanpa preHandler app.requireSession');
  }
  return request.authSession;
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
}
