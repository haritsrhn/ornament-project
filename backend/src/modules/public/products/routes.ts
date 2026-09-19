/**
 * Katalog publik — kontrak §5.1 (`GET /v1/public/products`,
 * `/products/:slug`, `/categories`, `/materials`).
 *
 * Tanpa auth (ADR A9); batas dan header cache datang dari `publicReadAccess()`
 * (lihat `modules/public/guard.ts`). Hanya produk terbit dan tidak di Trash yang
 * pernah terlihat (`publishedProductWhere`).
 */

import {
  publicCategoriesResponseSchema,
  publicMaterialsResponseSchema,
  publicProductResponseSchema,
  publicProductsQuerySchema,
  publicProductsResponseSchema,
  slugParamsSchema,
  withEmptyQuerySchema,
  RELATED_PRODUCTS_MAX,
  type CursorMetaWithTotal,
  type PublicCategory,
  type PublicMaterial,
  type PublicProductsQuery,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { canonicalFilter, decodeCursor, encodeCursor } from '../../../lib/cursor.js';
import { notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { publicReadAccess } from '../guard.js';
import {
  publicProductCardSelect,
  publicProductDetailSelect,
  toPublicProductCard,
  toPublicProductDetail,
} from './dto.js';
import {
  productCursorPosition,
  productKeysetWhere,
  productOrderBy,
  publishedProductWhere,
} from './query.js';
import {
  categoryBranchIds,
  categoryTreeSelect,
  flattenTree,
  rollUpCounts,
  type CategoryNode,
} from './taxonomy.js';

export interface PublicProductsRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/**
 * Hasil penerjemahan filter slug → `where`. `empty: true` berarti ada slug yang
 * tidak dikenal, sehingga jawabannya `200` dengan `data: []` (kontrak §5.1:
 * bukan `404`, agar URL filter lama tidak error).
 */
interface ResolvedFilter {
  where: Prisma.ProductWhereInput;
  empty: boolean;
}

export const publicProductsRoutes: FastifyPluginAsyncZod<PublicProductsRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;

  const loadCategoryTree = (): Promise<CategoryNode[]> =>
    app.prisma.category.findMany({ select: categoryTreeSelect });

  /**
   * Filter katalog (§1.7). Setiap slug diterjemahkan lebih dulu menjadi `id`,
   * jadi query produk memakai kolom ber-indeks (`category_id`, `artisan_id`,
   * PK `product_material`) alih-alih menempelkan join slug di setiap subquery.
   */
  async function resolveFilters(query: PublicProductsQuery): Promise<ResolvedFilter> {
    const where: Prisma.ProductWhereInput = { ...publishedProductWhere };
    let empty = false;

    if (query.category !== undefined) {
      const branch = categoryBranchIds(await loadCategoryTree(), query.category);
      if (branch === null) empty = true;
      else where.categoryId = { in: branch };
    }

    if (query.artisan !== undefined) {
      const artisan = await app.prisma.artisan.findUnique({
        where: { slug: query.artisan },
        select: { id: true },
      });
      if (artisan === null) empty = true;
      else where.artisanId = artisan.id;
    }

    if (query.tag !== undefined) {
      const tag = await app.prisma.tag.findUnique({
        where: { slug: query.tag },
        select: { id: true },
      });
      if (tag === null) empty = true;
      else where.tags = { some: { tagId: tag.id } };
    }

    if (query.material !== undefined && query.material.length > 0) {
      const materials = await app.prisma.material.findMany({
        where: { slug: { in: query.material } },
        select: { id: true },
      });
      // AND antar material (§5.1): produk harus punya **semua** material yang
      // diminta, jadi satu `some` per material — bukan satu `some` ber-`in`,
      // yang artinya OR. Slug yang tidak dikenal = tidak ada produk yang cocok.
      if (materials.length !== query.material.length) empty = true;
      else where.AND = materials.map(({ id }) => ({ materials: { some: { materialId: id } } }));
    }

    return { where, empty };
  }

  app.get(
    '/public/products',
    {
      config: publicReadAccess(),
      schema: {
        querystring: publicProductsQuerySchema,
        response: { 200: publicProductsResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      // Kursor mengikat filter & sort (§1.6): dipakai dengan kombinasi lain →
      // `400 INVALID_CURSOR`. Material diurutkan agar urutan ketik pengguna
      // tidak mengubah sidik jarinya.
      const binding = {
        sort: query.sort,
        filter: canonicalFilter({
          category: query.category,
          artisan: query.artisan,
          tag: query.tag,
          material: query.material === undefined ? undefined : [...query.material].sort().join(','),
        }),
      };
      const position = query.cursor === undefined ? null : decodeCursor(query.cursor, binding);

      const { where, empty } = await resolveFilters(query);
      const emptyMeta: CursorMetaWithTotal = { limit: query.limit, nextCursor: null, total: 0 };
      if (empty) return ok([], emptyMeta);

      const listWhere: Prisma.ProductWhereInput =
        position === null ? where : { AND: [where, productKeysetWhere(query.sort, position)] };

      const [rows, total] = await Promise.all([
        app.prisma.product.findMany({
          where: listWhere,
          select: publicProductCardSelect,
          orderBy: productOrderBy(query.sort),
          // Satu baris lebih banyak: cara termurah mengetahui apakah masih ada
          // halaman berikutnya tanpa `COUNT` kedua.
          take: query.limit + 1,
        }),
        // `total` dihitung dari filter tanpa kursor — UI menulis
        // "Menampilkan 12 dari 38 produk" (§1.6).
        app.prisma.product.count({ where }),
      ]);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      const meta: CursorMetaWithTotal = {
        limit: query.limit,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(binding, productCursorPosition(query.sort, last))
            : null,
        total,
      };

      return ok(
        page.map((row) => toPublicProductCard(row, mediaPublicUrl)),
        meta,
      );
    },
  );

  app.get(
    '/public/products/:slug',
    {
      config: publicReadAccess(),
      schema: { params: slugParamsSchema, response: { 200: publicProductResponseSchema } },
    },
    async (request) => {
      const product = await app.prisma.product.findFirst({
        where: { slug: request.params.slug, ...publishedProductWhere },
        select: publicProductDetailSelect,
      });
      // Draf, di Trash, atau tidak ada → `404` yang sama (kontrak §1.10: tidak
      // membocorkan keberadaan konten yang belum tayang). Next lalu memeriksa
      // redirect slug lama lewat §5.5.
      if (product === null) throw notFound('Produk tidak ditemukan.');

      const related = await app.prisma.product.findMany({
        where: {
          ...publishedProductWhere,
          categoryId: product.categoryId,
          id: { not: product.id },
        },
        select: publicProductCardSelect,
        orderBy: productOrderBy('-publishedAt'),
        take: RELATED_PRODUCTS_MAX,
      });

      return ok(toPublicProductDetail(product, related, mediaPublicUrl));
    },
  );

  app.get(
    '/public/categories',
    {
      config: publicReadAccess(),
      schema: {
        querystring: withEmptyQuerySchema,
        response: { 200: publicCategoriesResponseSchema },
      },
    },
    async (request) => {
      const [nodes, grouped] = await Promise.all([
        loadCategoryTree(),
        app.prisma.product.groupBy({
          by: ['categoryId'],
          where: publishedProductWhere,
          _count: { _all: true },
        }),
      ]);

      const ownCounts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));
      const totals = rollUpCounts(nodes, ownCounts);

      const data: PublicCategory[] = flattenTree(nodes)
        .map(({ node, depth }) => ({
          id: node.id,
          slug: node.slug,
          name: node.name,
          parentId: node.parentId,
          description: node.description,
          position: node.position,
          depth,
          productCount: totals.get(node.id) ?? 0,
        }))
        .filter((category) => request.query.withEmpty || category.productCount > 0);

      return ok(data);
    },
  );

  app.get(
    '/public/materials',
    {
      config: publicReadAccess(),
      schema: {
        querystring: withEmptyQuerySchema,
        response: { 200: publicMaterialsResponseSchema },
      },
    },
    async (request) => {
      const [materials, grouped] = await Promise.all([
        app.prisma.material.findMany({
          select: { id: true, slug: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        app.prisma.productMaterial.groupBy({
          by: ['materialId'],
          where: { product: publishedProductWhere },
          _count: { _all: true },
        }),
      ]);

      const counts = new Map(grouped.map((row) => [row.materialId, row._count._all]));
      const data: PublicMaterial[] = materials
        .map((material) => ({
          id: material.id,
          slug: material.slug,
          name: material.name,
          productCount: counts.get(material.id) ?? 0,
        }))
        .filter((material) => request.query.withEmpty || material.productCount > 0);

      return ok(data);
    },
  );

  return Promise.resolve();
};
