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
 * Skema blok yang lebih ketat (`ArticleBlock[]`) menyusul bersama modul artikel;
 * sampai itu kontrak hanya menjamin "JSON valid", sehingga frontend tetap
 * mendapat tipe yang bisa ditelusuri tanpa mengunci bentuk blok terlalu dini.
 */
export const richTextSchema = z.json();
export type RichText = z.infer<typeof richTextSchema>;
