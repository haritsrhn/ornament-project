import { z } from 'zod';

import { mediaRefSchema } from './auth.js';
import {
  booleanFlagSchema,
  expectedUpdatedAtSchema,
  searchQuerySchema,
  slugInputSchema,
} from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { artisanDocumentKindSchema, artisanStatusSchema } from './enums.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { richTextSchema } from './rich-text.js';
import { userRefSchema } from './users.js';

/**
 * Kontrak admin pengrajin — kontrak API §5.8 (`/v1/admin/artisans/*`).
 *
 * Hanya bentuk data: tanpa dependensi server dan tanpa tipe Prisma (ADR K6).
 *
 * ── Dua DTO, bukan satu dengan `null` ────────────────────────────────────────
 * Pengrajin adalah satu-satunya resource yang DTO admin-nya **bercabang per
 * peran** (kontrak §3.1): Editor+ menerima `AdminArtisan` lengkap, Contributor
 * menerima `ArtisanRedacted` — field 🔒 (`contactName`, `phone`, `address`,
 * `internalNotes`) **tidak ada**, bukan bernilai `null`. Bedanya penting:
 * `null` berarti "kosong" dan akan membuat UI Contributor menampilkan field
 * telepon yang seolah belum diisi, sementara yang benar adalah "bukan urusan
 * Anda". Dokumen pengrajin tidak punya tempat di kedua DTO ini sama sekali.
 */

// ── Batas `ArtisanInput` (kontrak §5.8) ──────────────────────────────────────

export const ARTISAN_NAME_MAX = 120;
export const ARTISAN_CONTACT_NAME_MAX = 120;
export const ARTISAN_PLACE_MAX = 100;
export const ARTISAN_ADDRESS_MAX = 500;
export const ARTISAN_SUMMARY_MAX = 300;
export const ARTISAN_INTERNAL_NOTES_MAX = 2000;
export const ARTISAN_CAPACITY_UNIT_MAX = 16;
export const ARTISAN_SKILLS_MAX = 20;
export const ARTISAN_SKILL_MAX = 60;
export const ARTISAN_IMAGES_MAX = 20;
export const ARTISAN_IMAGE_CAPTION_MAX = 200;

/** Tahun kemitraan paling awal yang masuk akal (kontrak §5.8: 1950–tahun ini). */
export const ARTISAN_PARTNER_SINCE_MIN_YEAR = 1950;

/**
 * 🔒 Telepon E.164 (`+` diikuti 8–15 digit, digit pertama bukan 0). Spasi dan
 * tanda hubung dibuang lebih dulu supaya `+62 812-3456-789` yang diketik
 * manusia tidak menjadi kegagalan validasi.
 */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const artisanPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(E164_PATTERN, 'Nomor telepon harus format E.164, mis. +62812345678.'));

export const artisanImageInputSchema = z.strictObject({
  mediaId: z.uuid(),
  caption: z.string().trim().max(ARTISAN_IMAGE_CAPTION_MAX).nullish(),
});
export type ArtisanImageInput = z.infer<typeof artisanImageInputSchema>;

/**
 * Bentuk `ArtisanInput` sebagai *shape* terpisah agar varian `POST` (wajib) dan
 * `PATCH` (parsial + `status` + `expectedUpdatedAt`) lahir dari satu definisi.
 */
const artisanInputShape = {
  name: z.string().trim().min(1, 'Nama pengrajin wajib diisi.').max(ARTISAN_NAME_MAX),
  slug: slugInputSchema.optional(),
  /** 🔒 */
  contactName: z.string().trim().max(ARTISAN_CONTACT_NAME_MAX).nullish(),
  /** 🔒 */
  phone: artisanPhoneSchema.nullish(),
  partnerSinceYear: z
    .int()
    .min(ARTISAN_PARTNER_SINCE_MIN_YEAR)
    .max(new Date().getUTCFullYear() + 1)
    .nullish(),
  village: z.string().trim().max(ARTISAN_PLACE_MAX).nullish(),
  regency: z.string().trim().min(1, 'Kabupaten wajib diisi.').max(ARTISAN_PLACE_MAX),
  province: z.string().trim().min(1, 'Provinsi wajib diisi.').max(ARTISAN_PLACE_MAX),
  /** 🔒 */
  address: z.string().trim().max(ARTISAN_ADDRESS_MAX).nullish(),
  craftsmenCount: z.int().min(0).max(100_000).nullish(),
  monthlyCapacity: z.int().min(0).max(10_000_000).nullish(),
  capacityUnit: z.string().trim().min(1).max(ARTISAN_CAPACITY_UNIT_MAX).optional(),
  avgLeadTimeDays: z.int().min(0).max(3650).nullish(),
  skills: z
    .array(z.string().trim().min(1).max(ARTISAN_SKILL_MAX))
    .min(1, 'Isi minimal satu keahlian.')
    .max(ARTISAN_SKILLS_MAX),
  summary: z.string().trim().max(ARTISAN_SUMMARY_MAX).nullish(),
  story: richTextSchema.nullish(),
  /** 🔒 */
  internalNotes: z.string().trim().max(ARTISAN_INTERNAL_NOTES_MAX).nullish(),
  photoId: z.uuid().nullish(),
  /** Mengganti seluruh galeri bila dikirim (kontrak §1.3); urutan = `position`. */
  images: z.array(artisanImageInputSchema).max(ARTISAN_IMAGES_MAX).optional(),
} as const;

/** Field 🔒 yang dibuang dari `ArtisanRedacted` (kontrak §5.8, §3.1). */
export const ARTISAN_PRIVATE_FIELDS = ['contactName', 'phone', 'address', 'internalNotes'] as const;
export type ArtisanPrivateField = (typeof ARTISAN_PRIVATE_FIELDS)[number];

/** Galeri tidak boleh memuat media yang sama dua kali. */
function checkArtisanInput(
  value: { images?: { mediaId: string }[] | undefined },
  ctx: z.RefinementCtx,
): void {
  const images = value.images;
  if (images === undefined) return;
  const ids = new Set(images.map((image) => image.mediaId));
  if (ids.size !== images.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['images'],
      message: 'Galeri tidak boleh memuat media yang sama dua kali.',
      params: { code: 'duplicate_image' },
    });
  }
}

/** `POST /v1/admin/artisans` (kontrak §5.8); `status` selalu `VERIFICATION`. */
export const artisanInputSchema = z.strictObject(artisanInputShape).superRefine(checkArtisanInput);
export type ArtisanInput = z.infer<typeof artisanInputSchema>;
export type ArtisanInputRaw = z.input<typeof artisanInputSchema>;

/** `PATCH /v1/admin/artisans/:id` — `expectedUpdatedAt` wajib (kontrak §1.9). */
export const updateArtisanBodySchema = z
  .strictObject(artisanInputShape)
  .partial()
  .extend({
    status: artisanStatusSchema.optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .superRefine(checkArtisanInput);
export type UpdateArtisanBody = z.infer<typeof updateArtisanBodySchema>;

// ── Query daftar (kontrak §5.8) ──────────────────────────────────────────────

/** Allowlist sort §1.7; tie-breaker `id` ditambahkan server. */
export const ADMIN_ARTISAN_SORTS = ['name', '-updatedAt', '-monthlyCapacity'] as const;
export const adminArtisanSortSchema = z.enum(ADMIN_ARTISAN_SORTS);
export type AdminArtisanSort = z.infer<typeof adminArtisanSortSchema>;

export const adminArtisansQuerySchema = pageQuerySchema.extend({
  status: artisanStatusSchema.optional(),
  regency: z.string().trim().min(1).max(ARTISAN_PLACE_MAX).optional(),
  /** `true` = **hanya** yang diarsipkan (§1.7, pola sama dengan `trashed`). */
  archived: booleanFlagSchema(false),
  /** ILIKE pada `name`, `village`, `regency`, dan elemen `skills`. */
  q: searchQuerySchema.optional(),
  sort: adminArtisanSortSchema.default('name'),
});
export type AdminArtisansQuery = z.infer<typeof adminArtisansQuerySchema>;

export const artisanIdParamsSchema = z.object({ id: z.uuid() });
export type ArtisanIdParams = z.infer<typeof artisanIdParamsSchema>;

export const artisanDocumentParamsSchema = z.object({ id: z.uuid(), documentId: z.uuid() });
export type ArtisanDocumentParams = z.infer<typeof artisanDocumentParamsSchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

export const adminArtisanRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  village: z.string().nullable(),
  regency: z.string(),
  province: z.string(),
  skills: z.array(z.string()),
  status: artisanStatusSchema,
  monthlyCapacity: z.int().nullable(),
  capacityUnit: z.string(),
  photo: mediaRefSchema.nullable(),
  /** Semua `publishStatus`, di luar Trash — konsisten dengan hitungan admin lain. */
  productCount: z.int(),
  archivedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type AdminArtisanRow = z.infer<typeof adminArtisanRowSchema>;

export const adminArtisanImageSchema = mediaRefSchema.extend({
  caption: z.string().nullable(),
});
export type AdminArtisanImage = z.infer<typeof adminArtisanImageSchema>;

/**
 * Bagian DTO yang **boleh dilihat semua peran** (kontrak §3.1 "Mengelola
 * pengrajin: CTR = Lihat"). `ArtisanRedacted` persis skema ini.
 */
export const artisanRedactedSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  partnerSinceYear: z.int().nullable(),
  village: z.string().nullable(),
  regency: z.string(),
  province: z.string(),
  craftsmenCount: z.int().nullable(),
  monthlyCapacity: z.int().nullable(),
  capacityUnit: z.string(),
  avgLeadTimeDays: z.int().nullable(),
  skills: z.array(z.string()),
  summary: z.string().nullable(),
  story: richTextSchema.nullable(),
  status: artisanStatusSchema,
  archivedAt: z.iso.datetime().nullable(),
  photo: mediaRefSchema.nullable(),
  images: z.array(adminArtisanImageSchema),
  productCount: z.int(),
  publishedProductCount: z.int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ArtisanRedacted = z.infer<typeof artisanRedactedSchema>;

/** Editor+ saja: `ArtisanRedacted` + empat field 🔒 (kontrak §4/§5.8). */
export const adminArtisanSchema = artisanRedactedSchema.extend({
  /** 🔒 */
  contactName: z.string().nullable(),
  /** 🔒 */
  phone: z.string().nullable(),
  /** 🔒 */
  address: z.string().nullable(),
  /** 🔒 */
  internalNotes: z.string().nullable(),
});
export type AdminArtisan = z.infer<typeof adminArtisanSchema>;

/**
 * Respons `GET /v1/admin/artisans/:id`: bentuknya bergantung peran, jadi
 * skema responsnya union — bukan `AdminArtisan` dengan field opsional, yang
 * akan membuat Fastify meloloskan field 🔒 untuk Contributor.
 */
export const adminArtisanDetailSchema = z.union([adminArtisanSchema, artisanRedactedSchema]);
export type AdminArtisanDetail = z.infer<typeof adminArtisanDetailSchema>;

/**
 * Peringatan arsip (A10): mengarsipkan pengrajin yang masih punya produk terbit
 * **tidak ditolak**. Produknya tetap tayang; yang hilang hanya profil
 * publiknya (model §6.7), jadi kontrak memilih memberi tahu, bukan memblokir.
 */
export const ARTISAN_ARCHIVE_WARNINGS = {
  HAS_PUBLISHED_PRODUCTS: 'HAS_PUBLISHED_PRODUCTS',
} as const;

export const artisanArchiveWarningSchema = z.object({
  code: z.literal(ARTISAN_ARCHIVE_WARNINGS.HAS_PUBLISHED_PRODUCTS),
  count: z.int(),
});
export type ArtisanArchiveWarning = z.infer<typeof artisanArchiveWarningSchema>;

export const artisanArchivedSchema = adminArtisanSchema.extend({
  warnings: z.array(artisanArchiveWarningSchema),
});
export type ArtisanArchived = z.infer<typeof artisanArchivedSchema>;

// ── Dokumen 🔒 (kontrak §5.8, model §3.4) ────────────────────────────────────

export const ARTISAN_DOCUMENT_TITLE_MAX = 120;

export const artisanDocumentInputSchema = z.strictObject({
  /** Media `PRIVATE` yang sudah dikonfirmasi (kontrak §5.12). */
  mediaId: z.uuid(),
  kind: artisanDocumentKindSchema,
  title: z.string().trim().min(1, 'Judul dokumen wajib diisi.').max(ARTISAN_DOCUMENT_TITLE_MAX),
});
export type ArtisanDocumentInput = z.infer<typeof artisanDocumentInputSchema>;

/** Hanya metadata yang bisa diubah; berkasnya diganti dengan dokumen baru. */
export const updateArtisanDocumentBodySchema = z
  .strictObject({
    kind: artisanDocumentKindSchema.optional(),
    title: z.string().trim().min(1).max(ARTISAN_DOCUMENT_TITLE_MAX).optional(),
  })
  .refine((body) => body.kind !== undefined || body.title !== undefined, {
    error: 'Kirim minimal satu field yang ingin diubah.',
    params: { code: 'empty_patch' },
  });
export type UpdateArtisanDocumentBody = z.infer<typeof updateArtisanDocumentBodySchema>;

/**
 * DTO dokumen. `media` sengaja **bukan** `MediaRef`: `MediaRef.url` menunjuk
 * domain publik R2, dan dokumen ini `PRIVATE` — URL-nya hanya lahir sebagai
 * presigned GET berdurasi pendek lewat endpoint `/url` (kontrak §5.12).
 */
export const artisanDocumentMediaSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});

export const artisanDocumentSchema = z.object({
  id: z.uuid(),
  kind: artisanDocumentKindSchema,
  title: z.string(),
  media: artisanDocumentMediaSchema,
  uploadedBy: userRefSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type ArtisanDocumentDto = z.infer<typeof artisanDocumentSchema>;

/** `GET .../documents/:documentId/url` — presigned GET 5 menit (kontrak §5.12). */
export const ARTISAN_DOCUMENT_URL_TTL_SECONDS = 5 * 60;

export const artisanDocumentUrlQuerySchema = z.object({
  /** `Content-Disposition: attachment` pada URL yang ditandatangani. */
  download: booleanFlagSchema(false),
});
export type ArtisanDocumentUrlQuery = z.infer<typeof artisanDocumentUrlQuerySchema>;

export const artisanDocumentUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type ArtisanDocumentUrl = z.infer<typeof artisanDocumentUrlSchema>;

// ── Aturan domain ────────────────────────────────────────────────────────────

/** `details.rule` pada `422 BUSINESS_RULE_VIOLATION` di §5.8. */
export const ARTISAN_BUSINESS_RULES = {
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  /** Foto & galeri pengrajin tampil publik, jadi medianya harus `PUBLIC`. */
  PRIVATE_MEDIA_NOT_ALLOWED: 'PRIVATE_MEDIA_NOT_ALLOWED',
  /** Kebalikannya untuk dokumen: berkas 🔒 wajib Media `PRIVATE`. */
  MEDIA_NOT_PRIVATE: 'MEDIA_NOT_PRIVATE',
  /** Media itu sudah dipakai sebagai dokumen pengrajin lain. */
  MEDIA_ALREADY_USED: 'MEDIA_ALREADY_USED',
} as const;
export type ArtisanBusinessRule =
  (typeof ARTISAN_BUSINESS_RULES)[keyof typeof ARTISAN_BUSINESS_RULES];

// ── Respons ──────────────────────────────────────────────────────────────────

export const adminArtisansResponseSchema = dataMetaEnvelope(
  z.array(adminArtisanRowSchema),
  pageMetaSchema,
);
export const adminArtisanResponseSchema = dataEnvelope(adminArtisanSchema);
export const adminArtisanDetailResponseSchema = dataEnvelope(adminArtisanDetailSchema);
export const artisanArchivedResponseSchema = dataEnvelope(artisanArchivedSchema);
export const artisanDocumentsResponseSchema = dataEnvelope(z.array(artisanDocumentSchema));
export const artisanDocumentResponseSchema = dataEnvelope(artisanDocumentSchema);
export const artisanDocumentUrlResponseSchema = dataEnvelope(artisanDocumentUrlSchema);
