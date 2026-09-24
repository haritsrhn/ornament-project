/**
 * Tiket unggah bertanda tangan (`uploadId`, kontrak §5.12).
 *
 * Alur unggah butuh negara di antara dua request: server memutuskan key,
 * MIME, ukuran, dan visibilitas saat presign, lalu harus mempercayai
 * keputusan itu lagi saat konfirmasi. Menyimpannya di tabel unggahan
 * sementara berarti ada baris yatim setiap kali klien menutup tab — jadi
 * keputusannya dibawa klien dalam token bertanda tangan HMAC-SHA256.
 *
 * Yang dijaga tanda tangan itu: klien tidak bisa menaikkan `sizeBytes`,
 * menukar `mimeType` menjadi sesuatu di luar allowlist, mengubah `visibility`
 * menjadi `PUBLIC` agar berkasnya dapat URL permanen, menunjuk `key` milik
 * media lain, atau memakai tiket orang lain (`userId` ikut ditandatangani).
 *
 * Perbandingan tanda tangan memakai `timingSafeEqual`: verifikasi ini berjalan
 * pada input yang dikendalikan penyerang, jadi `===` membocorkan panjang
 * prefiks yang cocok.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { MediaVisibility } from '@ornament/shared';

export interface UploadTicketPayload {
  key: string;
  mimeType: string;
  sizeBytes: number;
  visibility: MediaVisibility;
  userId: string;
  /** Epoch detik; dibandingkan saat konfirmasi, bukan hanya oleh R2. */
  exp: number;
}

const encode = (value: object): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const sign = (body: string, secret: string): string =>
  createHmac('sha256', secret).update(body, 'utf8').digest('base64url');

/** `<payload base64url>.<hmac base64url>` — opaque bagi klien. */
export function signUploadTicket(payload: UploadTicketPayload, secret: string): string {
  const body = encode(payload);
  return `${body}.${sign(body, secret)}`;
}

/**
 * `null` bila token cacat, tanda tangannya tidak cocok, atau isinya bukan
 * bentuk yang kami tulis. Kedaluwarsa **tidak** dicek di sini: pemanggil perlu
 * membedakan `EXPIRED` dari `NOT_FOUND` saat menjawab `422 UPLOAD_INVALID`.
 */
export function verifyUploadTicket(token: string, secret: string): UploadTicketPayload | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1), 'base64url');
  const expected = Buffer.from(sign(body, secret), 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  return isTicketPayload(parsed) ? parsed : null;
}

function isTicketPayload(value: unknown): value is UploadTicketPayload {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.key === 'string' &&
    typeof t.mimeType === 'string' &&
    typeof t.sizeBytes === 'number' &&
    (t.visibility === 'PUBLIC' || t.visibility === 'PRIVATE') &&
    typeof t.userId === 'string' &&
    typeof t.exp === 'number'
  );
}

export function isTicketExpired(payload: UploadTicketPayload, now: Date = new Date()): boolean {
  return payload.exp * 1000 <= now.getTime();
}
