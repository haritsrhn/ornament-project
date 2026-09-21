/**
 * Pratinjau artikel — kontrak §5.9 (`POST /v1/admin/articles/:id/preview`).
 *
 * Menghasilkan `PublicArticleDetail` **tanpa menyimpan apa pun**: isi editor
 * yang belum disimpan (body parsial) ditumpuk di atas baris tersimpan, lalu
 * dilewatkan transformasi DTO publik yang sama dengan `/v1/public/articles/:slug`.
 *
 * Kenapa memakai jalur publik yang sama, bukan merender dari body langsung:
 * pratinjau yang dibangun dengan aturan sendiri akan berbohong justru di
 * tempat yang paling mahal — blok gambar yang medianya `PRIVATE` atau hilang
 * **dibuang** di publik, `excerpt` kosong diturunkan dari paragraf pertama, dan
 * `mediaId` ditukar `PublicMedia`. Penulis harus melihat konsekuensi itu
 * sebelum menerbitkan, bukan sesudah.
 */

import {
  ARTICLE_EXCERPT_MAX,
  type ArticleBlock,
  type PreviewArticleBody,
  type PublicArticleDetail,
} from '@ornament/shared';

import type { PrismaClient } from '../../../generated/prisma/client.js';
import { slugify } from '../../../lib/slug.js';
import {
  articleImageMediaIds,
  deriveExcerpt,
  parseArticleBlocks,
  toPublicArticleBlocks,
} from '../../public/articles/dto.js';
import { publicMediaSelect, toPublicMedia, type PublicMediaRow } from '../../public/media.js';

/** Baris tersimpan yang dibutuhkan pratinjau. */
export const previewArticleSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  content: true,
  categoryId: true,
  publishedAt: true,
  publishAt: true,
  featuredImageId: true,
  category: { select: { slug: true, name: true } },
  author: { select: { name: true } },
  tags: { orderBy: { tagId: 'asc' }, select: { tag: { select: { slug: true, name: true } } } },
} as const;

export interface PreviewArticleRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: unknown;
  categoryId: string | null;
  publishedAt: Date | null;
  publishAt: Date | null;
  featuredImageId: string | null;
  category: { slug: string; name: string } | null;
  author: { name: string };
  tags: { tag: { slug: string; name: string } }[];
}

/** Ringkasan yang diketik editor dipotong sesuai batas DTO publik (model §3.6). */
function clampExcerpt(value: string): string {
  return value.length <= ARTICLE_EXCERPT_MAX
    ? value
    : `${value.slice(0, ARTICLE_EXCERPT_MAX).trimEnd()}…`;
}

export interface BuildPreviewOptions {
  row: PreviewArticleRow;
  body: PreviewArticleBody;
  mediaPublicUrl: string | undefined;
}

export async function buildArticlePreview(
  prisma: PrismaClient,
  { row, body, mediaPublicUrl }: BuildPreviewOptions,
): Promise<PublicArticleDetail> {
  const title = body.title ?? row.title;
  const blocks: ArticleBlock[] = body.content ?? parseArticleBlocks(row.content).blocks;

  // Kategori & gambar unggulan yang belum disimpan dibaca dari DB apa adanya;
  // id yang tidak dikenal menjadi "tidak ada" — pratinjau tidak memvalidasi,
  // ia menunjukkan hasil.
  const categoryId = body.categoryId === undefined ? row.categoryId : body.categoryId;
  const featuredImageId =
    body.featuredImageId === undefined ? row.featuredImageId : body.featuredImageId;

  const mediaIds = [...articleImageMediaIds(blocks)];
  if (featuredImageId !== null) mediaIds.push(featuredImageId);

  const [category, mediaRows] = await Promise.all([
    categoryId === null
      ? Promise.resolve(null)
      : prisma.articleCategory.findUnique({
          where: { id: categoryId },
          select: { slug: true, name: true },
        }),
    mediaIds.length === 0
      ? Promise.resolve([])
      : prisma.media.findMany({
          where: { id: { in: [...new Set(mediaIds)] } },
          select: { id: true, ...publicMediaSelect },
        }),
  ]);

  const mediaById = new Map<string, PublicMediaRow>(
    mediaRows.map(({ id, ...media }) => [id, media]),
  );

  const excerptInput = body.excerpt === undefined ? row.excerpt : body.excerpt;
  const excerpt =
    excerptInput === null || excerptInput.trim() === ''
      ? deriveExcerpt(null, blocks)
      : clampExcerpt(excerptInput.trim());

  const tags =
    body.tags === undefined
      ? row.tags.map(({ tag }) => ({ slug: tag.slug, name: tag.name }))
      : // Tag baru belum punya baris `Tag`; slugnya dihitung dengan fungsi yang
        // sama dengan yang nanti dipakai saat menyimpan, jadi pratinjau
        // menampilkan URL tag yang benar tanpa membuat apa pun.
        body.tags.map((name) => ({ slug: slugify(name), name: name.trim() }));

  return {
    id: row.id,
    slug: body.slug ?? row.slug,
    title,
    excerpt,
    category: category ?? { slug: '', name: '' },
    featuredImage:
      featuredImageId === null
        ? null
        : toPublicMedia(mediaById.get(featuredImageId), mediaPublicUrl),
    author: { name: row.author.name },
    // Artikel yang belum terbit dipratinjau seolah terbit sekarang (kontrak
    // §5.9), supaya tanggal di halaman tidak kosong.
    publishedAt: (row.publishedAt ?? row.publishAt ?? new Date()).toISOString(),
    commentCount: 0,
    content: toPublicArticleBlocks(blocks, mediaById, mediaPublicUrl),
    tags,
  };
}
