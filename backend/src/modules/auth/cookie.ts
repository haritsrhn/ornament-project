/**
 * Cookie sesi `__Host-osa_session` (ADR K7, kontrak §2.1).
 *
 * Atribut dikunci di satu tempat supaya tidak ada rute yang lupa salah satunya:
 * - `HttpOnly` — JavaScript halaman tidak bisa membacanya (mitigasi XSS).
 * - `Secure` — hanya lewat HTTPS. Diwajibkan prefiks `__Host-`; browser modern
 *   memperlakukan `http://localhost` sebagai origin aman, jadi dev tetap jalan.
 * - `SameSite=Strict` — tidak pernah ikut request lintas situs; inilah pengganti
 *   token CSRF (bersama cek `Origin`, lihat `plugins/cors.ts`).
 * - `Path=/` **tanpa** `Domain` — juga syarat prefiks `__Host-`: cookie milik
 *   host API saja dan tidak menyebar ke subdomain lain.
 */

import { SESSION_COOKIE_NAME } from '@ornament/shared';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

export { SESSION_COOKIE_NAME };

/** Atribut wajib cookie sesi; `maxAge` ditambahkan per pemanggil. */
export const SESSION_COOKIE_ATTRIBUTES = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  // Tidak ditandatangani: nilainya token acak 256 bit yang diverifikasi lewat
  // lookup hash di DB, jadi tanda tangan cookie tidak menambah apa pun.
  signed: false,
} as const satisfies CookieSerializeOptions;

export function setSessionCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_ATTRIBUTES,
    maxAge: maxAgeSeconds,
  });
}

/**
 * Menghapus cookie: nilai kosong + `Max-Age=0` (kontrak §2.2/§2.4). Atributnya
 * harus sama dengan saat di-set, kalau tidak browser menyimpan keduanya.
 */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE_NAME, '', { ...SESSION_COOKIE_ATTRIBUTES, maxAge: 0 });
}

export function readSessionCookie(request: FastifyRequest): string | undefined {
  const value = request.cookies[SESSION_COOKIE_NAME];
  return value === undefined || value === '' ? undefined : value;
}
