import { z } from 'zod';

import { publicMediaSchema, slugRefSchema } from './common.js';
import { richTextSchema } from './rich-text.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { qcStageSchema, qcStatusSchema, stockStatusSchema } from './enums.js';
import {
  cursorMetaWithTotalSchema,
  cursorQuerySchema,
  PUBLIC_CURSOR_LIMITS,
} from './pagination.js';

/**
 * Kontrak katalog publik — kontrak API §5.1 (`GET /v1/public/products`,
 * `/products/:slug`, `/categories`, `/materials`).
 *
 * **Privasi (kontrak §4, model domain D9):** setiap DTO di bawah ditulis sebagai
 * whitelist eksplisit, bukan hasil `omit` dari model. Field 🔒 (`stockNote`,
 * `stockStatusOverride`, `lowStockThreshold`, catatan QC, `revision`,
 * `publishStatus`, `deletedAt`, `createdById`/`updatedById`, …) karena itu tidak
 * bisa ikut terkirim, bahkan bila kolom baru ditambahkan ke Prisma nanti.
 */

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Slug filter. Sengaja tanpa regex: slug yang tidak dikenal harus menjawab
 * `200` dengan `data: []` (kontrak §5.1) supaya URL filter lama tidak error,
 * jadi bentuk yang aneh pun cukup "tidak cocok" — bukan `400`.
 */
export const filterSlugSchema = z.string().min(1).max(100);

/** Batas jumlah nilai pada filter multi-nilai; menjaga jumlah subquery tetap terikat. */
export const FILTER_SLUG_LIST_MAX = 10;

/**
 * Filter multi-nilai dipisah koma (kontrak §1.7), mis.
 * `material=rotan-alami,jati-reclaimed`. Nilai kosong dibuang dan duplikat
 * dihilangkan, sehingga `material=,rotan-alami,rotan-alami` = satu filter.
 */
export const filterSlugListSchema = z
  .string()
  .transform((value) => [...new Set(value.split(',').map((part) => part.trim()))])
  .pipe(z.array(filterSlugSchema).max(FILTER_SLUG_LIST_MAX));

/** Allowlist sort katalog publik (kontrak §5.1); tie-breaker `id` ditambahkan server. */
export const PUBLIC_PRODUCT_SORTS = ['-publishedAt', 'name'] as const;
export const publicProductSortSchema = z.enum(PUBLIC_PRODUCT_SORTS);
export type PublicProductSort = z.infer<typeof publicProductSortSchema>;

export const publicProductsQuerySchema = cursorQuerySchema(PUBLIC_CURSOR_LIMITS).extend({
  /** Slug kategori; **termasuk turunannya** (kontrak §5.1). */
  category: filterSlugSchema.optional(),
  /** AND: produk harus punya **semua** material yang disebut (kontrak §5.1). */
  material: filterSlugListSchema.optional(),
  tag: filterSlugSchema.optional(),
  artisan: filterSlugSchema.optional(),
  sort: publicProductSortSchema.default('-publishedAt'),
});
export type PublicProductsQuery = z.infer<typeof publicProductsQuerySchema>;

/** Resource publik diakses lewat slug (kontrak §1.3). */
export const slugParamsSchema = z.object({ slug: filterSlugSchema });
export type SlugParams = z.infer<typeof slugParamsSchema>;

/** `withEmpty=false` (default) menyembunyikan taksonomi tanpa produk terbit. */
export const withEmptyQuerySchema = z.object({
  withEmpty: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type WithEmptyQuery = z.infer<typeof withEmptyQuerySchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

/** Kartu katalog. Sengaja **tanpa harga**: FOB hanya ada di detail (kontrak §5.1). */
export const publicProductCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  sku: z.string(),
  excerpt: z.string().nullable(),
  primaryImage: publicMediaSchema.nullable(),
  category: slugRefSchema,
  primaryMaterial: slugRefSchema.nullable(),
  /** Turunan `artisan.village`/`regency`, mis. `"Bangunjiwo, Bantul"` (model §3.5). */
  origin: z.string().nullable(),
  /** Status **efektif** (§6.3 Q13); `stockStatusOverride` 🔒 tidak pernah dikirim. */
  stockStatus: stockStatusSchema,
  moqQuantity: z.int(),
  moqUnit: z.string(),
  publishedAt: z.iso.datetime(),
});
export type PublicProductCard = z.infer<typeof publicProductCardSchema>;

/** Baris `ProductSpec` (kontrak §5.1); `position` hanya menentukan urutan. */
export const publicProductSpecSchema = z.object({ label: z.string(), value: z.string() });
export type PublicProductSpec = z.infer<typeof publicProductSpecSchema>;

/**
 * Checklist QC per produk. `notes` 🔒, `checkedById`, dan `checkedAt` **tidak**
 * ada di DTO publik (kontrak §4).
 */
export const publicQcCheckSchema = z.object({
  stage: qcStageSchema,
  status: qcStatusSchema,
  criteria: z.string().nullable(),
});
export type PublicQcCheck = z.infer<typeof publicQcCheckSchema>;

/**
 * Pengrajin ringkas di detail produk. `slug: null` bila profilnya tidak publik
 * (`VERIFICATION` atau diarsipkan, A10/model §6.7) sehingga UI menampilkannya
 * tanpa tautan alih-alih mengarah ke halaman 404.
 */
export const publicProductArtisanSchema = z.object({
  slug: z.string().nullable(),
  name: z.string(),
  village: z.string().nullable(),
  regency: z.string(),
  province: z.string(),
  skills: z.array(z.string()),
  photo: publicMediaSchema.nullable(),
});
export type PublicProductArtisan = z.infer<typeof publicProductArtisanSchema>;

export const publicProductDimensionsSchema = z.object({
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
});
export type PublicProductDimensions = z.infer<typeof publicProductDimensionsSchema>;

export const publicProductDetailSchema = publicProductCardSchema.extend({
  description: richTextSchema.nullable(),
  images: z.array(publicMediaSchema),
  tags: z.array(slugRefSchema),
  materials: z.array(slugRefSchema.extend({ isPrimary: z.boolean() })),
  dimensions: publicProductDimensionsSchema,
  weightKg: z.number().nullable(),
  leadTimeDays: z.int().nullable(),
  stockQuantity: z.int().nullable(),
  /** String desimal (kontrak §1.3); `null` → UI menulis "Inquire for pricing" (Q7). */
  fobPriceUsd: z.string().nullable(),
  fobPort: z.string().nullable(),
  specs: z.array(publicProductSpecSchema),
  /** Selalu empat baris, urut `MATERIAL` → `PACKAGING`. */
  qcChecks: z.array(publicQcCheckSchema),
  artisan: publicProductArtisanSchema.nullable(),
  /** Maks 4: kategori sama, terbit, bukan dirinya sendiri, urut `-publishedAt`. */
  related: z.array(publicProductCardSchema),
});
export type PublicProductDetail = z.infer<typeof publicProductDetailSchema>;

/** Jumlah maksimum produk terkait di detail (kontrak §5.1). */
export const RELATED_PRODUCTS_MAX = 4;

/**
 * Kategori katalog publik. Datar tetapi urut pohon, dengan `depth` agar UI bisa
 * membuat indentasi tanpa menyusun ulang pohonnya. `skuCode` internal tidak ada
 * di sini (kontrak §4).
 */
export const publicCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  parentId: z.uuid().nullable(),
  description: z.string().nullable(),
  position: z.int(),
  depth: z.int(),
  /** Produk terbit di kategori ini **dan turunannya**; tidak terpengaruh filter lain. */
  productCount: z.int(),
});
export type PublicCategory = z.infer<typeof publicCategorySchema>;

export const publicMaterialSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  productCount: z.int(),
});
export type PublicMaterial = z.infer<typeof publicMaterialSchema>;

// ── Respons ──────────────────────────────────────────────────────────────────

export const publicProductsResponseSchema = dataMetaEnvelope(
  z.array(publicProductCardSchema),
  cursorMetaWithTotalSchema,
);
export const publicProductResponseSchema = dataEnvelope(publicProductDetailSchema);
export const publicCategoriesResponseSchema = dataEnvelope(z.array(publicCategorySchema));
export const publicMaterialsResponseSchema = dataEnvelope(z.array(publicMaterialSchema));
