import { z } from 'zod';

/**
 * Fondasi pagination kontrak API §1.6 — skema umum tanpa resource.
 * Query dari URL selalu string, jadi angka memakai `z.coerce`.
 */

// ── Offset / nomor halaman (daftar admin) ────────────────────────────────────

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** Query `page` (≥1, default 1) dan `pageSize` (1–100, default 20). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * `meta` daftar ber-halaman. `counts` (opsional) = hitungan per tab UI,
 * mis. `{ all: 57, PUBLISHED: 41, DRAFT: 16, trash: 3 }`.
 */
export const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  counts: z.record(z.string(), z.number().int().min(0)).optional(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

// ── Cursor / keyset (daftar publik, feed) ────────────────────────────────────

export interface CursorQueryOptions {
  /** Default `limit` bila tidak dikirim (publik: 12, activity log: 20). */
  defaultLimit: number;
  /** Batas atas `limit` (publik: 48, activity log: 100). */
  maxLimit: number;
}

/** Nilai untuk daftar publik (katalog, journal, komentar). */
export const PUBLIC_CURSOR_LIMITS = { defaultLimit: 12, maxLimit: 48 } as const;

/**
 * Query `limit` + `cursor` (opaque base64url). Isi kursor divalidasi server
 * saat didekode; kursor rusak/tidak cocok → `400 INVALID_CURSOR`, bukan di sini.
 */
export function cursorQuerySchema({ defaultLimit, maxLimit }: CursorQueryOptions) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    cursor: z.string().min(1).optional(),
  });
}
export type CursorQuery = z.infer<ReturnType<typeof cursorQuerySchema>>;

/** `meta` daftar kursor tanpa total (activity log). `nextCursor: null` = habis. */
export const cursorMetaSchema = z.object({
  limit: z.number().int().min(1),
  nextCursor: z.string().nullable(),
});
export type CursorMeta = z.infer<typeof cursorMetaSchema>;

/** `meta` daftar kursor dengan total (daftar publik: "Menampilkan 12 dari 38"). */
export const cursorMetaWithTotalSchema = cursorMetaSchema.extend({
  total: z.number().int().min(0),
});
export type CursorMetaWithTotal = z.infer<typeof cursorMetaWithTotalSchema>;
