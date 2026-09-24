import { z } from 'zod';

/**
 * Tipe bersama kontrak API §5 yang dipakai lintas domain. Hanya bentuk data:
 * tanpa tipe Prisma, tanpa dependensi server (ADR K6).
 */

/**
 * `PublicMedia` (kontrak §4/§5): hanya URL dan atribut tampilan. Berbeda dengan
 * `MediaRef` admin, DTO ini **tidak pernah** memuat `id`, `key`, `fileName`,
 * `sizeBytes`, `uploadedById`, maupun `visibility`.
 *
 * `url` non-nullable: media yang belum punya URL publik (basis R2 belum
 * dikonfigurasi) tidak dikirim sama sekali — field-nya `null`, atau barisnya
 * dibuang dari galeri.
 */
export const publicMediaSchema = z.object({
  url: z.string(),
  alt: z.string().nullable(),
  width: z.int().nullable(),
  height: z.int().nullable(),
});
export type PublicMedia = z.infer<typeof publicMediaSchema>;

/** Galeri publik: `PublicMedia` + keterangan (kontrak §5.2). */
export const publicMediaWithCaptionSchema = publicMediaSchema.extend({
  caption: z.string().nullable(),
});
export type PublicMediaWithCaption = z.infer<typeof publicMediaWithCaptionSchema>;

/**
 * Referensi ringkas ke resource publik yang diakses lewat slug (kategori,
 * material, tag di kartu produk).
 */
export const slugRefSchema = z.object({ slug: z.string(), name: z.string() });
export type SlugRef = z.infer<typeof slugRefSchema>;

// ── Submit publik (kontrak §5.3/§5.4, §1.8) ──────────────────────────────────

/**
 * Uang di **request** (`Decimal(10,2)`, kontrak §1.3): string desimal seperti
 * `"38"` atau `"38.00"`. Sengaja bukan `number`: float biner tidak bisa
 * mewakili semua nilai dua desimal, dan kolomnya `Decimal`.
 */
export const moneyInputSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Format uang harus angka dengan maksimal 2 desimal.');

/**
 * Honeypot (keputusan A6): field yang **harus kosong**. Form asli
 * menyembunyikannya; bot pengisi-semua-field mengisinya. Skema sengaja
 * menerima nilai apa pun berupa string — penolakannya bukan `400` melainkan
 * respons sukses palsu di server, supaya bot tidak belajar apa yang salah.
 */
export const honeypotSchema = z.string().max(200).optional();

/** Terisi = kemungkinan besar bot (A6). Spasi saja tetap dianggap kosong. */
export function isHoneypotFilled(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

/** `Idempotency-Key` (kontrak §1.8): 16–128 karakter, disarankan UUID v4. */
export const IDEMPOTENCY_KEY_MIN = 16;
export const IDEMPOTENCY_KEY_MAX = 128;

export const idempotencyKeySchema = z
  .string()
  .min(IDEMPOTENCY_KEY_MIN, `Idempotency-Key minimal ${String(IDEMPOTENCY_KEY_MIN)} karakter.`)
  .max(IDEMPOTENCY_KEY_MAX, `Idempotency-Key maksimal ${String(IDEMPOTENCY_KEY_MAX)} karakter.`);

/**
 * Header wajib pada submit publik yang idempoten (§1.8).
 *
 * `looseObject`, **bukan** `strictObject`: hasil validasi header menggantikan
 * `request.headers` di Fastify, jadi header lain (`x-client-ip`,
 * `x-internal-key`, …) harus tetap lolos apa adanya.
 */
export const idempotencyHeadersSchema = z.looseObject({
  'idempotency-key': idempotencyKeySchema,
});
export type IdempotencyHeaders = z.infer<typeof idempotencyHeadersSchema>;

/** Header penanda respons yang diputar ulang dari simpanan 24 jam (§1.8). */
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

// ── Daftar admin: flag boolean di query string (kontrak §1.7) ────────────────

/**
 * Flag boolean pada query admin (`trashed=true`, `archived=true`, …). Query
 * selalu string, jadi nilainya dibatasi `"true"`/`"false"` — bukan `z.coerce
 * .boolean()`, yang akan menganggap `"false"` bernilai `true`.
 */
export function booleanFlagSchema(defaultValue: boolean) {
  return z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

// ── Konkurensi optimistis (kontrak §1.9) ─────────────────────────────────────

/**
 * `expectedUpdatedAt` — penjaga edit bersamaan untuk resource yang **tidak**
 * punya nomor revisi (`Article`, `Artisan`, `Page`, `SiteSetting`, nav).
 * Produk memakai `expectedRevision` karena ia memang menyimpan `revision`.
 *
 * Wajib pada `PATCH`/`PUT`: tanpa itu dua editor bisa saling menimpa tanpa ada
 * yang tahu. Nilainya dibandingkan dengan `updatedAt` baris saat ini; berbeda →
 * `409 EDIT_CONFLICT` dengan `details: { updatedAt, updatedBy }`.
 */
export const expectedUpdatedAtSchema = z.iso.datetime();

// ── Aksi massal (kontrak §5: `BulkResult`) ───────────────────────────────────

/** Maksimum `ids` per request aksi massal (kontrak §5). */
export const BULK_IDS_MAX = 100;

/**
 * Hasil aksi massal. Selalu `200`, sukses parsial diizinkan (kontrak §5):
 * `failed[].code` memakai kode katalog §1.10 seperti endpoint tunggalnya,
 * sehingga UI bisa menjelaskan kegagalan per baris tanpa menebak.
 */
export const bulkResultSchema = z.object({
  succeeded: z.array(z.uuid()),
  failed: z.array(z.object({ id: z.uuid(), code: z.string(), message: z.string() })),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;

// ── Slug & pencarian (kontrak §1.7, model §6.1) ──────────────────────────────

/** Maks 80 karakter (model §6.1). */
export const SLUG_MAX_LENGTH = 80;

/** Pola slug aktif: segmen `[a-z0-9]` dipisah satu tanda hubung. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Slug yang dikirim klien (hanya Editor+; model §6.1). Dinormalisasi huruf
 * kecil lebih dulu supaya "Kursi-Rotan" tidak menjadi kegagalan validasi.
 */
export const slugInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Slug wajib diisi.')
  .max(SLUG_MAX_LENGTH, `Slug maksimal ${String(SLUG_MAX_LENGTH)} karakter.`)
  .regex(SLUG_PATTERN, 'Slug hanya boleh huruf kecil, angka, dan tanda hubung.');

export const SEARCH_QUERY_MAX_LENGTH = 100;

/** `q` kontrak §1.7: 1–100 karakter, di-trim. */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(SEARCH_QUERY_MAX_LENGTH, `Pencarian maksimal ${String(SEARCH_QUERY_MAX_LENGTH)} karakter.`);
