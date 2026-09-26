import { z } from 'zod';

import { searchQuerySchema } from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { inquiryStatusSchema, replyStatusSchema, type InquiryStatus } from './enums.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { userRefSchema } from './users.js';

/**
 * Inbox inquiry — kontrak API §5.11, model §3.7 & §6.5.
 *
 * Contributor tidak punya akses (§3.1): inquiry adalah data pembeli, bukan
 * konten. Semua rute Editor+, kecuali anonimisasi yang Administrator saja
 * karena tidak bisa dibatalkan (A3).
 */

export const INQUIRY_REPLY_SUBJECT_MAX = 200;
export const INQUIRY_REPLY_BODY_MAX = 20_000;
/** Lampiran balasan (kontrak §5.11); berkas pembeli dibatasi terpisah (A5). */
export const INQUIRY_REPLY_ATTACHMENTS_MAX = 5;

/**
 * Batas **total** ukuran lampiran satu balasan.
 *
 * Jumlah berkas saja tidak cukup: lima berkas privat berukuran maksimum
 * (10 MB, `MEDIA_UPLOAD_ALLOWLIST.PRIVATE`) berarti 50 MB yang harus diunduh
 * dari R2 ke memori lalu di-base64 oleh SDK email — ratusan MB sesaat per
 * pengiriman, dan pengiriman yang gagal boleh diulang tanpa batas. Angkanya
 * juga di bawah batas lampiran Resend, sehingga kiriman yang lolos di sini
 * tidak otomatis ditolak penyedia.
 */
export const INQUIRY_REPLY_ATTACHMENTS_TOTAL_BYTES = 15 * 1024 * 1024;
/** Panjang cuplikan `message` di daftar. */
export const INQUIRY_PREVIEW_LENGTH = 120;

// ── DTO ──────────────────────────────────────────────────────────────────────

export const inquiryAttachmentSchema = z.object({
  id: z.uuid(),
  mediaId: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
});
export type InquiryAttachmentDto = z.infer<typeof inquiryAttachmentSchema>;

export const inquiryReplySchema = z.object({
  id: z.uuid(),
  author: userRefSchema,
  /** `null` setelah inquiry dianonimkan (§6.11). */
  toEmail: z.string().nullable(),
  subject: z.string(),
  body: z.string().nullable(),
  status: replyStatusSchema,
  sentAt: z.iso.datetime().nullable(),
  emailError: z.string().nullable(),
  attachments: z.array(inquiryAttachmentSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type InquiryReplyDto = z.infer<typeof inquiryReplySchema>;

/**
 * Baris daftar. `preview` adalah cuplikan `message`, bukan `message` penuh:
 * inbox menampilkan puluhan baris sekaligus, dan isi lengkap permintaan
 * pembeli tidak perlu ikut ke setiap muat halaman.
 */
export const adminInquiryRowSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  reference: z.string(),
  subject: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  /** `null` bila sudah dianonimkan (§6.11). */
  email: z.string().nullable(),
  country: z.string().nullable(),
  volumeQuantity: z.number().int(),
  status: inquiryStatusSchema,
  readAt: z.iso.datetime().nullable(),
  preview: z.string(),
  attachmentCount: z.number().int().min(0),
  replyCount: z.number().int().min(0),
  anonymizedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminInquiryRow = z.infer<typeof adminInquiryRowSchema>;

const labelRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const adminInquirySchema = adminInquiryRowSchema.extend({
  category: labelRefSchema.nullable(),
  categoryLabel: z.string().nullable(),
  material: labelRefSchema.nullable(),
  materialLabel: z.string().nullable(),
  targetShipText: z.string().nullable(),
  /** `YYYY-MM-DD`; turunan server dari `targetShipText`, bisa dikoreksi admin (Q10). */
  targetShipDate: z.string().nullable(),
  destinationPort: z.string().nullable(),
  budgetPerUnitUsd: z.string().nullable(),
  message: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  notificationError: z.string().nullable(),
  /** Lampiran dari pembeli (`replyId` null). */
  attachments: z.array(inquiryAttachmentSchema),
  replies: z.array(inquiryReplySchema),
});
export type AdminInquiry = z.infer<typeof adminInquirySchema>;

// ── Daftar ───────────────────────────────────────────────────────────────────

export const INQUIRY_SORTS = ['-createdAt', 'createdAt'] as const;
export const inquirySortSchema = z.enum(INQUIRY_SORTS);

export const adminInquiriesQuerySchema = pageQuerySchema.extend({
  status: inquiryStatusSchema.optional(),
  q: searchQuerySchema.optional(),
  sort: inquirySortSchema.default('-createdAt'),
});
export type AdminInquiriesQuery = z.infer<typeof adminInquiriesQuerySchema>;

export const inquiryIdParamsSchema = z.object({ id: z.uuid() });
export const inquiryReplyParamsSchema = z.object({ id: z.uuid(), replyId: z.uuid() });
export type InquiryReplyParams = z.infer<typeof inquiryReplyParamsSchema>;

// ── Ubah ─────────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD`; kolomnya `Date` tanpa waktu, jadi ISO datetime penuh ditolak. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus berformat YYYY-MM-DD.');

export const updateInquirySchema = z
  .strictObject({
    read: z.boolean().optional(),
    status: inquiryStatusSchema.optional(),
    targetShipDate: dateOnlySchema.nullish(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Tidak ada perubahan yang dikirim.');
export type UpdateInquiryInput = z.infer<typeof updateInquirySchema>;

export const inquiryReplyInputSchema = z.strictObject({
  subject: z.string().trim().min(1).max(INQUIRY_REPLY_SUBJECT_MAX).optional(),
  body: z.string().trim().min(1).max(INQUIRY_REPLY_BODY_MAX),
  attachmentMediaIds: z.array(z.uuid()).max(INQUIRY_REPLY_ATTACHMENTS_MAX).optional(),
});
export type InquiryReplyInput = z.infer<typeof inquiryReplyInputSchema>;

export const updateInquiryReplySchema = z
  .strictObject({
    subject: z.string().trim().min(1).max(INQUIRY_REPLY_SUBJECT_MAX).optional(),
    body: z.string().trim().min(1).max(INQUIRY_REPLY_BODY_MAX).optional(),
    attachmentMediaIds: z.array(z.uuid()).max(INQUIRY_REPLY_ATTACHMENTS_MAX).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Tidak ada perubahan yang dikirim.');
export type UpdateInquiryReplyInput = z.infer<typeof updateInquiryReplySchema>;

export const anonymizeInquirySchema = z.strictObject({
  /** `true` = seluruh inquiry **dan** komentar dengan email yang sama (hak GDPR). */
  sameEmail: z.boolean().default(false),
});

export const anonymizeInquiryResultSchema = z.object({
  inquiry: adminInquirySchema,
  affected: z.object({
    inquiries: z.number().int().min(0),
    comments: z.number().int().min(0),
  }),
});
export type AnonymizeInquiryResult = z.infer<typeof anonymizeInquiryResultSchema>;

export const sendInquiryReplyResultSchema = z.object({
  reply: inquiryReplySchema,
  inquiry: adminInquiryRowSchema,
});
export type SendInquiryReplyResult = z.infer<typeof sendInquiryReplyResultSchema>;

// ── Aturan domain (model §6.5) ───────────────────────────────────────────────

export const INQUIRY_BUSINESS_RULES = {
  /** Lampiran balasan wajib Media `PRIVATE` (kontrak §5.11). */
  MEDIA_NOT_PRIVATE: 'MEDIA_NOT_PRIVATE',
  /** Total ukuran lampiran melebihi `INQUIRY_REPLY_ATTACHMENTS_TOTAL_BYTES`. */
  ATTACHMENTS_TOO_LARGE: 'ATTACHMENTS_TOO_LARGE',
} as const;

/**
 * Transisi status manual yang diizinkan (§6.5).
 *
 * `DONE → NEW` ditolak: "belum dibaca" adalah keadaan awal yang tidak bisa
 * dibuat ulang setelah pekerjaan selesai. `DONE → IN_PROGRESS` juga ditolak di
 * sini karena jalannya hanya lewat balasan baru yang benar-benar terkirim,
 * bukan lewat tombol status.
 */
export function canTransitionInquiry(current: InquiryStatus, next: InquiryStatus): boolean {
  if (current === next) return true;
  if (current === 'DONE') return false;
  return next !== 'NEW' || current !== 'IN_PROGRESS';
}

/** Cuplikan `message` untuk baris daftar; "" bila sudah dianonimkan. */
export function inquiryPreview(message: string | null): string {
  if (message === null) return '';
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length <= INQUIRY_PREVIEW_LENGTH
    ? flat
    : `${flat.slice(0, INQUIRY_PREVIEW_LENGTH - 1)}…`;
}

// ── Envelope respons ─────────────────────────────────────────────────────────

export const adminInquiryResponseSchema = dataEnvelope(adminInquirySchema);
export const adminInquiriesResponseSchema = dataMetaEnvelope(
  z.array(adminInquiryRowSchema),
  pageMetaSchema,
);
export const inquiryReplyResponseSchema = dataEnvelope(inquiryReplySchema);
export const anonymizeInquiryResponseSchema = dataEnvelope(anonymizeInquiryResultSchema);
export const sendInquiryReplyResponseSchema = dataEnvelope(sendInquiryReplyResultSchema);
