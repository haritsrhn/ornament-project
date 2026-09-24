import { z } from 'zod';

/**
 * Blok rich text yang dipakai bersama isi artikel (`Article.content`, model
 * §3.6), cerita pengrajin (`Artisan.story`), dan deskripsi produk
 * (`Product.description`).
 *
 * Sebelumnya tiga kolom itu hanya dijamin "JSON valid" (`z.json()`). Isi
 * artikel mendapat skema blok ketat lebih dulu karena ia yang paling terlihat
 * publik; dua kolom sisanya tetap terbuka dan ikut disajikan apa adanya ke
 * `/v1/public/*` — bentuk apa pun sampai batas 1 MB tersimpan dan dipantulkan
 * kembali, tanpa jaminan bentuk bagi renderer dan tanpa validasi tautan.
 *
 * Berkas ini menjadi rumah bersamanya. `articles.ts` menambahkan blok gambar
 * di atasnya; `story` dan `description` memakai blok teks saja, karena
 * keduanya tidak punya jalur penukaran `mediaId` → `PublicMedia` saat dibaca.
 */

/**
 * Skema tautan yang boleh muncul di rich text.
 *
 * Isi ditulis peran serendah CONTRIBUTOR dan disajikan apa adanya ke halaman
 * publik maupun pratinjau admin, jadi `href` divalidasi di kontrak — bukan di
 * renderer — agar `javascript:`/`data:` (XSS tersimpan) dan `//evil.tld`
 * (open redirect protokol-relatif) tidak pernah tersimpan.
 */
export const RICH_TEXT_HREF_PATTERN = /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i;

export const RICH_TEXT_HREF_MAX = 2048;

/** Potongan teks dengan mark `bold`/`italic`/tautan (model §3.6: `RichInline`). */
export const richInlineSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z
    .string()
    .max(RICH_TEXT_HREF_MAX)
    .regex(RICH_TEXT_HREF_PATTERN, 'Tautan harus http(s), mailto, path relatif, atau anchor.')
    .optional(),
});
export type RichInline = z.infer<typeof richInlineSchema>;

/** `id` blok: stabil per blok, dipakai editor admin sebagai kunci (kontrak §5.9). */
export const richTextBlockIdSchema = z.string().min(1).max(64);

export const paragraphBlockSchema = z.object({
  id: richTextBlockIdSchema,
  type: z.literal('paragraph'),
  text: z.array(richInlineSchema),
});

export const headingBlockSchema = z.object({
  id: richTextBlockIdSchema,
  type: z.literal('heading2'),
  text: z.string(),
});

export const quoteBlockSchema = z.object({
  id: richTextBlockIdSchema,
  type: z.literal('quote'),
  text: z.string(),
  cite: z.string().optional(),
});

/** Blok teks tanpa gambar — dasar bersama untuk artikel, cerita, dan deskripsi. */
export const richTextBlockSchema = z.discriminatedUnion('type', [
  paragraphBlockSchema,
  headingBlockSchema,
  quoteBlockSchema,
]);
export type RichTextBlock = z.infer<typeof richTextBlockSchema>;

/**
 * Batas blok untuk `story` dan `description`. Lebih kecil daripada artikel
 * (200): keduanya adalah teks pendamping pada halaman profil dan produk,
 * bukan tulisan panjang, dan batas yang longgar hanya memperbesar payload
 * yang harus dirender setiap kali halaman dibuka.
 */
export const RICH_TEXT_BLOCKS_MAX = 60;

/**
 * Rich text untuk `Artisan.story` dan `Product.description`.
 *
 * Kontrak tidak menetapkan bentuk bloknya, jadi yang dipakai adalah bentuk
 * yang sudah ada di data: blok teks yang sama dengan artikel, tanpa gambar.
 */
export const richTextSchema = z.array(richTextBlockSchema).max(RICH_TEXT_BLOCKS_MAX);
export type RichText = z.infer<typeof richTextSchema>;
