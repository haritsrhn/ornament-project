/**
 * Journal publik — kontrak §5.3 (`GET /v1/public/article-categories`,
 * `/articles`, `/articles/:slug`, `/articles/:slug/comments`).
 *
 * Tanpa auth (ADR A9); batas dan header cache datang dari `publicReadAccess()`.
 * Hanya artikel terbit (`PUBLISHED`, atau `SCHEDULED` yang `publishAt`-nya
 * sudah lewat — ADR K8) dan komentar `APPROVED` yang pernah terlihat.
 *
 * Endpoint **tulis** (`POST /articles/:slug/comments`) bukan bagian tahap ini.
 */

import {
  publicArticleCategoriesResponseSchema,
  publicArticleResponseSchema,
  publicArticlesQuerySchema,
  publicArticlesResponseSchema,
  publicCommentsQuerySchema,
  publicCommentsResponseSchema,
  slugParamsSchema,
  withEmptyQuerySchema,
  PUBLIC_ARTICLE_SORT,
  type CursorMetaWithTotal,
  type PublicArticleCategory,
  type PublicComment,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { canonicalFilter, decodeCursor, encodeCursor, invalidCursor } from '../../../lib/cursor.js';
import { notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { publicReadAccess } from '../guard.js';
import { publicMediaSelect, type PublicMediaRow } from '../media.js';
import {
  articleImageMediaIds,
  parseArticleBlocks,
  publicArticleCardSelect,
  publicArticleDetailSelect,
  publicCommentSelect,
  toPublicArticleCard,
  toPublicArticleDetail,
  toPublicComment,
  type ArticleCardRow,
  type CommentRow,
} from './dto.js';
import { articleKeysetIdsSql, effectivePublishedAt, publishedArticleWhere } from './query.js';

export interface PublicArticlesRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/** Urutan komentar akar: `createdAt` naik, tie-breaker `id` (kontrak §5.3/§1.7). */
const COMMENT_SORT = 'createdAt';

const COMMENT_ORDER: Prisma.CommentOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

export const publicArticlesRoutes: FastifyPluginAsyncZod<PublicArticlesRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;

  /** Artikel terbit dengan slug ini, atau `null` (dipakai detail & komentar). */
  const findPublishedArticleId = async (slug: string): Promise<string | null> => {
    const article = await app.prisma.article.findFirst({
      where: { slug, ...publishedArticleWhere(new Date()) },
      select: { id: true },
    });
    return article?.id ?? null;
  };

  app.get(
    '/public/article-categories',
    {
      config: publicReadAccess(),
      schema: {
        querystring: withEmptyQuerySchema,
        response: { 200: publicArticleCategoriesResponseSchema },
      },
    },
    async (request) => {
      // Satu `groupBy` untuk seluruh hitungan (bukan satu query per kategori).
      const [categories, grouped] = await Promise.all([
        app.prisma.articleCategory.findMany({
          select: { id: true, slug: true, name: true, description: true, position: true },
          orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        }),
        app.prisma.article.groupBy({
          by: ['categoryId'],
          where: publishedArticleWhere(new Date()),
          _count: { _all: true },
        }),
      ]);

      const counts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));
      const data: PublicArticleCategory[] = categories
        .map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
          description: category.description,
          position: category.position,
          articleCount: counts.get(category.id) ?? 0,
        }))
        .filter((category) => request.query.withEmpty || category.articleCount > 0);

      return ok(data);
    },
  );

  app.get(
    '/public/articles',
    {
      config: publicReadAccess(),
      schema: {
        querystring: publicArticlesQuerySchema,
        response: { 200: publicArticlesResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      // Kursor mengikat filter & sort (§1.6): kombinasi lain → `400 INVALID_CURSOR`.
      const binding = {
        sort: PUBLIC_ARTICLE_SORT,
        filter: canonicalFilter({ category: query.category, tag: query.tag }),
      };
      const position = query.cursor === undefined ? null : decodeCursor(query.cursor, binding);
      const emptyMeta: CursorMetaWithTotal = { limit: query.limit, nextCursor: null, total: 0 };

      // Slug filter diterjemahkan menjadi `id` lebih dulu, jadi query artikel
      // memakai kolom ber-indeks. Slug tak dikenal → `200` dengan `data: []`
      // (§5.3: bukan `404`, agar URL filter lama tidak error).
      const [category, tag] = await Promise.all([
        query.category === undefined
          ? null
          : app.prisma.articleCategory.findUnique({
              where: { slug: query.category },
              select: { id: true },
            }),
        query.tag === undefined
          ? null
          : app.prisma.tag.findUnique({ where: { slug: query.tag }, select: { id: true } }),
      ]);
      if (
        (query.category !== undefined && category === null) ||
        (query.tag !== undefined && tag === null)
      ) {
        return ok([], emptyMeta);
      }

      const now = new Date();
      const where: Prisma.ArticleWhereInput = {
        ...publishedArticleWhere(now),
        ...(category === null ? {} : { categoryId: category.id }),
        ...(tag === null ? {} : { tags: { some: { tagId: tag.id } } }),
      };

      const [keyset, total] = await Promise.all([
        app.prisma.$queryRaw<{ id: string }[]>(
          articleKeysetIdsSql({
            now,
            filter: {
              ...(category === null ? {} : { categoryId: category.id }),
              ...(tag === null ? {} : { tagId: tag.id }),
            },
            position,
            // Satu baris lebih banyak: cara termurah mengetahui apakah masih
            // ada halaman berikutnya tanpa `COUNT` kedua.
            take: query.limit + 1,
          }),
        ),
        // `total` dihitung dari filter tanpa kursor (§1.6).
        app.prisma.article.count({ where }),
      ]);

      const hasMore = keyset.length > query.limit;
      const pageIds = (hasMore ? keyset.slice(0, query.limit) : keyset).map((row) => row.id);
      if (pageIds.length === 0) {
        return ok([], { limit: query.limit, nextCursor: null, total });
      }

      // Satu query untuk seluruh halaman (bukan satu per artikel), lalu
      // diurutkan ulang mengikuti urutan keyset di atas.
      const rows = await app.prisma.article.findMany({
        where: { id: { in: pageIds } },
        select: publicArticleCardSelect,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const page = pageIds
        .map((id) => byId.get(id))
        .filter((row): row is (typeof rows)[number] => row !== undefined);

      const last = page.at(-1);
      const meta: CursorMetaWithTotal = {
        limit: query.limit,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(binding, {
                value: (effectivePublishedAt(last) ?? new Date(0)).toISOString(),
                id: last.id,
              })
            : null,
        total,
      };

      return ok(
        page.map((row: ArticleCardRow) => toPublicArticleCard(row, mediaPublicUrl)),
        meta,
      );
    },
  );

  app.get(
    '/public/articles/:slug',
    {
      config: publicReadAccess(),
      schema: { params: slugParamsSchema, response: { 200: publicArticleResponseSchema } },
    },
    async (request) => {
      const article = await app.prisma.article.findFirst({
        where: { slug: request.params.slug, ...publishedArticleWhere(new Date()) },
        select: publicArticleDetailSelect,
      });
      // Draf, terjadwal yang belum jatuh tempo, di Trash, atau tidak ada →
      // `404` yang sama (§1.10). Next lalu memeriksa redirect slug lama (§5.5).
      if (article === null) throw notFound('Artikel tidak ditemukan.');

      const { blocks, dropped } = parseArticleBlocks(article.content);
      if (dropped > 0) {
        request.log.warn(
          { articleId: article.id, dropped },
          'Blok artikel tidak sesuai skema ArticleBlock dan tidak dikirim.',
        );
      }

      // Satu query media untuk seluruh blok gambar (bukan satu per blok).
      const mediaIds = articleImageMediaIds(blocks);
      const mediaRows =
        mediaIds.length === 0
          ? []
          : await app.prisma.media.findMany({
              where: { id: { in: mediaIds } },
              select: { id: true, ...publicMediaSelect },
            });
      const mediaById = new Map<string, PublicMediaRow>(
        mediaRows.map(({ id, ...media }) => [id, media]),
      );

      return ok(toPublicArticleDetail(article, blocks, mediaById, mediaPublicUrl));
    },
  );

  app.get(
    '/public/articles/:slug/comments',
    {
      config: publicReadAccess(),
      schema: {
        params: slugParamsSchema,
        querystring: publicCommentsQuerySchema,
        response: { 200: publicCommentsResponseSchema },
      },
    },
    async (request) => {
      const articleId = await findPublishedArticleId(request.params.slug);
      // Komentar artikel yang tidak terbit tidak pernah bocor (§5.3).
      if (articleId === null) throw notFound('Artikel tidak ditemukan.');

      const query = request.query;
      const binding = { sort: COMMENT_SORT, filter: canonicalFilter({ article: articleId }) };
      const position = query.cursor === undefined ? null : decodeCursor(query.cursor, binding);

      // Hanya komentar akar yang dipaginasi; balasannya ikut di dalam induknya
      // (nesting maksimal 1 tingkat, model §3.6).
      const where: Prisma.CommentWhereInput = {
        articleId,
        status: 'APPROVED',
        parentId: null,
      };
      let listWhere: Prisma.CommentWhereInput = where;
      if (position !== null) {
        const createdAt = new Date(position.value);
        if (Number.isNaN(createdAt.getTime())) throw invalidCursor();
        listWhere = {
          AND: [
            where,
            {
              OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: position.id } }],
            },
          ],
        };
      }

      const [roots, total] = await Promise.all([
        app.prisma.comment.findMany({
          where: listWhere,
          select: publicCommentSelect,
          orderBy: COMMENT_ORDER,
          take: query.limit + 1,
        }),
        app.prisma.comment.count({ where }),
      ]);

      const hasMore = roots.length > query.limit;
      const page = hasMore ? roots.slice(0, query.limit) : roots;

      // Satu query untuk seluruh balasan halaman ini (bukan satu per komentar).
      const replies =
        page.length === 0
          ? []
          : await app.prisma.comment.findMany({
              where: {
                parentId: { in: page.map((row) => row.id) },
                status: 'APPROVED',
              },
              select: { ...publicCommentSelect, parentId: true },
              orderBy: COMMENT_ORDER,
            });
      const repliesByParent = new Map<string, CommentRow[]>();
      for (const { parentId, ...reply } of replies) {
        if (parentId === null) continue;
        const bucket = repliesByParent.get(parentId);
        if (bucket === undefined) repliesByParent.set(parentId, [reply]);
        else bucket.push(reply);
      }

      const last = page.at(-1);
      const meta: CursorMetaWithTotal = {
        limit: query.limit,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(binding, { value: last.createdAt.toISOString(), id: last.id })
            : null,
        // Jumlah komentar **akar** yang cocok filter (§1.6). Angka "Diskusi (n)"
        // di UI memakai `commentCount` artikel, yang menghitung balasan juga.
        total,
      };

      const data: PublicComment[] = page.map((row) =>
        toPublicComment(row, repliesByParent.get(row.id) ?? []),
      );
      return ok(data, meta);
    },
  );

  return Promise.resolve();
};
