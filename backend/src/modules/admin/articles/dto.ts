/**
 * DTO admin artikel (kontrak §5.9) dan `select` Prisma yang menghasilkannya.
 *
 * **Whitelist, bukan `omit`** (model domain D9).
 *
 * Isi artikel diurai dengan `parseArticleBlocks()` yang **sama** dengan yang
 * dipakai journal publik: blok yang tidak cocok skema dibuang, bukan membuat
 * respons `500`. Konsekuensinya penting untuk admin — `blockCount` dan
 * `wordCount` di respons selalu menggambarkan isi yang benar-benar bisa
 * dirender, bukan jumlah baris JSON yang kebetulan tersimpan.
 *
 * Hitungan komentar sengaja **tidak** memakai `_count` berfilter: Prisma hanya
 * mengizinkan satu hitungan per relasi, sedangkan kontrak meminta dua
 * (`APPROVED` dan `PENDING`). Keduanya datang dari satu `groupBy` yang
 * dijalankan sekali per halaman (lihat `commentCountsFor()` di `routes.ts`).
 */

import {
  countArticleWords,
  type AdminArticle,
  type AdminArticleRow,
  type ArticleStatus,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import { toMediaRef } from '../../auth/me.js';
import { parseArticleBlocks } from '../../public/articles/dto.js';
import { mediaRefSelect, type MediaRefRow } from '../products/dto.js';

/** Lihat catatan urutan relasi di `products/dto.ts`. */
const TAG_ORDER: Prisma.ArticleTagOrderByWithRelationInput[] = [{ tagId: 'asc' }];

/** Hitungan komentar per artikel untuk satu halaman daftar (kontrak §5.9). */
export interface CommentCounts {
  approved: number;
  pending: number;
}

export const EMPTY_COMMENT_COUNTS: CommentCounts = { approved: 0, pending: 0 };

// ── Baris tabel (kontrak §5.9) ───────────────────────────────────────────────

export const adminArticleRowSelect = {
  id: true,
  title: true,
  slug: true,
  status: true,
  publishAt: true,
  publishedAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  author: { select: { id: true, name: true } },
} as const;

export interface AdminArticleRowData {
  id: string;
  title: string;
  slug: string;
  status: ArticleStatus;
  publishAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { id: string; name: string; slug: string } | null;
  author: { id: string; name: string };
}

export function toAdminArticleRow(
  row: AdminArticleRowData,
  counts: CommentCounts,
): AdminArticleRow {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    category: row.category,
    status: row.status,
    author: { id: row.author.id, name: row.author.name },
    publishAt: row.publishAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    commentCount: counts.approved,
    pendingCommentCount: counts.pending,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

// ── Detail (kontrak §5.9) ────────────────────────────────────────────────────

export const adminArticleSelect = {
  ...adminArticleRowSelect,
  excerpt: true,
  content: true,
  wordCount: true,
  createdAt: true,
  featuredImage: { select: mediaRefSelect },
  tags: { orderBy: TAG_ORDER, select: { tag: { select: { id: true, name: true, slug: true } } } },
} as const;

export interface AdminArticleData extends AdminArticleRowData {
  excerpt: string | null;
  content: unknown;
  wordCount: number;
  createdAt: Date;
  featuredImage: MediaRefRow | null;
  tags: { tag: { id: string; name: string; slug: string } }[];
}

export function toAdminArticle(
  row: AdminArticleData,
  counts: CommentCounts,
  mediaPublicUrl: string | undefined,
): AdminArticle {
  const { blocks } = parseArticleBlocks(row.content);
  return {
    ...toAdminArticleRow(row, counts),
    excerpt: row.excerpt,
    content: blocks,
    tags: row.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, slug: tag.slug })),
    featuredImage:
      row.featuredImage === null ? null : toMediaRef(row.featuredImage, mediaPublicUrl),
    // Nilai tersimpan dan nilai turunan harus sepakat; dihitung ulang dari blok
    // yang benar-benar sah supaya baris lama tetap konsisten di respons.
    wordCount: countArticleWords(blocks),
    blockCount: blocks.length,
    createdAt: row.createdAt.toISOString(),
  };
}
