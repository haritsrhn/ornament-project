import { z } from 'zod';

import { searchQuerySchema, slugInputSchema } from './common.js';
import { dataEnvelope } from './envelope.js';
import { categoryTypeSchema } from './enums.js';

/**
 * Kontrak admin taksonomi — kontrak API §5.7 (`/v1/admin/categories`,
 * `/materials`, `/tags`).
 *
 * Satu set endpoint melayani **dua tabel** lewat query `type` (Q4):
 * `PRODUCT` → `Category` (hierarkis), `ARTICLE` → `ArticleCategory` (datar).
 * Layar `/admin/taxonomy` memakainya sebagai tab, tanpa modul admin baru.
 */

export const CATEGORY_NAME_MAX = 80;
export const CATEGORY_DESCRIPTION_MAX = 1000;
export const MATERIAL_NAME_MAX = 80;
export const TAG_SUGGESTION_LIMIT_MAX = 20;
/** Batas jumlah baris pada `PUT /categories/order` (seluruh pohon sekaligus). */
export const CATEGORY_ORDER_ITEMS_MAX = 500;

// ── Query ────────────────────────────────────────────────────────────────────

/** `type` default `PRODUCT` (kontrak §5.7). */
export const categoryTypeQuerySchema = z.object({ type: categoryTypeSchema.default('PRODUCT') });
export type CategoryTypeQuery = z.infer<typeof categoryTypeQuerySchema>;

export const adminCategoriesQuerySchema = categoryTypeQuerySchema.extend({
  q: searchQuerySchema.optional(),
});
export type AdminCategoriesQuery = z.infer<typeof adminCategoriesQuerySchema>;

export const categoryIdParamsSchema = z.object({ id: z.uuid() });
export const materialIdParamsSchema = z.object({ id: z.uuid() });
export const tagIdParamsSchema = z.object({ id: z.uuid() });

export const adminMaterialsQuerySchema = z.object({ q: searchQuerySchema.optional() });
export type AdminMaterialsQuery = z.infer<typeof adminMaterialsQuerySchema>;

export const adminTagsQuerySchema = z.object({
  /** Prefix (kontrak §5.7: autocomplete). */
  q: searchQuerySchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(TAG_SUGGESTION_LIMIT_MAX)
    .default(TAG_SUGGESTION_LIMIT_MAX),
});
export type AdminTagsQuery = z.infer<typeof adminTagsQuerySchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

export const adminCategorySchema = z.object({
  id: z.uuid(),
  type: z.literal('PRODUCT'),
  name: z.string(),
  slug: z.string(),
  parentId: z.uuid().nullable(),
  description: z.string().nullable(),
  position: z.int(),
  /** Kedalaman di pohon; UI membuat indentasi tanpa menyusun ulang pohonnya. */
  depth: z.int(),
  /** Semua `publishStatus`, di luar Trash, **termasuk turunan** (kontrak §5.7). */
  productCount: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminArticleCategorySchema = z.object({
  id: z.uuid(),
  type: z.literal('ARTICLE'),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  position: z.int(),
  /** Semua status, di luar Trash (kontrak §5.7). */
  articleCount: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminArticleCategory = z.infer<typeof adminArticleCategorySchema>;

/**
 * Respons `/admin/categories` bergantung pada `type`. Union dibedakan oleh
 * field `type` yang selalu ikut dikirim, jadi klien tidak perlu menebak dari
 * ada/tidaknya `parentId`.
 */
export const adminAnyCategorySchema = z.discriminatedUnion('type', [
  adminCategorySchema,
  adminArticleCategorySchema,
]);
export type AdminAnyCategory = z.infer<typeof adminAnyCategorySchema>;

export const adminMaterialSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  /** Kode SKU 3 huruf (model §6.2); internal, tidak pernah ada di `/public`. */
  skuCode: z.string().nullable(),
  productCount: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AdminMaterial = z.infer<typeof adminMaterialSchema>;

export const adminTagSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  /** Jumlah pemakaian di produk + artikel (issue #25). */
  usageCount: z.int(),
});
export type AdminTag = z.infer<typeof adminTagSchema>;

// ── Body ─────────────────────────────────────────────────────────────────────

export const createCategoryBodySchema = z.strictObject({
  name: z.string().trim().min(1, 'Nama kategori wajib diisi.').max(CATEGORY_NAME_MAX),
  slug: slugInputSchema.optional(),
  /** Hanya `type=PRODUCT`; pada `ARTICLE` → `400 VALIDATION_FAILED`. */
  parentId: z.uuid().nullable().optional(),
  description: z.string().trim().max(CATEGORY_DESCRIPTION_MAX).nullable().optional(),
  position: z.int().min(0).optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = createCategoryBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Kirim minimal satu field yang ingin diubah.',
    params: { code: 'empty_patch' },
  });
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;

/**
 * `PUT /v1/admin/categories/order` — seluruh pohon sekaligus, supaya urutan
 * dan induk berubah dalam satu transaksi (tidak ada state setengah jadi).
 */
export const categoryOrderBodySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        parentId: z.uuid().nullable(),
        position: z.int().min(0),
      }),
    )
    .min(1)
    .max(CATEGORY_ORDER_ITEMS_MAX),
});
export type CategoryOrderBody = z.infer<typeof categoryOrderBodySchema>;

export const SKU_CODE_PATTERN = /^[A-Z]{3}$/;

/** 3 huruf, dinormalisasi huruf besar (model §6.2: `RTN`, `TEK`, …). */
export const skuCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SKU_CODE_PATTERN, 'Kode SKU harus 3 huruf.');

export const createMaterialBodySchema = z.strictObject({
  name: z.string().trim().min(1, 'Nama material wajib diisi.').max(MATERIAL_NAME_MAX),
  slug: slugInputSchema.optional(),
  skuCode: skuCodeSchema.nullable().optional(),
});
export type CreateMaterialBody = z.infer<typeof createMaterialBodySchema>;

export const updateMaterialBodySchema = createMaterialBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    error: 'Kirim minimal satu field yang ingin diubah.',
    params: { code: 'empty_patch' },
  });
export type UpdateMaterialBody = z.infer<typeof updateMaterialBodySchema>;

// ── Respons ──────────────────────────────────────────────────────────────────

export const adminCategoriesResponseSchema = dataEnvelope(z.array(adminAnyCategorySchema));
export const adminCategoryResponseSchema = dataEnvelope(adminAnyCategorySchema);
export const adminMaterialsResponseSchema = dataEnvelope(z.array(adminMaterialSchema));
export const adminMaterialResponseSchema = dataEnvelope(adminMaterialSchema);
export const adminTagsResponseSchema = dataEnvelope(z.array(adminTagSchema));

// ── Aturan domain ────────────────────────────────────────────────────────────

/** `details.rule` pada `422 BUSINESS_RULE_VIOLATION` di §5.7. */
export const TAXONOMY_BUSINESS_RULES = {
  /** `parentId` menunjuk kategori yang tidak ada. */
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  /** Induk = diri sendiri atau salah satu turunannya. */
  CATEGORY_CYCLE: 'CATEGORY_CYCLE',
  /** `PUT /order` tidak memuat persis seluruh kategori bertipe itu. */
  CATEGORY_SET_MISMATCH: 'CATEGORY_SET_MISMATCH',
} as const;
export type TaxonomyBusinessRule =
  (typeof TAXONOMY_BUSINESS_RULES)[keyof typeof TAXONOMY_BUSINESS_RULES];

/**
 * `details` pada `409 IN_USE` (kontrak §1.10, Q5): `counts` per `entityType`
 * dipakai UI untuk menulis "masih digunakan oleh 9 produk".
 */
export const IN_USE_USAGES_MAX = 20;

export const inUseDetailsSchema = z.object({
  usages: z.array(z.object({ entityType: z.string(), id: z.string(), label: z.string() })),
  total: z.int(),
  counts: z.record(z.string(), z.int()).optional(),
});
export type InUseDetails = z.infer<typeof inUseDetailsSchema>;
