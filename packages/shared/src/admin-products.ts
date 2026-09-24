import { z } from 'zod';

import {
  booleanFlagSchema,
  bulkResultSchema,
  BULK_IDS_MAX,
  moneyInputSchema,
  searchQuerySchema,
  slugInputSchema,
} from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import {
  publishStatusSchema,
  qcStageSchema,
  qcStatusSchema,
  stockStatusSchema,
  type StockStatus,
} from './enums.js';
import { mediaRefSchema } from './auth.js';
import { richTextSchema } from './rich-text.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { userRefSchema } from './users.js';

/**
 * Kontrak admin produk — kontrak API §5.6 (`/v1/admin/products/*`).
 *
 * Hanya bentuk data: tanpa dependensi server dan tanpa tipe Prisma (ADR K6).
 * DTO ditulis sebagai **whitelist eksplisit** (model D9): kolom baru di Prisma
 * tidak pernah ikut terkirim hanya karena ada.
 */

// ── SKU (model §6.2) ─────────────────────────────────────────────────────────

export const SKU_MAX_LENGTH = 32;
export const SKU_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

/**
 * `sku` boleh null saat draf dan wajib saat publish (A4/Q6). Dinormalisasi
 * huruf besar supaya `orn-rtn-1` dan `ORN-RTN-1` tidak pernah menjadi dua SKU
 * berbeda di kolom unik.
 */
export const skuInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'SKU tidak boleh string kosong; kirim null untuk mengosongkan.')
  .max(SKU_MAX_LENGTH, `SKU maksimal ${String(SKU_MAX_LENGTH)} karakter.`)
  .regex(SKU_PATTERN, 'SKU hanya boleh huruf besar, angka, dan tanda hubung.');

/** Prefiks saran SKU (model §6.2: `ORN-<kode>-<NNNN>`). */
export const SKU_SUGGESTION_PREFIX = 'ORN';
/** `NNNN` dari sequence Postgres, padding minimal 4 digit (model §6.2). */
export const SKU_SEQUENCE_PAD = 4;

// ── Batas `ProductInput` (kontrak §5.6) ──────────────────────────────────────

export const PRODUCT_NAME_MAX = 160;
export const PRODUCT_EXCERPT_MAX = 300;
export const PRODUCT_MATERIALS_MAX = 20;
export const PRODUCT_TAGS_MAX = 20;
export const PRODUCT_TAG_NAME_MAX = 60;
export const PRODUCT_IMAGES_MAX = 20;
export const PRODUCT_SPECS_MAX = 30;
export const PRODUCT_SPEC_LABEL_MAX = 60;
export const PRODUCT_SPEC_VALUE_MAX = 200;
export const PRODUCT_MOQ_UNIT_MAX = 16;
export const PRODUCT_STOCK_NOTE_MAX = 500;
export const PRODUCT_QC_CRITERIA_MAX = 500;
export const PRODUCT_QC_NOTES_MAX = 2000;

export const productMaterialInputSchema = z.strictObject({
  materialId: z.uuid(),
  isPrimary: z.boolean().default(false),
});
export type ProductMaterialInput = z.infer<typeof productMaterialInputSchema>;

export const productSpecInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(PRODUCT_SPEC_LABEL_MAX),
  value: z.string().trim().min(1).max(PRODUCT_SPEC_VALUE_MAX),
});
export type ProductSpecInput = z.infer<typeof productSpecInputSchema>;

/**
 * Ukuran (`Decimal(7,1)`/`(7,2)`) dikirim sebagai `number` (kontrak §1.3).
 * Batas atas menjaga agar nilai tidak melebihi presisi kolom.
 */
const dimensionSchema = z.number().min(0).max(99_999.9);
const weightSchema = z.number().min(0).max(99_999.99);

/**
 * Bentuk `ProductInput` (kontrak §5.6). Ditulis sebagai *shape* terpisah agar
 * varian `POST` (semua wajib) dan `PATCH` (parsial + `expectedRevision`) lahir
 * dari satu definisi, bukan dua daftar field yang bisa menyimpang.
 */
const productInputShape = {
  name: z.string().trim().min(1, 'Nama produk wajib diisi.').max(PRODUCT_NAME_MAX),
  /** Hanya Editor+ (model §6.1); Contributor yang mengirimnya → `403 FORBIDDEN_FIELD`. */
  slug: slugInputSchema.optional(),
  sku: skuInputSchema.nullable().optional(),
  description: richTextSchema.nullable().optional(),
  excerpt: z.string().trim().max(PRODUCT_EXCERPT_MAX).nullable().optional(),
  categoryId: z.uuid(),
  artisanId: z.uuid().nullable().optional(),
  materials: z.array(productMaterialInputSchema).max(PRODUCT_MATERIALS_MAX).optional(),
  /** Nama tag; dinormalisasi & dibuat bila belum ada (model §3.3). */
  tags: z
    .array(z.string().trim().min(1).max(PRODUCT_TAG_NAME_MAX))
    .max(PRODUCT_TAGS_MAX)
    .optional(),
  moqQuantity: z.int().min(1, 'MOQ minimal 1.'),
  moqUnit: z.string().trim().min(1).max(PRODUCT_MOQ_UNIT_MAX),
  leadTimeDays: z.int().min(0).max(3650).nullable().optional(),
  lengthCm: dimensionSchema.nullable().optional(),
  widthCm: dimensionSchema.nullable().optional(),
  heightCm: dimensionSchema.nullable().optional(),
  weightKg: weightSchema.nullable().optional(),
  fobPriceUsd: moneyInputSchema.nullable().optional(),
  fobPort: z.string().trim().max(80).nullable().optional(),
  /** `null` = `MADE_TO_ORDER` bila tanpa override (Q13). */
  stockQuantity: z.int().min(0).nullable().optional(),
  /** 🔒 `null` = status stok dihitung otomatis (Q13). */
  stockStatusOverride: stockStatusSchema.nullable().optional(),
  /** 🔒 `null` = pakai `SiteSetting.lowStockThreshold`. */
  lowStockThreshold: z.int().min(0).nullable().optional(),
  /** 🔒 Catatan internal. */
  stockNote: z.string().trim().max(PRODUCT_STOCK_NOTE_MAX).nullable().optional(),
  primaryImageId: z.uuid().nullable().optional(),
  /** Urutan = `position`; **tidak** boleh memuat `primaryImageId` (model §3.5). */
  images: z.array(z.uuid()).max(PRODUCT_IMAGES_MAX).optional(),
  specs: z.array(productSpecInputSchema).max(PRODUCT_SPECS_MAX).optional(),
} as const;

/** Field array yang **mengganti seluruh isi** bila dikirim (kontrak §1.3). */
export const PRODUCT_REPLACE_FIELDS = ['materials', 'tags', 'images', 'specs'] as const;

/** Field yang hanya boleh dikirim Editor+ (kontrak §5.6: `403 FORBIDDEN_FIELD`). */
export const PRODUCT_EDITOR_ONLY_FIELDS = ['slug'] as const;

interface ProductInputLike {
  materials?: { materialId: string; isPrimary: boolean }[] | undefined;
  images?: string[] | undefined;
  primaryImageId?: string | null | undefined;
  specs?: unknown[] | undefined;
}

/**
 * Aturan lintas-field yang berlaku sama untuk `POST` dan `PATCH`.
 *
 * Sengaja **bukan** aturan publish: di sini hanya bentuk yang tidak pernah sah
 * (dua material primer, galeri memuat foto utama). Syarat publish §6.3 dicek
 * server saat menerbitkan, dengan kode error berbeda (`422
 * PUBLISH_REQUIREMENTS_NOT_MET`), karena draf memang boleh belum lengkap.
 */
function checkProductInput(value: ProductInputLike, ctx: z.RefinementCtx): void {
  const materials = value.materials;
  if (materials !== undefined) {
    const primary = materials.filter((material) => material.isPrimary);
    if (primary.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['materials'],
        message: 'Hanya boleh ada satu material primer.',
        params: { code: 'multiple_primary_materials' },
      });
    }
    const ids = new Set(materials.map((material) => material.materialId));
    if (ids.size !== materials.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['materials'],
        message: 'Material tidak boleh diulang.',
        params: { code: 'duplicate_material' },
      });
    }
  }

  const images = value.images;
  if (images !== undefined) {
    if (new Set(images).size !== images.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['images'],
        message: 'Gambar galeri tidak boleh diulang.',
        params: { code: 'duplicate_image' },
      });
    }
    const primaryImageId = value.primaryImageId;
    if (
      primaryImageId !== undefined &&
      primaryImageId !== null &&
      images.includes(primaryImageId)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['images'],
        message: 'Galeri tidak memuat foto utama.',
        params: { code: 'primary_image_in_gallery' },
      });
    }
  }
}

/** `POST /v1/admin/products` (kontrak §5.6). */
export const productInputSchema = z.strictObject(productInputShape).superRefine(checkProductInput);
export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductInputRaw = z.input<typeof productInputSchema>;

/**
 * `PATCH /v1/admin/products/:id`. `expectedRevision` **wajib** (kontrak §1.9):
 * tanpa itu dua editor bisa saling menimpa tanpa ada yang tahu.
 */
export const updateProductBodySchema = z
  .strictObject(productInputShape)
  .partial()
  .extend({ expectedRevision: z.int().min(1) })
  .superRefine(checkProductInput);
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

// ── Query daftar (kontrak §5.6) ──────────────────────────────────────────────

/** Allowlist sort §1.7; tie-breaker `id` ditambahkan server. */
export const ADMIN_PRODUCT_SORTS = ['-updatedAt', 'name', 'sku', '-publishedAt'] as const;
export const adminProductSortSchema = z.enum(ADMIN_PRODUCT_SORTS);
export type AdminProductSort = z.infer<typeof adminProductSortSchema>;

export const adminProductsQuerySchema = pageQuerySchema.extend({
  publishStatus: publishStatusSchema.optional(),
  stockStatus: stockStatusSchema.optional(),
  categoryId: z.uuid().optional(),
  /** Material mana pun (bukan hanya primer), kontrak §5.6. */
  materialId: z.uuid().optional(),
  /** `artisan.regency` — filter "daerah" di tabel produk. */
  regency: z.string().trim().min(1).max(80).optional(),
  artisanId: z.uuid().optional(),
  /** `true` = **hanya** baris di Trash (kontrak §1.7). */
  trashed: booleanFlagSchema(false),
  /** ILIKE pada `name`, `sku`, nama material, `artisan.regency`. */
  q: searchQuerySchema.optional(),
  sort: adminProductSortSchema.default('-updatedAt'),
});
export type AdminProductsQuery = z.infer<typeof adminProductsQuerySchema>;

export const productIdParamsSchema = z.object({ id: z.uuid() });
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

/** Referensi ringkas ke baris taksonomi di DTO admin. */
export const adminRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type AdminRef = z.infer<typeof adminRefSchema>;

export const adminProductArtisanRefSchema = adminRefSchema.extend({ regency: z.string() });

export const adminQcCheckSchema = z.object({
  stage: qcStageSchema,
  status: qcStatusSchema,
  criteria: z.string().nullable(),
  /** 🔒 Admin saja; tidak pernah ada di `/v1/public/*` (kontrak §4). */
  notes: z.string().nullable(),
  checkedBy: userRefSchema.nullable(),
  checkedAt: z.iso.datetime().nullable(),
});
export type AdminQcCheck = z.infer<typeof adminQcCheckSchema>;

/** Baris tabel produk admin (kontrak §5.6). */
export const adminProductRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  sku: z.string().nullable(),
  primaryImage: mediaRefSchema.nullable(),
  category: adminRefSchema,
  primaryMaterial: adminRefSchema.nullable(),
  artisan: adminProductArtisanRefSchema.nullable(),
  publishStatus: publishStatusSchema,
  /** Status **efektif** yang sudah dihitung server (§6.3 Q13). */
  stockStatus: stockStatusSchema,
  stockQuantity: z.int().nullable(),
  moqUnit: z.string(),
  leadTimeDays: z.int().nullable(),
  revision: z.int(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type AdminProductRow = z.infer<typeof adminProductRowSchema>;

/**
 * Kesiapan terbit untuk tombol "Terbitkan" (kontrak §5.6). `missing` memakai
 * path field yang sama dengan `details` pada `422
 * PUBLISH_REQUIREMENTS_NOT_MET`, jadi UI tidak perlu dua pemetaan.
 */
export const publishReadinessSchema = z.object({
  ready: z.boolean(),
  missing: z.array(z.string()),
});
export type PublishReadiness = z.infer<typeof publishReadinessSchema>;

export const adminProductSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  sku: z.string().nullable(),
  description: richTextSchema.nullable(),
  excerpt: z.string().nullable(),
  category: adminRefSchema.extend({ slug: z.string() }),
  artisan: adminProductArtisanRefSchema
    .extend({ archivedAt: z.iso.datetime().nullable() })
    .nullable(),
  materials: z.array(adminRefSchema.extend({ slug: z.string(), isPrimary: z.boolean() })),
  tags: z.array(adminRefSchema.extend({ slug: z.string() })),
  moqQuantity: z.int(),
  moqUnit: z.string(),
  leadTimeDays: z.int().nullable(),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  fobPriceUsd: z.string().nullable(),
  fobPort: z.string().nullable(),
  publishStatus: publishStatusSchema,
  publishedAt: z.iso.datetime().nullable(),
  revision: z.int(),
  /** Turunan (§6.3 Q13); tidak pernah dikirim klien. */
  stockStatus: stockStatusSchema,
  stockQuantity: z.int().nullable(),
  /** 🔒 */
  stockStatusOverride: stockStatusSchema.nullable(),
  /** 🔒 */
  lowStockThreshold: z.int().nullable(),
  /** `lowStockThreshold ?? SiteSetting.lowStockThreshold`. */
  effectiveLowStockThreshold: z.int(),
  /** 🔒 */
  stockNote: z.string().nullable(),
  primaryImage: mediaRefSchema.nullable(),
  images: z.array(mediaRefSchema),
  specs: z.array(
    z.object({ id: z.uuid(), label: z.string(), value: z.string(), position: z.int() }),
  ),
  qcChecks: z.array(adminQcCheckSchema),
  duplicatedFromId: z.uuid().nullable(),
  createdBy: userRefSchema.nullable(),
  updatedBy: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  publishReadiness: publishReadinessSchema,
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

// ── Aksi (kontrak §5.6) ──────────────────────────────────────────────────────

/**
 * Body `POST /publish`. `expectedRevision` opsional: menerbitkan tanpa
 * mengubah isi tidak berisiko menimpa tulisan orang lain, tetapi UI boleh
 * mengirimkannya untuk memastikan yang diterbitkan adalah yang dilihat.
 */
export const publishProductBodySchema = z
  .strictObject({ expectedRevision: z.int().min(1).optional() })
  .default({});
export type PublishProductBody = z.infer<typeof publishProductBodySchema>;

export const PRODUCT_BULK_ACTIONS = [
  'PUBLISH',
  'UNPUBLISH',
  'TRASH',
  'RESTORE',
  'PURGE',
  'SET_STOCK_OVERRIDE',
] as const;
export const productBulkActionSchema = z.enum(PRODUCT_BULK_ACTIONS);
export type ProductBulkAction = z.infer<typeof productBulkActionSchema>;

export const productBulkBodySchema = z
  .strictObject({
    action: productBulkActionSchema,
    ids: z.array(z.uuid()).min(1).max(BULK_IDS_MAX),
    /** Wajib **ada** untuk `SET_STOCK_OVERRIDE`; `null` = kembali otomatis. */
    stockStatusOverride: stockStatusSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'SET_STOCK_OVERRIDE' && value.stockStatusOverride === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['stockStatusOverride'],
        message: 'Aksi SET_STOCK_OVERRIDE membutuhkan stockStatusOverride (boleh null).',
        params: { code: 'required' },
      });
    }
    if (new Set(value.ids).size !== value.ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids tidak boleh memuat id yang sama dua kali.',
        params: { code: 'duplicate_id' },
      });
    }
  });
export type ProductBulkBody = z.infer<typeof productBulkBodySchema>;

/** `POST /v1/admin/products/sku-suggestions` (kontrak §5.6). */
export const skuSuggestionBodySchema = z
  .strictObject({ materialId: z.uuid().nullable().optional() })
  .default({});
export type SkuSuggestionBody = z.infer<typeof skuSuggestionBodySchema>;

/** `PATCH /v1/admin/products/:id/qc/:stage`. */
export const productQcParamsSchema = z.object({ id: z.uuid(), stage: qcStageSchema });
export const updateProductQcBodySchema = z
  .strictObject({
    status: qcStatusSchema.optional(),
    criteria: z.string().trim().max(PRODUCT_QC_CRITERIA_MAX).nullable().optional(),
    notes: z.string().trim().max(PRODUCT_QC_NOTES_MAX).nullable().optional(),
  })
  .refine(
    (body) => body.status !== undefined || body.criteria !== undefined || body.notes !== undefined,
    { error: 'Kirim minimal satu field yang ingin diubah.', params: { code: 'empty_patch' } },
  );
export type UpdateProductQcBody = z.infer<typeof updateProductQcBodySchema>;

/** `GET /v1/admin/products/:id/revisions`. */
export const productRevisionSummarySchema = z.object({
  number: z.int(),
  editedBy: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ProductRevisionSummary = z.infer<typeof productRevisionSummarySchema>;

export const productRevisionDetailSchema = productRevisionSummarySchema.extend({
  /** Isi produk pada revisi itu; bentuknya `AdminProduct` saat snapshot dibuat. */
  snapshot: z.json(),
});
export type ProductRevisionDetail = z.infer<typeof productRevisionDetailSchema>;

export const productRevisionParamsSchema = z.object({
  id: z.uuid(),
  number: z.coerce.number().int().min(1),
});

// ── Respons ──────────────────────────────────────────────────────────────────

export const adminProductsResponseSchema = dataMetaEnvelope(
  z.array(adminProductRowSchema),
  pageMetaSchema,
);
export type AdminProductsResponse = z.infer<typeof adminProductsResponseSchema>;

export const adminProductResponseSchema = dataEnvelope(adminProductSchema);
export type AdminProductResponse = z.infer<typeof adminProductResponseSchema>;

export const adminQcCheckResponseSchema = dataEnvelope(adminQcCheckSchema);
export const productTrashedResponseSchema = dataEnvelope(
  z.object({ id: z.uuid(), deletedAt: z.iso.datetime() }),
);
export const productBulkResponseSchema = dataEnvelope(bulkResultSchema);
export const skuSuggestionResponseSchema = dataEnvelope(z.object({ sku: z.string() }));
export const productRevisionsResponseSchema = dataEnvelope(z.array(productRevisionSummarySchema));
export const productRevisionResponseSchema = dataEnvelope(productRevisionDetailSchema);

// ── Aturan domain ────────────────────────────────────────────────────────────

/**
 * Path field yang wajib terisi sebelum produk boleh terbit (model §6.3).
 * Dipakai dua kali: `details` pada `422 PUBLISH_REQUIREMENTS_NOT_MET` dan
 * `publishReadiness.missing` di `AdminProduct`.
 */
export const PRODUCT_PUBLISH_REQUIREMENT_PATHS = [
  'name',
  'sku',
  'categoryId',
  'artisanId',
  'primaryImageId',
  'materials',
  'moqQuantity',
] as const;
export type ProductPublishRequirementPath = (typeof PRODUCT_PUBLISH_REQUIREMENT_PATHS)[number];

/** `details[].code` pada `422 PUBLISH_REQUIREMENTS_NOT_MET` (kontrak §1.10). */
export const PUBLISH_REQUIREMENT_CODES = {
  /** Field kosong. */
  REQUIRED: 'required',
  /** Pengrajin yang dipilih sudah diarsipkan (model §6.3). */
  ARTISAN_ARCHIVED: 'artisan_archived',
  /** Media yang dipakai konten terbit belum punya `alt` (model §6.6). */
  ALT_REQUIRED: 'alt_required',
} as const;

/** `details.rule` pada `422 BUSINESS_RULE_VIOLATION` di §5.6. */
export const PRODUCT_BUSINESS_RULES = {
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  ARTISAN_NOT_FOUND: 'ARTISAN_NOT_FOUND',
  MATERIAL_NOT_FOUND: 'MATERIAL_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  PRIVATE_MEDIA_NOT_ALLOWED: 'PRIVATE_MEDIA_NOT_ALLOWED',
} as const;
export type ProductBusinessRule =
  (typeof PRODUCT_BUSINESS_RULES)[keyof typeof PRODUCT_BUSINESS_RULES];

/** `details.reason` pada `403 FORBIDDEN` kepemilikan/status (kontrak §2.4). */
export const FORBIDDEN_REASONS = {
  NOT_OWNER: 'NOT_OWNER',
  NOT_DRAFT: 'NOT_DRAFT',
  /**
   * Tag baru hanya boleh dibuat peran ber-`taxonomy.write` (kontrak §3.1):
   * tabel `Tag` dipakai bersama produk dan artikel, jadi menambah baris di
   * situ adalah menulis taksonomi, bukan menulis draf sendiri.
   * `details.unknownTags` menyebut nama yang belum ada agar UI bisa memintanya
   * ke Editor alih-alih hanya menolak.
   */
  TAG_NOT_FOUND: 'TAG_NOT_FOUND',
} as const;
export type ForbiddenReason = (typeof FORBIDDEN_REASONS)[keyof typeof FORBIDDEN_REASONS];

// ── Status stok turunan (model §6.3, Q13) ────────────────────────────────────

export interface StockStatusInput {
  /** 🔒 Override manual; `null` = otomatis. */
  stockStatusOverride: StockStatus | null;
  stockQuantity: number | null;
  /** `Product.lowStockThreshold ?? SiteSetting.lowStockThreshold`. */
  effectiveLowStockThreshold: number;
}

/**
 * Status stok **efektif** (model §6.3 Q13). Ditaruh di `@ornament/shared`
 * karena aturannya ikut kontrak (nilai yang tampil publik), dan supaya tes
 * kontrak bisa memverifikasinya tanpa database.
 */
export function deriveStockStatus(input: StockStatusInput): StockStatus {
  if (input.stockStatusOverride !== null) return input.stockStatusOverride;
  if (input.stockQuantity === null) return 'MADE_TO_ORDER';
  return input.stockQuantity <= input.effectiveLowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK';
}

/**
 * Validasi stok A11: **hanya** status efektif `MADE_TO_ORDER` yang mewajibkan
 * `stockQuantity = null`. Override `IN_STOCK` dengan jumlah 0 tetap boleh.
 */
export function stockQuantityConflictsWithStatus(input: StockStatusInput): boolean {
  return deriveStockStatus(input) === 'MADE_TO_ORDER' && input.stockQuantity !== null;
}
