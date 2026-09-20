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

/**
 * Rich text (model domain D7): JSON blok yang disimpan apa adanya di kolom
 * `Json` (`Product.description`, `Artisan.story`).
 *
 * Isi **artikel** tidak lagi memakai skema ini: `Article.content` punya skema
 * blok ketat `articleContentSchema` (`articles.ts`) sesuai model §3.6. Yang
 * tersisa di sini hanyalah dua kolom rich text yang bentuk bloknya belum
 * ditetapkan kontrak (`Product.description`, `Artisan.story`), sehingga di
 * situ kontrak masih hanya menjamin "JSON valid".
 */
export const richTextSchema = z.json();
export type RichText = z.infer<typeof richTextSchema>;

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
