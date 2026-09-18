/**
 * Konfigurasi rate limit per rute (kontrak §2.3) untuk `@fastify/rate-limit`.
 *
 * Plugin didaftarkan dengan `global: false` (lihat `src/app.ts`), jadi hanya
 * rute yang memasang `config.rateLimit` yang dibatasi. Helper di sini menjaga
 * agar semuanya memakai `errorResponseBuilder` yang sama sehingga `429` selalu
 * keluar sebagai envelope kontrak §1.5 (`RATE_LIMITED` +
 * `details.retryAfterSeconds` + header `Retry-After`).
 */

import { rateLimited } from './errors.js';

/**
 * `errorResponseBuilder` **melempar** apa pun yang dikembalikan fungsi ini,
 * jadi mengembalikan `AppError` membuat 429-nya melewati error handler kami.
 */
export const rateLimitErrorResponse = (_request: unknown, context: { ttl: number }) =>
  rateLimited(Math.max(1, Math.ceil(context.ttl / 1000)));

export interface RouteRateLimit {
  rateLimit: {
    max: number;
    timeWindow: string;
    errorResponseBuilder: typeof rateLimitErrorResponse;
  };
}

export function rateLimitConfig(max: number, timeWindow: string): RouteRateLimit {
  return { rateLimit: { max, timeWindow, errorResponseBuilder: rateLimitErrorResponse } };
}

/** Jaring pengaman untuk `/v1/admin/*` biasa (kontrak §2.3: 600 / menit). */
export const ADMIN_RATE_LIMIT_MAX = 600;
export const ADMIN_RATE_LIMIT_WINDOW = '1 minute';
export const adminRateLimit = (): RouteRateLimit =>
  rateLimitConfig(ADMIN_RATE_LIMIT_MAX, ADMIN_RATE_LIMIT_WINDOW);

/**
 * Endpoint undangan tanpa sesi (kontrak §2.3: 10 / 15 menit per IP).
 * Anti-enumerasi token: polanya sama dengan batas per IP pada login.
 */
export const INVITE_PUBLIC_RATE_LIMIT_MAX = 10;
export const INVITE_PUBLIC_RATE_LIMIT_WINDOW = '15 minutes';
export const invitePublicRateLimit = (): RouteRateLimit =>
  rateLimitConfig(INVITE_PUBLIC_RATE_LIMIT_MAX, INVITE_PUBLIC_RATE_LIMIT_WINDOW);
