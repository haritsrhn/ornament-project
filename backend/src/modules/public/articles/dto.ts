/**
 * DTO artikel & komentar publik (kontrak §5.3) dan `select` Prisma-nya.
 *
 * **Whitelist, bukan `omit`** (kontrak §4, model D9). Yang sengaja tidak pernah
 * disebut: `author.email` (relasi penulis hanya memilih `name`), `authorId`,
 * `categoryId`, `status`, `wordCount`, `deletedAt`; dan untuk komentar
 * `authorEmail`, `ipHash`, `userAgent`, `authorUserId`, `moderatedById`/
 * `moderatedAt`, `status`, serta `anonymizedAt`.
 *
 * `publishAt` **ikut dipilih** karena tanggal tayang artikel terjadwal ada di
 * sana (ADR K8); ia dipakai untuk menghitung `publishedAt` respons dan tidak
 * pernah dikirim sebagai field tersendiri.
 */

import {
  articleBlockSchema,
  ARTICLE_EXCERPT_MAX,
  type ArticleBlock,
  type PublicArticleBlock,
  type PublicArticleCard,
  type PublicArticleDetail,
  type PublicComment,
  type PublicCommentReply,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import { publicMediaSelect, toPublicMedia, type PublicMediaRow } from '../media.js';
import { effectivePublishedAt } from './query.js';

/** Lihat catatan urutan relasi di `products/dto.ts`. */
const TAG_ORDER: Prisma.ArticleTagOrderByWithRelationInput[] = [{ tagId: 'asc' }];

/** Hitungan "Diskusi (n)" = komentar `APPROVED` saja (model §6.8). */
export const approvedCommentCountSelect = {
  _count: { select: { comments: { where: { status: 'APPROVED' } } } },
} as const;

export const publicArticleCardSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  // Dipakai untuk menurunkan `excerpt` saat kolomnya kosong (model §3.6);
  // isinya sendiri hanya dikirim di detail.
  content: true,
  publishedAt: true,
  publishAt: true,
  category: { select: { slug: true, name: true } },
  featuredImage: { select: publicMediaSelect },
  author: { select: { name: true } },
  ...approvedCommentCountSelect,
} as const;

export interface ArticleCardRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: unknown;
  publishedAt: Date | null;
  publishAt: Date | null;
  category: { slug: string; name: string } | null;
  featuredImage: PublicMediaRow | null;
  author: { name: string };
  _count: { comments: number };
}

export const publicArticleDetailSelect = {
  ...publicArticleCardSelect,
  tags: { orderBy: TAG_ORDER, select: { tag: { select: { slug: true, name: true } } } },
} as const;

export interface ArticleDetailRow extends ArticleCardRow {
  tags: { tag: { slug: string; name: string } }[];
}

// ── Blok isi ─────────────────────────────────────────────────────────────────

/**
 * Blok yang bentuknya tidak cocok dengan skema `ArticleBlock` dibuang, bukan
 * membuat seluruh respons `500`: isi artikel adalah kolom `Json` yang baru
 * dikunci skemanya sekarang, jadi baris lama/rusak tidak boleh menjatuhkan
 * halaman journal. Jumlah yang dibuang dikembalikan agar rute bisa mencatatnya.
 */
export function parseArticleBlocks(content: unknown): {
  blocks: ArticleBlock[];
  dropped: number;
} {
  if (!Array.isArray(content)) return { blocks: [], dropped: content === null ? 0 : 1 };

  const blocks: ArticleBlock[] = [];
  let dropped = 0;
  for (const item of content) {
    const parsed = articleBlockSchema.safeParse(item);
    if (parsed.success) blocks.push(parsed.data);
    else dropped += 1;
  }
  return { blocks, dropped };
}

/** `mediaId` yang perlu di-resolve menjadi `PublicMedia` (kontrak §5.3). */
export function articleImageMediaIds(blocks: readonly ArticleBlock[]): string[] {
  return [...new Set(blocks.filter((block) => block.type === 'image').map((b) => b.mediaId))];
}

/**
 * Blok publik: blok gambar menukar `mediaId` dengan `PublicMedia`. Blok yang
 * medianya hilang atau `PRIVATE` **dibuang** — sama seperti galeri produk,
 * lebih baik hilang daripada dikirim dengan URL karangan (lihat `media.ts`).
 */
export function toPublicArticleBlocks(
  blocks: readonly ArticleBlock[],
  mediaById: ReadonlyMap<string, PublicMediaRow>,
  mediaPublicUrl: string | undefined,
): PublicArticleBlock[] {
  const result: PublicArticleBlock[] = [];
  for (const block of blocks) {
    if (block.type !== 'image') {
      result.push(block);
      continue;
    }
    const media = toPublicMedia(mediaById.get(block.mediaId), mediaPublicUrl);
    if (media === null) continue;
    result.push({
      id: block.id,
      type: 'image',
      image: media,
      ...(block.caption === undefined ? {} : { caption: block.caption }),
    });
  }
  return result;
}

/**
 * `excerpt` selalu terisi di DTO publik (kontrak §5.3). Bila kolomnya kosong,
 * diturunkan dari paragraf pertama, maks 200 karakter (model §3.6).
 */
export function deriveExcerpt(excerpt: string | null, blocks: readonly ArticleBlock[]): string {
  const stored = excerpt?.trim() ?? '';
  if (stored !== '') return stored;

  const paragraph = blocks.find((block) => block.type === 'paragraph');
  if (paragraph === undefined) return '';
  const text = paragraph.text
    .map((part) => part.text)
    .join('')
    .trim();
  return text.length <= ARTICLE_EXCERPT_MAX
    ? text
    : `${text.slice(0, ARTICLE_EXCERPT_MAX).trimEnd()}…`;
}

// ── Kartu & detail ───────────────────────────────────────────────────────────

export function toPublicArticleCard(
  row: ArticleCardRow,
  mediaPublicUrl: string | undefined,
  /** Blok yang sudah diurai (detail); kartu mengurainya sendiri untuk `excerpt`. */
  parsed?: readonly ArticleBlock[],
): PublicArticleCard {
  const blocks = parsed ?? parseArticleBlocks(row.content).blocks;
  // Artikel terbit selalu punya kategori dan tanggal tayang efektif
  // (`publishedArticleWhere`); cabang `??` hanya menjaga bentuk respons sah.
  const effectiveAt = effectivePublishedAt(row) ?? new Date(0);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: deriveExcerpt(row.excerpt, blocks),
    category: row.category ?? { slug: '', name: '' },
    featuredImage: toPublicMedia(row.featuredImage, mediaPublicUrl),
    author: { name: row.author.name },
    publishedAt: effectiveAt.toISOString(),
    commentCount: row._count.comments,
  };
}

export function toPublicArticleDetail(
  row: ArticleDetailRow,
  blocks: readonly ArticleBlock[],
  mediaById: ReadonlyMap<string, PublicMediaRow>,
  mediaPublicUrl: string | undefined,
): PublicArticleDetail {
  return {
    ...toPublicArticleCard(row, mediaPublicUrl, blocks),
    content: toPublicArticleBlocks(blocks, mediaById, mediaPublicUrl),
    tags: row.tags.map(({ tag }) => ({ slug: tag.slug, name: tag.name })),
  };
}

// ── Komentar ─────────────────────────────────────────────────────────────────

/**
 * Hanya lima kolom yang diambil. `authorEmail`, `ipHash`, `userAgent`,
 * `moderatedById`, `moderatedAt`, `status`, dan `anonymizedAt` tidak pernah
 * masuk ke `select`, jadi tidak ada jalur yang bisa membawanya ke respons.
 * `authorUserId` **tidak** dipilih; yang dipilih hanya penandanya lewat relasi
 * `authorUser`, dan itu pun hanya diubah menjadi boolean `isStaffReply`.
 */
export const publicCommentSelect = {
  id: true,
  authorName: true,
  body: true,
  createdAt: true,
  authorUser: { select: { id: true } },
} as const;

export interface CommentRow {
  id: string;
  authorName: string;
  body: string;
  createdAt: Date;
  authorUser: { id: string } | null;
}

export function toPublicCommentReply(row: CommentRow): PublicCommentReply {
  return {
    id: row.id,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    // Balasan admin tampil sebagai "Tim Ornament" di UI; identitas pengguna
    // internal (nama/email admin) tidak dikirim.
    isStaffReply: row.authorUser !== null,
  };
}

export function toPublicComment(row: CommentRow, replies: readonly CommentRow[]): PublicComment {
  return { ...toPublicCommentReply(row), replies: replies.map(toPublicCommentReply) };
}
