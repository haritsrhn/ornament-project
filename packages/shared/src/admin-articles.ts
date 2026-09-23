import { z } from 'zod';

import { articleBlockSchema, articleContentSchema, type ArticleBlock } from './articles.js';
import { mediaRefSchema } from './auth.js';
import {
  booleanFlagSchema,
  bulkResultSchema,
  BULK_IDS_MAX,
  expectedUpdatedAtSchema,
  searchQuerySchema,
  slugInputSchema,
} from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { articleStatusSchema } from './enums.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { userRefSchema } from './users.js';

/**
 * Kontrak admin artikel — kontrak API §5.9 (`/v1/admin/articles/*`).
 *
 * Hanya bentuk data: tanpa dependensi server dan tanpa tipe Prisma (ADR K6).
 *
 * Isi artikel memakai skema blok ketat yang sudah ada (`articles.ts`): admin
 * dan publik memvalidasi bentuk yang **sama**, jadi tidak ada blok yang bisa
 * tersimpan lewat editor admin lalu dibuang diam-diam saat dirender publik.
 */

// ── Batas `ArticleInput` (kontrak §5.9) ──────────────────────────────────────

export const ARTICLE_TITLE_MAX = 200;
export const ARTICLE_ADMIN_EXCERPT_MAX = 300;
export const ARTICLE_TAGS_MAX = 20;
export const ARTICLE_TAG_NAME_MAX = 60;

/**
 * Isi artikel untuk request admin: skema blok publik + `id` blok unik
 * (kontrak §5.9). Keunikan dicek di sini, bukan di server, supaya editor
 * admin mendapat pesan yang sama dari skema yang sama (ADR K6).
 */
export const articleContentInputSchema = articleContentSchema.superRefine((blocks, ctx) => {
  const ids = new Set(blocks.map((block) => block.id));
  if (ids.size !== blocks.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Setiap blok harus punya id yang berbeda.',
      params: { code: 'duplicate_block_id' },
    });
  }
});

const articleInputShape = {
  title: z.string().trim().min(1, 'Judul wajib diisi.').max(ARTICLE_TITLE_MAX),
  /** Hanya Editor+ (model §6.1); Contributor yang mengirimnya → `403 FORBIDDEN_FIELD`. */
  slug: slugInputSchema.optional(),
  excerpt: z.string().trim().max(ARTICLE_ADMIN_EXCERPT_MAX).nullish(),
  /** Default `[]` saat dibuat (draf cepat Q1 hanya mengirim `title`). */
  content: articleContentInputSchema.optional(),
  /** `ArticleCategory.id`. Boleh null saat draf; wajib saat jadwal/publish (§6.6). */
  categoryId: z.uuid().nullish(),
  tags: z
    .array(z.string().trim().min(1).max(ARTICLE_TAG_NAME_MAX))
    .max(ARTICLE_TAGS_MAX)
    .optional(),
  featuredImageId: z.uuid().nullish(),
  /** Hanya Editor+: menulis atas nama orang lain (kontrak §5.9). */
  authorId: z.uuid().optional(),
} as const;

/** Field yang hanya boleh dikirim Editor+ (kontrak §5.9: `403 FORBIDDEN_FIELD`). */
export const ARTICLE_EDITOR_ONLY_FIELDS = ['slug', 'authorId'] as const;

/** `POST /v1/admin/articles` — juga dipakai "Draf cepat" dashboard (Q1). */
export const articleInputSchema = z.strictObject(articleInputShape);
export type ArticleInput = z.infer<typeof articleInputSchema>;
export type ArticleInputRaw = z.input<typeof articleInputSchema>;

/** `PATCH /v1/admin/articles/:id` — `expectedUpdatedAt` wajib (kontrak §1.9). */
export const updateArticleBodySchema = z
  .strictObject(articleInputShape)
  .partial()
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema });
export type UpdateArticleBody = z.infer<typeof updateArticleBodySchema>;

/**
 * `POST /v1/admin/articles/:id/preview` — isi editor yang **belum disimpan**
 * (kontrak §5.9). Semua field opsional dan `expectedUpdatedAt` sengaja tidak
 * ada: pratinjau tidak menulis apa pun, jadi tidak ada yang bisa ditimpa.
 */
export const previewArticleBodySchema = z.strictObject(articleInputShape).partial().default({});
export type PreviewArticleBody = z.infer<typeof previewArticleBodySchema>;

// ── Query daftar (kontrak §5.9) ──────────────────────────────────────────────

/** Allowlist sort §1.7; tie-breaker `id` ditambahkan server. */
export const ADMIN_ARTICLE_SORTS = ['-updatedAt', '-publishedAt', 'title'] as const;
export const adminArticleSortSchema = z.enum(ADMIN_ARTICLE_SORTS);
export type AdminArticleSort = z.infer<typeof adminArticleSortSchema>;

export const adminArticlesQuerySchema = pageQuerySchema.extend({
  status: articleStatusSchema.optional(),
  categoryId: z.uuid().optional(),
  authorId: z.uuid().optional(),
  /** `true` = **hanya** baris di Trash (kontrak §1.7). */
  trashed: booleanFlagSchema(false),
  /** ILIKE pada `title` (kontrak §5.9). */
  q: searchQuerySchema.optional(),
  sort: adminArticleSortSchema.default('-updatedAt'),
});
export type AdminArticlesQuery = z.infer<typeof adminArticlesQuerySchema>;

export const articleIdParamsSchema = z.object({ id: z.uuid() });
export type ArticleIdParams = z.infer<typeof articleIdParamsSchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

export const adminArticleCategoryRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
});

export const adminArticleRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  category: adminArticleCategoryRefSchema.nullable(),
  status: articleStatusSchema,
  author: userRefSchema,
  publishAt: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  /** Komentar `APPROVED` — angka "Diskusi (n)" (§6.8). */
  commentCount: z.int(),
  /** Komentar `PENDING` — lencana antrean moderasi di tabel admin. */
  pendingCommentCount: z.int(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});
export type AdminArticleRow = z.infer<typeof adminArticleRowSchema>;

export const adminArticleSchema = adminArticleRowSchema.extend({
  excerpt: z.string().nullable(),
  content: z.array(articleBlockSchema),
  tags: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
  featuredImage: mediaRefSchema.nullable(),
  /** Turunan saat simpan (model §3.6); tidak pernah dikirim klien. */
  wordCount: z.int(),
  blockCount: z.int(),
  createdAt: z.iso.datetime(),
});
export type AdminArticle = z.infer<typeof adminArticleSchema>;

// ── Aksi (kontrak §5.9) ──────────────────────────────────────────────────────

/**
 * `POST /publish`. `publishAt` kosong/`null` = terbit sekarang (`PUBLISHED`);
 * waktu di masa depan = `SCHEDULED` (ADR K8).
 */
export const publishArticleBodySchema = z
  .strictObject({ publishAt: z.iso.datetime().nullish() })
  .default({});
export type PublishArticleBody = z.infer<typeof publishArticleBodySchema>;

export const ARTICLE_BULK_ACTIONS = ['PUBLISH', 'UNPUBLISH', 'TRASH', 'RESTORE', 'PURGE'] as const;
export const articleBulkActionSchema = z.enum(ARTICLE_BULK_ACTIONS);
export type ArticleBulkAction = z.infer<typeof articleBulkActionSchema>;

export const articleBulkBodySchema = z
  .strictObject({
    action: articleBulkActionSchema,
    ids: z.array(z.uuid()).min(1).max(BULK_IDS_MAX),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.ids).size !== value.ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['ids'],
        message: 'ids tidak boleh memuat id yang sama dua kali.',
        params: { code: 'duplicate_id' },
      });
    }
  });
export type ArticleBulkBody = z.infer<typeof articleBulkBodySchema>;

// ── Aturan domain ────────────────────────────────────────────────────────────

/**
 * Syarat jadwal/publish artikel (model §6.6): `title`, `categoryId`, `content`
 * tidak kosong, dan alt pada gambar. Path gambar dilaporkan per blok
 * (`content[2].mediaId`), jadi daftar ini hanya memuat path yang tetap.
 */
export const ARTICLE_PUBLISH_REQUIREMENT_PATHS = [
  'title',
  'categoryId',
  'content',
  'featuredImageId',
] as const;
export type ArticlePublishRequirementPath = (typeof ARTICLE_PUBLISH_REQUIREMENT_PATHS)[number];

/** `details.rule` pada `422 BUSINESS_RULE_VIOLATION` di §5.9. */
export const ARTICLE_BUSINESS_RULES = {
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  MEDIA_NOT_FOUND: 'MEDIA_NOT_FOUND',
  PRIVATE_MEDIA_NOT_ALLOWED: 'PRIVATE_MEDIA_NOT_ALLOWED',
  /** Menjadwalkan ke waktu yang sudah lewat (kontrak §5.9). */
  PUBLISH_AT_IN_PAST: 'PUBLISH_AT_IN_PAST',
} as const;
export type ArticleBusinessRule =
  (typeof ARTICLE_BUSINESS_RULES)[keyof typeof ARTICLE_BUSINESS_RULES];

/**
 * `wordCount` (model §3.6: "Kata: 612"). Dihitung dari teks yang benar-benar
 * dibaca orang — paragraf, judul, dan kutipan beserta sumbernya; `caption`
 * gambar ikut karena ia juga teks yang terbaca di halaman.
 *
 * Ditaruh di paket bersama, bukan di backend, supaya editor admin bisa
 * menampilkan angka yang **persis sama** dengan yang nanti tersimpan.
 */
export function countArticleWords(blocks: readonly ArticleBlock[]): number {
  let words = 0;
  const add = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed !== '') words += trimmed.split(/\s+/).length;
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        add(block.text.map((part) => part.text).join(''));
        break;
      case 'heading2':
        add(block.text);
        break;
      case 'quote':
        add(block.text);
        if (block.cite !== undefined) add(block.cite);
        break;
      default:
        if (block.caption !== undefined) add(block.caption);
        break;
    }
  }
  return words;
}

/** Id blok pertama pada draf cepat; stabil supaya pemanggil bisa mengujinya. */
export const QUICK_DRAFT_BLOCK_ID = 'quick-draft-note';

/**
 * Draf cepat dashboard (Q1, model §6.6): catatan menjadi blok `paragraph`
 * pertama. Catatan kosong menghasilkan `[]` — artikel tetap dibuat, hanya
 * tanpa blok, sehingga tombol "Simpan draf" tidak pernah gagal karena catatan
 * belum diisi.
 */
export function quickDraftContent(note: string | null | undefined): ArticleBlock[] {
  const text = note?.trim() ?? '';
  if (text === '') return [];
  return [{ id: QUICK_DRAFT_BLOCK_ID, type: 'paragraph', text: [{ text }] }];
}

// ── Respons ──────────────────────────────────────────────────────────────────

export const adminArticlesResponseSchema = dataMetaEnvelope(
  z.array(adminArticleRowSchema),
  pageMetaSchema,
);
export const adminArticleResponseSchema = dataEnvelope(adminArticleSchema);
export const articleTrashedResponseSchema = dataEnvelope(
  z.object({ id: z.uuid(), deletedAt: z.iso.datetime() }),
);
export const articleBulkResponseSchema = dataEnvelope(bulkResultSchema);
