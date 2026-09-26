import { z } from 'zod';

import { BULK_IDS_MAX, bulkResultSchema, searchQuerySchema } from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { commentStatusSchema } from './enums.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { userRefSchema } from './users.js';

/**
 * Moderasi komentar — kontrak API §5.10, model §3.6 & §6.8.
 *
 * Contributor tidak punya akses sama sekali (A2): moderasi menyentuh data
 * pribadi pengunjung (`authorEmail`) dan memutuskan apa yang tayang, dua hal
 * yang tidak ada hubungannya dengan menulis draf sendiri.
 */

export const COMMENT_BODY_ADMIN_MAX = 2000;

/**
 * `authorEmail` ikut ke DTO admin — moderator perlu melihatnya untuk menilai
 * spam — tetapi `ipHash` dan `userAgent` **tidak**, bahkan untuk Administrator
 * (kontrak §5.10). Keduanya dikumpulkan untuk anti-spam otomatis, bukan untuk
 * dibaca manusia, dan dikosongkan setelah 30 hari (model §6.11).
 */
export const adminCommentSchema = z.object({
  id: z.uuid(),
  article: z.object({ id: z.uuid(), title: z.string(), slug: z.string() }),
  parentId: z.uuid().nullable(),
  authorName: z.string(),
  /** `null` = balasan admin, atau komentar yang sudah dianonimkan. */
  authorEmail: z.string().nullable(),
  isStaffReply: z.boolean(),
  author: userRefSchema.nullable(),
  body: z.string(),
  status: commentStatusSchema,
  moderatedBy: userRefSchema.nullable(),
  moderatedAt: z.iso.datetime().nullable(),
  anonymizedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminComment = z.infer<typeof adminCommentSchema>;

// ── Daftar ───────────────────────────────────────────────────────────────────

export const COMMENT_SORTS = ['-createdAt', 'createdAt'] as const;
export const commentSortSchema = z.enum(COMMENT_SORTS);
export type CommentSort = z.infer<typeof commentSortSchema>;

/**
 * `status` default `PENDING`, bukan "semua": layar moderasi dibuka untuk
 * mengerjakan antrean, dan antrean itu yang harus muncul lebih dulu.
 */
export const adminCommentsQuerySchema = pageQuerySchema.extend({
  status: commentStatusSchema.default('PENDING'),
  articleId: z.uuid().optional(),
  q: searchQuerySchema.optional(),
  sort: commentSortSchema.default('-createdAt'),
});
export type AdminCommentsQuery = z.infer<typeof adminCommentsQuerySchema>;

export const commentIdParamsSchema = z.object({ id: z.uuid() });
export type CommentIdParams = z.infer<typeof commentIdParamsSchema>;

// ── Moderasi ─────────────────────────────────────────────────────────────────

export const moderateCommentSchema = z.strictObject({ status: commentStatusSchema });
export type ModerateCommentInput = z.infer<typeof moderateCommentSchema>;

export const adminCommentReplySchema = z.strictObject({
  body: z.string().trim().min(1).max(COMMENT_BODY_ADMIN_MAX),
});
export type AdminCommentReplyInput = z.infer<typeof adminCommentReplySchema>;

export const anonymizeCommentSchema = z.strictObject({
  /** `true` = seluruh komentar **dan** inquiry dengan email yang sama (hak GDPR). */
  sameEmail: z.boolean().default(false),
});
export type AnonymizeCommentInput = z.infer<typeof anonymizeCommentSchema>;

export const anonymizeResultSchema = z.object({
  comment: adminCommentSchema,
  affected: z.object({
    comments: z.number().int().min(0),
    inquiries: z.number().int().min(0),
  }),
});
export type AnonymizeResult = z.infer<typeof anonymizeResultSchema>;

export const COMMENT_BULK_ACTIONS = ['APPROVE', 'SPAM', 'DELETE', 'ANONYMIZE'] as const;
export const commentBulkActionSchema = z.enum(COMMENT_BULK_ACTIONS);
export type CommentBulkAction = z.infer<typeof commentBulkActionSchema>;

export const commentBulkBodySchema = z.strictObject({
  action: commentBulkActionSchema,
  ids: z.array(z.uuid()).min(1).max(BULK_IDS_MAX),
});
export type CommentBulkBody = z.infer<typeof commentBulkBodySchema>;

// ── Aturan domain (model §6.8, §6.11) ────────────────────────────────────────

/** Nama pengganti setelah anonimisasi (model §6.11). */
export const ANONYMIZED_COMMENT_AUTHOR = 'Anonim';

export const COMMENT_BUSINESS_RULES = {
  /** Induk sudah berupa balasan: kontrak §5.3 hanya mengenal satu tingkat. */
  REPLY_DEPTH_EXCEEDED: 'REPLY_DEPTH_EXCEEDED',
  /** Balasan admin hanya masuk akal di artikel yang benar-benar tayang. */
  ARTICLE_NOT_PUBLISHED: 'ARTICLE_NOT_PUBLISHED',
} as const;
export type CommentBusinessRule =
  (typeof COMMENT_BUSINESS_RULES)[keyof typeof COMMENT_BUSINESS_RULES];

/**
 * `DELETED` adalah titik akhir (model §6.8): ia tidak bisa dipulihkan dari UI,
 * sehingga moderator tidak bisa diam-diam menayangkan kembali komentar yang
 * sudah dianggap hilang oleh penulisnya.
 */
export function canModerateFrom(current: string): boolean {
  return current !== 'DELETED';
}

// ── Envelope respons ─────────────────────────────────────────────────────────

export const adminCommentResponseSchema = dataEnvelope(adminCommentSchema);
export const adminCommentsResponseSchema = dataMetaEnvelope(
  z.array(adminCommentSchema),
  pageMetaSchema,
);
export const anonymizeCommentResponseSchema = dataEnvelope(anonymizeResultSchema);
export const commentBulkResponseSchema = dataEnvelope(bulkResultSchema);
