import { z } from 'zod';

import { honeypotSchema, publicMediaSchema, slugRefSchema } from './common.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import {
  cursorMetaWithTotalSchema,
  cursorQuerySchema,
  PUBLIC_CURSOR_LIMITS,
} from './pagination.js';
import { filterSlugSchema } from './products.js';

/**
 * Kontrak artikel & komentar publik — kontrak API §5.3
 * (`GET /v1/public/article-categories`, `/articles`, `/articles/:slug`,
 * `/articles/:slug/comments`).
 *
 * **Privasi (kontrak §4, model domain D9):** DTO ditulis sebagai whitelist
 * eksplisit. `author.email`, `authorId`, `categoryId`, `status`, `publishAt`,
 * `wordCount`, dan `deletedAt` tidak punya tempat di berkas ini; untuk komentar
 * juga `authorEmail` (termasuk turunannya seperti hash Gravatar — Q9),
 * `ipHash`, `userAgent`, `authorUserId`, `moderatedById`/`moderatedAt`,
 * `status`, dan `anonymizedAt`.
 */

// ── Blok isi artikel (model §3.6) ────────────────────────────────────────────

/**
 * Sebelumnya isi artikel hanya dijamin "JSON valid" (`richTextSchema`).
 * Model §3.6 sudah menetapkan bentuknya, jadi blok artikel punya skema sendiri
 * di sini: bentuk yang tidak dikenal tidak bisa lagi diam-diam ikut ke respons
 * publik, dan frontend mendapat union yang bisa ditelusuri per `type`.
 */

/** Potongan teks dengan mark `bold`/`italic`/tautan (model §3.6: `RichInline`). */
export const richInlineSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z.string().optional(),
});
export type RichInline = z.infer<typeof richInlineSchema>;

/** `id` blok: stabil per blok, dipakai editor admin sebagai kunci (kontrak §5.9). */
export const articleBlockIdSchema = z.string().min(1).max(64);

export const articleParagraphBlockSchema = z.object({
  id: articleBlockIdSchema,
  type: z.literal('paragraph'),
  text: z.array(richInlineSchema),
});

export const articleHeadingBlockSchema = z.object({
  id: articleBlockIdSchema,
  type: z.literal('heading2'),
  text: z.string(),
});

export const articleQuoteBlockSchema = z.object({
  id: articleBlockIdSchema,
  type: z.literal('quote'),
  text: z.string(),
  cite: z.string().optional(),
});

/** Blok gambar **tersimpan**: hanya `mediaId`; URL-nya di-resolve saat dibaca. */
export const articleImageBlockSchema = z.object({
  id: articleBlockIdSchema,
  type: z.literal('image'),
  mediaId: z.uuid(),
  caption: z.string().optional(),
});

export const articleBlockSchema = z.discriminatedUnion('type', [
  articleParagraphBlockSchema,
  articleHeadingBlockSchema,
  articleQuoteBlockSchema,
  articleImageBlockSchema,
]);
export type ArticleBlock = z.infer<typeof articleBlockSchema>;

/** Maks 200 blok per artikel (kontrak §5.9 `ArticleInput`). */
export const ARTICLE_BLOCKS_MAX = 200;

export const articleContentSchema = z.array(articleBlockSchema).max(ARTICLE_BLOCKS_MAX);
export type ArticleContent = z.infer<typeof articleContentSchema>;

/**
 * Blok gambar **publik**: `mediaId` sudah ditukar dengan `PublicMedia`
 * (kontrak §5.3). `id` media internal, `key`, dan `visibility` karena itu tidak
 * pernah ikut, dan blok yang medianya `PRIVATE`/hilang dibuang oleh server
 * alih-alih dikirim tanpa gambar.
 */
export const publicArticleImageBlockSchema = z.object({
  id: articleBlockIdSchema,
  type: z.literal('image'),
  image: publicMediaSchema,
  caption: z.string().optional(),
});

export const publicArticleBlockSchema = z.discriminatedUnion('type', [
  articleParagraphBlockSchema,
  articleHeadingBlockSchema,
  articleQuoteBlockSchema,
  publicArticleImageBlockSchema,
]);
export type PublicArticleBlock = z.infer<typeof publicArticleBlockSchema>;

// ── Query ────────────────────────────────────────────────────────────────────

/** Sort daftar artikel: `-publishedAt` (untuk terjadwal: `publishAt`), §5.3. */
export const PUBLIC_ARTICLE_SORT = '-publishedAt';

export const publicArticlesQuerySchema = cursorQuerySchema(PUBLIC_CURSOR_LIMITS).extend({
  /** Slug `ArticleCategory`; tak dikenal → `200` dengan `data: []` (§5.3). */
  category: filterSlugSchema.optional(),
  tag: filterSlugSchema.optional(),
});
export type PublicArticlesQuery = z.infer<typeof publicArticlesQuerySchema>;

/** Teks polos komentar, maks 2000 karakter (model §3.6, kontrak §5.3). */
export const COMMENT_BODY_MAX = 2000;

/** Komentar memakai kursor dengan default 20 (kontrak §5.3), bukan 12. */
export const COMMENT_CURSOR_LIMITS = { defaultLimit: 20, maxLimit: 48 } as const;

export const publicCommentsQuerySchema = cursorQuerySchema(COMMENT_CURSOR_LIMITS);
export type PublicCommentsQuery = z.infer<typeof publicCommentsQuerySchema>;

// ── DTO ──────────────────────────────────────────────────────────────────────

/** Penulis artikel: **hanya** nama (kontrak §4 baris User). */
export const publicArticleAuthorSchema = z.object({ name: z.string() });
export type PublicArticleAuthor = z.infer<typeof publicArticleAuthorSchema>;

export const publicArticleCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  /** Selalu terisi: bila kolomnya kosong, diturunkan dari paragraf pertama (§3.6). */
  excerpt: z.string(),
  /** Selalu terisi untuk artikel terbit (kategori wajib saat publish, §6.6). */
  category: slugRefSchema,
  featuredImage: publicMediaSchema.nullable(),
  author: publicArticleAuthorSchema,
  /** Untuk artikel `SCHEDULED` yang sudah jatuh tempo: `publishAt` (§5.3). */
  publishedAt: z.iso.datetime(),
  /** Jumlah komentar `APPROVED` — "Diskusi (n)" di halaman artikel (§6.8). */
  commentCount: z.int(),
});
export type PublicArticleCard = z.infer<typeof publicArticleCardSchema>;

export const publicArticleDetailSchema = publicArticleCardSchema.extend({
  content: z.array(publicArticleBlockSchema),
  tags: z.array(slugRefSchema),
});
export type PublicArticleDetail = z.infer<typeof publicArticleDetailSchema>;

/** Panjang maksimum `excerpt` turunan dari paragraf pertama (model §3.6). */
export const ARTICLE_EXCERPT_MAX = 200;

export const publicArticleCategorySchema = z.object({
  /** Ikut dikirim seperti `PublicCategory`/`PublicMaterial` (kontrak §4). */
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  position: z.int(),
  /** Artikel terbit di kategori ini; tidak terpengaruh filter lain. */
  articleCount: z.int(),
});
export type PublicArticleCategory = z.infer<typeof publicArticleCategorySchema>;

/**
 * Komentar publik. Hanya `APPROVED` yang pernah tampil (§6.8), dan tidak ada
 * satu pun field kontak: avatar dirender dari inisial `authorName` di frontend
 * (Q9: tanpa Gravatar), sehingga hash email pun tidak dikirim.
 */
export const publicCommentReplySchema = z.object({
  id: z.uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  /** Turunan `authorUserId !== null`: balasan admin atas nama brand. */
  isStaffReply: z.boolean(),
});
export type PublicCommentReply = z.infer<typeof publicCommentReplySchema>;

/** Nesting maksimal 1 tingkat (model §3.6), jadi balasan tidak punya `replies`. */
export const publicCommentSchema = publicCommentReplySchema.extend({
  replies: z.array(publicCommentReplySchema),
});
export type PublicComment = z.infer<typeof publicCommentSchema>;

// ── Submit komentar (kontrak §5.3) ───────────────────────────────────────────

/**
 * Body `POST /v1/public/articles/:slug/comments`.
 *
 * `authorEmail` **wajib** (Q9) dan 🔒: ia tidak pernah keluar lagi lewat DTO
 * mana pun — tidak sebagai hash Gravatar, tidak sebagai apa pun (§4).
 *
 * `strictObject`: `status`, `parentId`, `notifyOnReply`, `authorUserId`, dan
 * field tak dikenal lain ditolak `400` (`unrecognized_keys`). Komentar publik
 * karena itu selalu komentar **akar**; balasan bersarang hanya dibuat admin
 * (model §3.6: nesting maksimal 1 tingkat).
 */
export const publicCommentInputSchema = z.strictObject({
  authorName: z.string().trim().min(1, 'Nama wajib diisi.').max(80),
  authorEmail: z.email('Email tidak valid.').max(255),
  body: z.string().trim().min(1, 'Komentar tidak boleh kosong.').max(COMMENT_BODY_MAX),
  website: honeypotSchema,
});
export type PublicCommentInput = z.infer<typeof publicCommentInputSchema>;

/**
 * Respons submit: **hanya** status antrean moderasi. Tidak ada `id`, tidak ada
 * isi komentar, tidak ada apa pun yang bisa dipakai mengaitkan email dengan
 * komentar (§4).
 */
export const publicCommentSubmitSchema = z.object({ status: z.literal('PENDING') });
export type PublicCommentSubmit = z.infer<typeof publicCommentSubmitSchema>;

export const publicCommentSubmitResponseSchema = dataEnvelope(publicCommentSubmitSchema);

// ── Respons ──────────────────────────────────────────────────────────────────

export const publicArticlesResponseSchema = dataMetaEnvelope(
  z.array(publicArticleCardSchema),
  cursorMetaWithTotalSchema,
);
export const publicArticleResponseSchema = dataEnvelope(publicArticleDetailSchema);
export const publicArticleCategoriesResponseSchema = dataEnvelope(
  z.array(publicArticleCategorySchema),
);
export const publicCommentsResponseSchema = dataMetaEnvelope(
  z.array(publicCommentSchema),
  cursorMetaWithTotalSchema,
);
