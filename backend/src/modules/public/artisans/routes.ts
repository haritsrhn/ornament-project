/**
 * Pengrajin publik — kontrak §5.2 (`GET /v1/public/artisans`, `/artisans/:slug`).
 *
 * Hanya profil `ACTIVE`/`FULL_CAPACITY` yang tidak diarsipkan (model §6.7).
 * Pengrajin `VERIFICATION` atau yang diarsipkan → `404`; produknya **tetap**
 * tayang di katalog, dan di detail produk ia muncul ringkas tanpa tautan
 * (`slug: null`, A10) — lihat `modules/public/products/dto.ts`.
 */

import {
  artisanSlugParamsSchema,
  publicArtisanResponseSchema,
  publicArtisansQuerySchema,
  publicArtisansResponseSchema,
  ARTISAN_PRODUCTS_MAX,
  type CursorMetaWithTotal,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { canonicalFilter, decodeCursor, encodeCursor } from '../../../lib/cursor.js';
import { notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { publicReadAccess } from '../guard.js';
import { publicProductCardSelect } from '../products/dto.js';
import { productOrderBy, publishedProductWhere } from '../products/query.js';
import {
  publicArtisanCardSelect,
  publicArtisanDetailSelect,
  toPublicArtisanCard,
  toPublicArtisanDetail,
} from './dto.js';

export interface PublicArtisansRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/** Satu-satunya definisi "profil pengrajin tayang publik" (model §6.7). */
export const publicArtisanWhere = {
  status: { in: ['ACTIVE', 'FULL_CAPACITY'] },
  archivedAt: null,
} as const satisfies Prisma.ArtisanWhereInput;

/** Hitungan produk terbit per pengrajin — statistik publik "14 produk aktif" (§6.7). */
const publishedProductCountSelect = {
  _count: { select: { products: { where: publishedProductWhere } } },
} as const;

/** Sort daftar pengrajin: `name` naik, tie-breaker `id` (kontrak §1.7). */
const ARTISAN_SORT = 'name';

export const publicArtisansRoutes: FastifyPluginAsyncZod<PublicArtisansRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;

  app.get(
    '/public/artisans',
    {
      config: publicReadAccess(),
      schema: {
        querystring: publicArtisansQuerySchema,
        response: { 200: publicArtisansResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const binding = {
        sort: ARTISAN_SORT,
        filter: canonicalFilter({ regency: query.regency }),
      };
      const position = query.cursor === undefined ? null : decodeCursor(query.cursor, binding);

      const where: Prisma.ArtisanWhereInput = {
        ...publicArtisanWhere,
        ...(query.regency === undefined
          ? {}
          : // Kabupaten diketik manusia; dicocokkan tanpa memperhatikan
            // besar-kecil huruf agar "bantul" dan "Bantul" sama.
            { regency: { equals: query.regency, mode: 'insensitive' } }),
      };

      const listWhere: Prisma.ArtisanWhereInput =
        position === null
          ? where
          : {
              AND: [
                where,
                {
                  OR: [
                    { name: { gt: position.value } },
                    { name: position.value, id: { gt: position.id } },
                  ],
                },
              ],
            };

      const [rows, total] = await Promise.all([
        app.prisma.artisan.findMany({
          where: listWhere,
          select: { id: true, ...publicArtisanCardSelect, ...publishedProductCountSelect },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: query.limit + 1,
        }),
        app.prisma.artisan.count({ where }),
      ]);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      const meta: CursorMetaWithTotal = {
        limit: query.limit,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(binding, { value: last.name, id: last.id })
            : null,
        total,
      };

      return ok(
        page.map((row) => toPublicArtisanCard(row, row._count.products, mediaPublicUrl)),
        meta,
      );
    },
  );

  app.get(
    '/public/artisans/:slug',
    {
      config: publicReadAccess(),
      schema: { params: artisanSlugParamsSchema, response: { 200: publicArtisanResponseSchema } },
    },
    async (request) => {
      const artisan = await app.prisma.artisan.findFirst({
        where: { slug: request.params.slug, ...publicArtisanWhere },
        select: { id: true, ...publicArtisanDetailSelect, ...publishedProductCountSelect },
      });
      // `VERIFICATION`, diarsipkan, atau tidak ada → `404` yang sama (§5.2).
      if (artisan === null) throw notFound('Pengrajin tidak ditemukan.');

      const products = await app.prisma.product.findMany({
        where: { ...publishedProductWhere, artisanId: artisan.id },
        select: publicProductCardSelect,
        orderBy: productOrderBy('-publishedAt'),
        // Maks 12 terbaru; selebihnya lewat `/public/products?artisan=<slug>`.
        take: ARTISAN_PRODUCTS_MAX,
      });

      return ok(toPublicArtisanDetail(artisan, products, artisan._count.products, mediaPublicUrl));
    },
  );

  return Promise.resolve();
};
