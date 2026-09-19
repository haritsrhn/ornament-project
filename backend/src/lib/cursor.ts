/**
 * Kursor keyset untuk daftar publik (kontrak §1.6).
 *
 * Bentuk: base64url dari JSON `{ s, f, v, i }`.
 *
 * - `s` — sort yang dipakai saat kursor dibuat.
 * - `f` — sidik jari filter (string kanonik dari seluruh filter aktif).
 * - `v` — nilai kolom sort pada baris terakhir halaman sebelumnya.
 * - `i` — `id` baris terakhir (tie-breaker; kontrak §1.7).
 *
 * `s` dan `f` membuat kursor **mengikat filter & sort** (§1.6): dipakai dengan
 * kombinasi lain → `400 INVALID_CURSOR`, bukan hasil yang diam-diam salah.
 *
 * Keyset dipilih karena stabil saat baris baru terbit di antara dua klik "Muat
 * 12 lagi": halaman berikutnya dibaca dari posisi baris terakhir, bukan dari
 * `OFFSET`, sehingga tidak ada item yang terlewat maupun tampil dua kali.
 */

import { z } from 'zod';

import { AppError } from './errors.js';

/** Isi kursor; nama field sengaja pendek agar string kursornya tidak panjang. */
const cursorPayloadSchema = z.object({
  s: z.string(),
  f: z.string(),
  v: z.string(),
  i: z.uuid(),
});

export interface CursorPosition {
  /** Nilai kolom sort pada baris terakhir (ISO 8601 untuk waktu). */
  value: string;
  /** `id` baris terakhir. */
  id: string;
}

export interface CursorBinding {
  /** Kode sort, mis. `-publishedAt`. */
  sort: string;
  /** String kanonik seluruh filter aktif, mis. `category=furniture&material=rotan`. */
  filter: string;
}

export const invalidCursor = () =>
  new AppError('INVALID_CURSOR', 'Kursor tidak valid untuk filter atau urutan ini.');

export function encodeCursor(binding: CursorBinding, position: CursorPosition): string {
  const payload = { s: binding.sort, f: binding.filter, v: position.value, i: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Mendekode kursor dan memastikan ia dibuat untuk filter & sort yang sama.
 * Rusak, bukan JSON, atau tidak cocok → `400 INVALID_CURSOR`.
 */
export function decodeCursor(cursor: string, binding: CursorBinding): CursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const result = cursorPayloadSchema.safeParse(parsed);
  if (!result.success) throw invalidCursor();
  if (result.data.s !== binding.sort || result.data.f !== binding.filter) throw invalidCursor();

  return { value: result.data.v, id: result.data.i };
}

/**
 * String kanonik filter untuk `CursorBinding.filter`: pasangan `key=value`
 * diurutkan berdasarkan `key`, nilai kosong dibuang. Daftar nilai (mis.
 * material) sudah diurutkan pemanggil agar urutan ketik tidak mengubah sidik
 * jarinya.
 */
export function canonicalFilter(entries: Record<string, string | undefined>): string {
  return Object.entries(entries)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
