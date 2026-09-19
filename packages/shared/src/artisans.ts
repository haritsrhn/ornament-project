import { z } from 'zod';

import { publicMediaSchema, publicMediaWithCaptionSchema, richTextSchema } from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { publicArtisanStatusSchema } from './enums.js';
import {
  cursorMetaWithTotalSchema,
  cursorQuerySchema,
  PUBLIC_CURSOR_LIMITS,
} from './pagination.js';
import { filterSlugSchema, publicProductCardSchema } from './products.js';

/**
 * Kontrak pengrajin publik — kontrak API §5.2 (`GET /v1/public/artisans`,
 * `/artisans/:slug`).
 *
 * **Privasi (kontrak §4, model §6.7):** DTO ditulis sebagai whitelist eksplisit.
 * `contactName`, `phone`, `address`, `internalNotes`, `ArtisanDocument`
 * (seluruhnya), Media `PRIVATE`, dan `archivedAt` (Q14) karena itu tidak punya
 * tempat di skema mana pun di berkas ini.
 */

// ── Query ────────────────────────────────────────────────────────────────────

/** Filter kabupaten; dibandingkan tanpa memperhatikan besar-kecil huruf. */
export const artisanRegencyFilterSchema = z.string().min(1).max(100);

export const publicArtisansQuerySchema = cursorQuerySchema(PUBLIC_CURSOR_LIMITS).extend({
  regency: artisanRegencyFilterSchema.optional(),
});
export type PublicArtisansQuery = z.infer<typeof publicArtisansQuerySchema>;

export const artisanSlugParamsSchema = z.object({ slug: filterSlugSchema });
export type ArtisanSlugParams = z.infer<typeof artisanSlugParamsSchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

export const publicArtisanCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  village: z.string().nullable(),
  regency: z.string(),
  province: z.string(),
  skills: z.array(z.string()),
  summary: z.string().nullable(),
  /** Hanya `ACTIVE`/`FULL_CAPACITY` yang pernah tampil publik (model §6.7). */
  status: publicArtisanStatusSchema,
  partnerSinceYear: z.int().nullable(),
  photo: publicMediaSchema.nullable(),
  /** Statistik publik "14 produk aktif" diturunkan dari produk terbit (§6.7). */
  publishedProductCount: z.int(),
});
export type PublicArtisanCard = z.infer<typeof publicArtisanCardSchema>;

export const publicArtisanDetailSchema = publicArtisanCardSchema.extend({
  story: richTextSchema.nullable(),
  craftsmenCount: z.int().nullable(),
  monthlyCapacity: z.int().nullable(),
  capacityUnit: z.string(),
  avgLeadTimeDays: z.int().nullable(),
  images: z.array(publicMediaWithCaptionSchema),
  /** Maks 12 terbaru; selebihnya lewat `/public/products?artisan=<slug>`. */
  products: z.array(publicProductCardSchema),
});
export type PublicArtisanDetail = z.infer<typeof publicArtisanDetailSchema>;

/** Jumlah produk yang disertakan di detail pengrajin (kontrak §5.2). */
export const ARTISAN_PRODUCTS_MAX = 12;

// ── Respons ──────────────────────────────────────────────────────────────────

export const publicArtisansResponseSchema = dataMetaEnvelope(
  z.array(publicArtisanCardSchema),
  cursorMetaWithTotalSchema,
);
export const publicArtisanResponseSchema = dataEnvelope(publicArtisanDetailSchema);
