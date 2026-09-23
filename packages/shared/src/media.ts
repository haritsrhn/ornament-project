import { z } from 'zod';

import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { userRefSchema } from './users.js';
import { mediaKindSchema, mediaVisibilitySchema, type MediaVisibility } from './enums.js';
import { searchQuerySchema } from './common.js';
import { pageMetaSchema } from './pagination.js';

/**
 * Media Library admin (kontrak §5.12, model §3.2). Alur unggah ADR K3 punya
 * tiga langkah: minta presigned `PUT` → klien unggah langsung ke R2 →
 * konfirmasi ke server. Berkas karena itu tidak pernah melewati API, dan
 * batas ukuran ditegakkan dua kali: di sini saat presign diminta, dan lagi
 * lewat `HeadObject` saat konfirmasi (klien bisa saja mengunggah yang lain).
 */

// ── Allowlist unggah ─────────────────────────────────────────────────────────

const MB = 1024 * 1024;

/**
 * Satu-satunya sumber tipe berkas yang boleh masuk (kontrak §5.12).
 *
 * Dipisah per `visibility` dengan sengaja: berkas publik disajikan apa adanya
 * dari domain media, jadi daftarnya hanya format yang aman ditampilkan browser;
 * sementara berkas privat adalah dokumen yang diunggah staf, tidak pernah
 * punya URL permanen, dan batas ukurannya lebih ketat.
 */
export const MEDIA_UPLOAD_ALLOWLIST = {
  PUBLIC: {
    'image/jpeg': 10 * MB,
    'image/png': 10 * MB,
    'image/webp': 10 * MB,
    'application/pdf': 20 * MB,
  },
  PRIVATE: {
    'application/pdf': 10 * MB,
    'image/jpeg': 10 * MB,
    'image/png': 10 * MB,
  },
} as const satisfies Record<MediaVisibility, Readonly<Record<string, number>>>;

/**
 * Batas ukuran untuk kombinasi tipe dan visibilitas, atau `null` bila MIME-nya
 * tidak diizinkan.
 *
 * `Object.hasOwn` dipakai, bukan lookup biasa: MIME datang dari klien, dan
 * `allowed['constructor']` pada objek literal mengembalikan fungsi dari
 * prototipe — bukan `undefined` — sehingga lookup naif meloloskan tipe yang
 * tidak ada di allowlist.
 */
export function mediaSizeLimit(visibility: MediaVisibility, mimeType: string): number | null {
  const allowed: Readonly<Record<string, number>> = MEDIA_UPLOAD_ALLOWLIST[visibility];
  if (!Object.hasOwn(allowed, mimeType)) return null;
  const limit = allowed[mimeType];
  return typeof limit === 'number' ? limit : null;
}

/** MIME yang diizinkan untuk sebuah visibilitas, urut stabil (dipakai pesan error dan UI). */
export function allowedMimeTypes(visibility: MediaVisibility): string[] {
  return Object.keys(MEDIA_UPLOAD_ALLOWLIST[visibility]);
}

/**
 * `kind` diturunkan dari MIME, tidak pernah dikirim klien (model §3.2). PDF
 * adalah satu-satunya non-gambar di allowlist, jadi aturannya cukup sederhana.
 */
export function mediaKindForMime(mimeType: string): 'IMAGE' | 'DOCUMENT' {
  return mimeType.startsWith('image/') ? 'IMAGE' : 'DOCUMENT';
}

// ── DTO ──────────────────────────────────────────────────────────────────────

export const MEDIA_FILE_NAME_MAX = 200;
export const MEDIA_ALT_MAX = 300;

/** Nama berkas asli: dipakai pencarian dan unduhan, bukan bagian dari key R2. */
export const mediaFileNameSchema = z.string().trim().min(1).max(MEDIA_FILE_NAME_MAX);

/** `alt` wajib sebelum media dipakai konten terbit — validasinya di API, bukan di sini. */
export const mediaAltSchema = z.string().trim().max(MEDIA_ALT_MAX);

/**
 * Tempat sebuah media dipakai. Dikembalikan pada detail dan pada `409 IN_USE`
 * supaya admin tahu apa yang harus dilepas lebih dulu, bukan sekadar ditolak.
 */
export const MEDIA_USAGE_ENTITY_TYPES = [
  'Product',
  'ProductImage',
  'Artisan',
  'ArtisanImage',
  'ArtisanDocument',
  'Article',
  'PageBlock',
  'SiteSetting',
  'InquiryAttachment',
] as const;
export const mediaUsageEntityTypeSchema = z.enum(MEDIA_USAGE_ENTITY_TYPES);
export type MediaUsageEntityType = z.infer<typeof mediaUsageEntityTypeSchema>;

export const mediaUsageSchema = z.object({
  entityType: mediaUsageEntityTypeSchema,
  /**
   * Sengaja `string`, bukan `uuid`: `SiteSetting` adalah baris tunggal
   * ber-`id` integer `1` (model §3.8), jadi satu-satunya pemakai yang id-nya
   * bukan UUID justru yang paling penting tidak boleh hilang dari daftar.
   */
  entityId: z.string(),
  /** Judul/nama entitas pemakai, untuk ditampilkan tanpa query kedua. */
  label: z.string(),
  /** Kolom atau relasi yang merujuk, mis. `primaryImageId`, `content[2]`. */
  field: z.string(),
  /** Hanya pemakaian **terbit** yang menghalangi pemindahan ke Trash (model §5). */
  isPublished: z.boolean(),
});
export type MediaUsage = z.infer<typeof mediaUsageSchema>;

/**
 * `url` null untuk media `PRIVATE`: berkas privat tidak punya URL permanen,
 * dan `GET /:id/url` adalah satu-satunya jalan membukanya. Null juga bila
 * `R2_PUBLIC_URL` belum dikonfigurasi, dengan alasan yang sama seperti
 * `PublicMedia` — lebih baik kosong daripada URL karangan.
 */
export const adminMediaSchema = z.object({
  id: z.uuid(),
  kind: mediaKindSchema,
  visibility: mediaVisibilitySchema,
  url: z.string().nullable(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
  width: z.int().nullable(),
  height: z.int().nullable(),
  alt: z.string().nullable(),
  uploadedBy: userRefSchema.nullable(),
  usageCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type AdminMedia = z.infer<typeof adminMediaSchema>;

export const adminMediaDetailSchema = adminMediaSchema.extend({
  usages: z.array(mediaUsageSchema),
});
export type AdminMediaDetail = z.infer<typeof adminMediaDetailSchema>;

// ── Unggah: presign lalu konfirmasi ──────────────────────────────────────────

/** Masa berlaku presigned `PUT` (kontrak §5.12): cukup untuk unggahan lambat, tidak lebih. */
export const MEDIA_UPLOAD_TTL_SECONDS = 10 * 60;

/** Masa berlaku presigned `GET` berkas privat (kontrak §5.12). */
export const MEDIA_DOWNLOAD_TTL_SECONDS = 5 * 60;

export const mediaUploadRequestSchema = z.strictObject({
  fileName: mediaFileNameSchema,
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  visibility: mediaVisibilitySchema.default('PUBLIC'),
});
export type MediaUploadRequest = z.infer<typeof mediaUploadRequestSchema>;

/**
 * `uploadId` adalah token bertanda tangan HMAC berisi key, MIME, ukuran,
 * visibilitas, pengunggah, dan kedaluwarsa (kontrak §5.12) — sehingga server
 * tidak perlu tabel unggahan sementara yang harus dibersihkan.
 */
export const mediaUploadTicketSchema = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.object({
    'Content-Type': z.string(),
    'Content-Length': z.string(),
  }),
  key: z.string(),
  expiresAt: z.iso.datetime(),
});
export type MediaUploadTicket = z.infer<typeof mediaUploadTicketSchema>;

export const mediaConfirmSchema = z.strictObject({
  uploadId: z.string().min(1),
  alt: mediaAltSchema.nullish(),
});
export type MediaConfirmInput = z.infer<typeof mediaConfirmSchema>;

/** Alasan `422 UPLOAD_INVALID` (kontrak §5.12), dikirim di `details.reason`. */
export const UPLOAD_INVALID_REASONS = {
  NOT_FOUND: 'NOT_FOUND',
  MISMATCH: 'MISMATCH',
  EXPIRED: 'EXPIRED',
} as const;
export type UploadInvalidReason =
  (typeof UPLOAD_INVALID_REASONS)[keyof typeof UPLOAD_INVALID_REASONS];

// ── Daftar ───────────────────────────────────────────────────────────────────

export const MEDIA_PAGE_SIZE_DEFAULT = 40;

export const MEDIA_SORTS = ['-createdAt', 'fileName', '-sizeBytes'] as const;
export const mediaSortSchema = z.enum(MEDIA_SORTS);
export type MediaSort = z.infer<typeof mediaSortSchema>;

/** Filter bulan `YYYY-MM` (model §3.2: `createdAt` diindeks untuk ini). */
export const MEDIA_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const mediaMonthSchema = z
  .string()
  .regex(MEDIA_MONTH_PATTERN, 'Bulan harus berformat YYYY-MM.');

const booleanQuerySchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);

export const mediaListQuerySchema = z.object({
  kind: mediaKindSchema.optional(),
  visibility: mediaVisibilitySchema.optional(),
  month: mediaMonthSchema.optional(),
  uploadedById: z.uuid().optional(),
  /** Hanya media yang belum dirujuk apa pun — pintu masuk pembersihan. */
  unused: booleanQuerySchema.optional(),
  trashed: booleanQuerySchema.optional(),
  q: searchQuerySchema.optional(),
  sort: mediaSortSchema.default('-createdAt'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(MEDIA_PAGE_SIZE_DEFAULT),
});
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>;

/**
 * `totalSizeBytes` dihitung atas seluruh hasil filter, bukan halaman ini:
 * angka "terpakai" yang hanya menghitung 40 baris pertama tidak ada gunanya.
 * `months` adalah bulan yang punya media, untuk mengisi dropdown filter.
 */
export const mediaListMetaSchema = pageMetaSchema.extend({
  totalSizeBytes: z.number().int().min(0),
  months: z.array(z.string()),
});
export type MediaListMeta = z.infer<typeof mediaListMetaSchema>;

// ── Ubah, buka, hapus ────────────────────────────────────────────────────────

export const mediaPatchSchema = z
  .strictObject({
    alt: mediaAltSchema.nullish(),
    fileName: mediaFileNameSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Tidak ada perubahan yang dikirim.');
export type MediaPatchInput = z.infer<typeof mediaPatchSchema>;

export const mediaUrlQuerySchema = z.object({
  /** `true` menambahkan `Content-Disposition: attachment` pada URL bertanda tangan. */
  download: booleanQuerySchema.optional(),
});

/** `expiresAt` null untuk media `PUBLIC`: URL-nya permanen, bukan bertanda tangan. */
export const mediaUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime().nullable(),
});
export type MediaUrl = z.infer<typeof mediaUrlSchema>;

export const mediaTrashedSchema = z.object({
  id: z.uuid(),
  deletedAt: z.iso.datetime(),
});
export type MediaTrashed = z.infer<typeof mediaTrashedSchema>;

// ── Envelope respons (kontrak §1.4) ──────────────────────────────────────────

export const mediaIdParamsSchema = z.object({ id: z.uuid() });
export type MediaIdParams = z.infer<typeof mediaIdParamsSchema>;

export const mediaUploadTicketResponseSchema = dataEnvelope(mediaUploadTicketSchema);
export const adminMediaResponseSchema = dataEnvelope(adminMediaSchema);
export const adminMediaDetailResponseSchema = dataEnvelope(adminMediaDetailSchema);
export const adminMediaListResponseSchema = dataMetaEnvelope(
  z.array(adminMediaSchema),
  mediaListMetaSchema,
);
export const mediaUrlResponseSchema = dataEnvelope(mediaUrlSchema);
export const mediaTrashedResponseSchema = dataEnvelope(mediaTrashedSchema);
