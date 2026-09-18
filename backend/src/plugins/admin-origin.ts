/**
 * CORS admin + cek `Origin` sebagai pengganti token CSRF (ADR K7, kontrak
 * §1.2/§2.1/§2.4).
 *
 * Tiga hal, semuanya hanya untuk `/v1/admin/*`:
 *
 * 1. **CORS**: `@fastify/cors` dengan allowlist **satu** origin dari
 *    `ADMIN_ORIGIN` (tanpa wildcard, karena `Allow-Credentials: true` dan
 *    wildcard tidak boleh digabung), metode dan header dibatasi sesuai §2.1.
 *    Situs publik tidak masuk allowlist: ia dirender server-side dan memanggil
 *    `/v1/public/*` server-to-server.
 * 2. **Cek Origin untuk non-GET**: request yang mengubah state wajib membawa
 *    `Origin` yang sama dengan `ADMIN_ORIGIN`, jika tidak → `403
 *    ORIGIN_NOT_ALLOWED`, **sebelum** cek sesi. Bersama `SameSite=Strict` dan
 *    `Content-Type: application/json` (yang memaksa preflight), ini menutup CSRF
 *    tanpa token terpisah. Browser selalu mengirim `Origin` pada non-GET;
 *    request tanpa `Origin` karena itu juga ditolak (mis. form lintas situs,
 *    `curl` tanpa header) — pemanggil server-to-server memakai `/v1/internal/*`.
 * 3. **`Cache-Control: no-store`** pada semua respons admin (§1.2).
 */

import fastifyCors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

import { AppError } from '../lib/errors.js';

/** Prefiks rute yang tunduk pada allowlist + cek Origin. */
export const ADMIN_PATH_PREFIX = '/v1/admin';

/** Metode yang tidak mengubah state; `Origin` tidak diwajibkan (kontrak §1.2). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Sesuai kontrak §2.1. */
export const ADMIN_CORS_METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;
export const ADMIN_CORS_HEADERS = ['Content-Type', 'Idempotency-Key', 'X-Request-Id'] as const;
export const ADMIN_CORS_EXPOSED_HEADERS = [
  'X-Request-Id',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Retry-After',
] as const;

export function isAdminPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`);
}

/** `https://admin.ornament.id/` → `https://admin.ornament.id` (origin dibandingkan persis). */
export function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export const originNotAllowed = () =>
  new AppError('ORIGIN_NOT_ALLOWED', 'Origin permintaan tidak diizinkan.');

export interface AdminOriginOptions {
  /** Origin admin dari env; tanpa ini tidak ada origin yang diizinkan. */
  adminOrigin?: string | undefined;
}

export function registerAdminOrigin(app: FastifyInstance, options: AdminOriginOptions = {}): void {
  const adminOrigin =
    options.adminOrigin === undefined || options.adminOrigin === ''
      ? undefined
      : normalizeOrigin(options.adminOrigin);

  void app.register(fastifyCors, {
    // Fungsi, bukan daftar: rute non-admin tidak perlu header CORS sama sekali.
    origin: (origin, callback) => {
      callback(null, adminOrigin !== undefined && normalizeOrigin(origin ?? '') === adminOrigin);
    },
    credentials: true,
    methods: [...ADMIN_CORS_METHODS],
    allowedHeaders: [...ADMIN_CORS_HEADERS],
    exposedHeaders: [...ADMIN_CORS_EXPOSED_HEADERS],
    // Preflight di-cache 10 menit; cukup singkat agar perubahan allowlist cepat berlaku.
    maxAge: 600,
  });

  app.addHook('onRequest', (request, reply, done) => {
    if (!isAdminPath(request.url)) {
      done();
      return;
    }

    void reply.header('cache-control', 'no-store');

    if (SAFE_METHODS.has(request.method)) {
      done();
      return;
    }

    const origin = request.headers.origin;
    const allowed =
      adminOrigin !== undefined &&
      typeof origin === 'string' &&
      normalizeOrigin(origin) === adminOrigin;

    if (!allowed) {
      // Header `Origin` bukan rahasia, tapi tetap tidak dicatat apa adanya agar
      // log tidak bisa dipakai menanam teks pilihan penyerang.
      request.log.info(
        { code: 'ORIGIN_NOT_ALLOWED', hasOrigin: typeof origin === 'string' },
        'origin admin ditolak',
      );
      done(originNotAllowed());
      return;
    }

    done();
  });
}
