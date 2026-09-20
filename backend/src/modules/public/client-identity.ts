/**
 * Identitas pemanggil untuk submit publik: IP dan user agent pengunjung, serta
 * hash IP yang disimpan (`ipHash`) dan dipakai sebagai kunci anti-spam.
 *
 * ── Siapa yang boleh mengaku sebagai siapa (ADR K7, kontrak §1.2) ────────────
 * Browser pengunjung **tidak pernah** memanggil API ini; yang memanggil adalah
 * server Next, jadi `request.ip` selalu berisi IP server Next dan tidak berguna
 * sebagai identitas pengunjung. Karena itu Next meneruskan IP aslinya lewat
 * `X-Client-Ip` (dan user agent lewat `X-Client-User-Agent`).
 *
 * Header yang bisa ditulis siapa saja hanya boleh dipercaya bila pengirimnya
 * terbukti server Next — yaitu bila `X-Internal-Key` valid
 * (`request.isTrustedInternalCaller`). Tanpa itu header diabaikan sepenuhnya
 * dan IP koneksi yang dipakai; kalau tidak, siapa pun bisa mengarang IP baru
 * pada setiap request dan membuat rate limit per IP tidak ada artinya.
 *
 * ── Mengapa hash, dan mengapa ber-kunci ──────────────────────────────────────
 * Model §3.7/§3.6 menyimpan `ipHash`, bukan IP mentah, dan §6.11 mengosongkan
 * kolomnya setelah 30 hari. SHA-256 **polos** atas sebuah IP bukan
 * perlindungan: seluruh ruang IPv4 hanya 2^32 nilai, jadi tabel pelangi
 * lengkapnya bisa dibuat siapa pun yang memegang dump DB. Karena itu hash-nya
 * di-*key* dengan rahasia server (HMAC-SHA256): tanpa rahasia itu, dump DB
 * tidak bisa dibalik menjadi IP.
 *
 * Rahasianya adalah `INTERNAL_API_KEY`, yang memang harus ada agar rute submit
 * publik bisa dipanggil sama sekali — jadi tidak ada env baru yang bisa lupa
 * di-set dan diam-diam menurunkan `ipHash` menjadi SHA-256 polos. Konsekuensi
 * yang disadari: **merotasi `INTERNAL_API_KEY` mengubah semua `ipHash`
 * berikutnya**, sehingga jendela rate limit yang sedang berjalan ikut
 * ter-reset. Itu diterima karena `ipHash` memang berumur pendek (30 hari) dan
 * hanya dipakai untuk anti-spam, bukan sebagai kunci relasi.
 */

import { createHmac } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

/** Header yang diteruskan server Next (kontrak §1.2). */
export const CLIENT_IP_HEADER = 'x-client-ip';
export const CLIENT_USER_AGENT_HEADER = 'x-client-user-agent';

/** Batas panjang yang disimpan di `Inquiry.userAgent` / `Comment.userAgent`. */
export const USER_AGENT_MAX_LENGTH = 500;

function firstHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value[0] : undefined;
}

/**
 * IP pengunjung: `X-Client-Ip` **hanya** bila pemanggil membawa
 * `X-Internal-Key` yang valid; selain itu IP koneksi (kontrak §1.2).
 */
export function resolveClientIp(request: FastifyRequest): string {
  if (!request.isTrustedInternalCaller) return request.ip;
  const forwarded = firstHeader(request, CLIENT_IP_HEADER)?.trim();
  return forwarded === undefined || forwarded === '' ? request.ip : forwarded;
}

/** User agent pengunjung; aturan kepercayaan sama dengan `resolveClientIp`. */
export function resolveClientUserAgent(request: FastifyRequest): string | null {
  const forwarded = request.isTrustedInternalCaller
    ? firstHeader(request, CLIENT_USER_AGENT_HEADER)
    : undefined;
  const value = (forwarded ?? firstHeader(request, 'user-agent') ?? '').trim();
  return value === '' ? null : value.slice(0, USER_AGENT_MAX_LENGTH);
}

/**
 * `ipHash` = HMAC-SHA256(rahasia, "ip:" + ip) dalam hex. Prefiks domain
 * memisahkan penggunaan ini dari hash lain yang memakai rahasia sama.
 */
export function hashClientIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(`ip:${ip}`).digest('hex');
}

export interface ClientIdentity {
  /** 🔒 Tidak pernah disimpan maupun di-log; hanya untuk diturunkan jadi hash. */
  ip: string;
  ipHash: string;
  userAgent: string | null;
}

export function readClientIdentity(request: FastifyRequest, secret: string): ClientIdentity {
  const ip = resolveClientIp(request);
  return { ip, ipHash: hashClientIp(ip, secret), userAgent: resolveClientUserAgent(request) };
}
