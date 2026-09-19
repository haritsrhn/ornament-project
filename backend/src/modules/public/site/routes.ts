/**
 * Situs publik — kontrak §5.5 (`GET /v1/public/settings`, `/nav-items`,
 * `/pages`, `/blocks/global`, `/sitemap`, `/redirects`).
 *
 * Tanpa auth (ADR A9); batas dan header cache datang dari `publicReadAccess()`.
 * Hanya halaman `PUBLISHED` yang tidak di Trash, blok `ACTIVE`/`GLOBAL`, dan
 * entitas yang sedang tayang yang pernah terlihat.
 *
 * Kontrak tidak mendefinisikan endpoint `robots`; kebijakan indeks dikirim
 * lewat `SiteSetting.allowIndexing` di `/settings`, dan `robots.txt` dirender
 * Next dari sana.
 */

import {
  publicBlocksResponseSchema,
  publicNavItemsResponseSchema,
  publicPageQuerySchema,
  publicPageResponseSchema,
  publicRedirectQuerySchema,
  publicRedirectResponseSchema,
  publicSettingsResponseSchema,
  publicSitemapResponseSchema,
  publicRedirectPath,
  PUBLIC_ARTICLE_PATH_PREFIX,
  PUBLIC_ARTISAN_PATH_PREFIX,
  PUBLIC_PRODUCT_PATH_PREFIX,
  type PublicNavItem,
  type PublicSitemap,
  type PublicSitemapEntry,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { publicArtisanWhere } from '../artisans/routes.js';
import { publishedArticleWhere } from '../articles/query.js';
import { publicReadAccess } from '../guard.js';
import { publishedProductWhere } from '../products/query.js';
import {
  navItemHref,
  publicBlockSelect,
  publicNavItemSelect,
  publicSiteSettingSelect,
  sortBlocks,
  toPublicBlock,
  toPublicNavItem,
  toPublicSiteSetting,
} from './dto.js';

export interface PublicSiteRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/** Singleton `SiteSetting` (model D11/§3.8): selalu `id = 1`. */
const SITE_SETTING_ID = 1;

/** Satu-satunya definisi "halaman tayang publik" (kontrak §5.5). */
const publishedPageWhere = {
  status: 'PUBLISHED',
  deletedAt: null,
} as const satisfies Prisma.PageWhereInput;

const BLOCK_ORDER: Prisma.PageBlockOrderByWithRelationInput[] = [
  { position: 'asc' },
  { id: 'asc' },
];

export const publicSiteRoutes: FastifyPluginAsyncZod<PublicSiteRoutesOptions> = (app, options) => {
  const mediaPublicUrl = options.mediaPublicUrl;

  app.get(
    '/public/settings',
    {
      config: publicReadAccess(),
      schema: { response: { 200: publicSettingsResponseSchema } },
    },
    async () => {
      const setting = await app.prisma.siteSetting.findUnique({
        where: { id: SITE_SETTING_ID },
        select: publicSiteSettingSelect,
      });
      // Baris singleton dibuat seed/admin. Tanpa itu tidak ada `siteName` yang
      // bisa dikirim, dan mengarang nilai default justru menyesatkan situs.
      if (setting === null) throw notFound('Pengaturan situs belum dikonfigurasi.');
      return ok(toPublicSiteSetting(setting, mediaPublicUrl));
    },
  );

  app.get(
    '/public/nav-items',
    {
      config: publicReadAccess(),
      schema: { response: { 200: publicNavItemsResponseSchema } },
    },
    async () => {
      // Menu satu tingkat dan berjumlah belasan → diambil utuh (§1.6), dengan
      // target ikut di-join sekali (bukan satu query per item).
      const rows = await app.prisma.navItem.findMany({
        select: publicNavItemSelect,
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      });

      const data: PublicNavItem[] = [];
      for (const row of rows) {
        const href = navItemHref(row);
        if (href !== null) data.push(toPublicNavItem(row, href));
      }
      return ok(data);
    },
  );

  app.get(
    '/public/pages',
    {
      config: publicReadAccess(),
      schema: {
        querystring: publicPageQuerySchema,
        response: { 200: publicPageResponseSchema },
      },
    },
    async (request) => {
      const page = await app.prisma.page.findFirst({
        where: { path: request.query.path, ...publishedPageWhere },
        select: { id: true, path: true, title: true, metaTitle: true, metaDescription: true },
      });
      // `DRAFT`, di Trash, atau tidak ada → `404` yang sama (§1.10).
      if (page === null) throw notFound('Halaman tidak ditemukan.');

      // Blok halaman ini + blok global dalam satu query; `HIDDEN` tidak pernah
      // ikut karena hanya dua visibility yang disebut di `where`.
      const blocks = await app.prisma.pageBlock.findMany({
        where: {
          OR: [
            { pageId: page.id, visibility: 'ACTIVE' },
            { pageId: null, visibility: 'GLOBAL' },
          ],
        },
        select: publicBlockSelect,
        orderBy: BLOCK_ORDER,
      });

      return ok({
        path: page.path,
        title: page.title,
        metaTitle: page.metaTitle,
        metaDescription: page.metaDescription,
        blocks: sortBlocks(blocks).map((block) => toPublicBlock(block, mediaPublicUrl)),
      });
    },
  );

  app.get(
    '/public/blocks/global',
    {
      config: publicReadAccess(),
      schema: { response: { 200: publicBlocksResponseSchema } },
    },
    async () => {
      // Untuk layout yang tidak punya `Page` sendiri, mis. `/produk/[slug]`.
      const blocks = await app.prisma.pageBlock.findMany({
        where: { pageId: null, visibility: 'GLOBAL' },
        select: publicBlockSelect,
        orderBy: BLOCK_ORDER,
      });
      return ok(blocks.map((block) => toPublicBlock(block, mediaPublicUrl)));
    },
  );

  app.get(
    '/public/sitemap',
    {
      config: publicReadAccess(),
      schema: { response: { 200: publicSitemapResponseSchema } },
    },
    async () => {
      const now = new Date();
      // Empat query paralel, masing-masing memakai definisi "tayang publik"
      // milik modulnya sendiri — satu sumber aturan visibilitas per entitas.
      const [setting, pages, products, articles, artisans] = await Promise.all([
        app.prisma.siteSetting.findUnique({
          where: { id: SITE_SETTING_ID },
          select: { sitemapEnabled: true },
        }),
        app.prisma.page.findMany({
          where: publishedPageWhere,
          select: { path: true, updatedAt: true },
        }),
        app.prisma.product.findMany({
          where: publishedProductWhere,
          select: { slug: true, updatedAt: true },
        }),
        app.prisma.article.findMany({
          where: publishedArticleWhere(now),
          select: { slug: true, updatedAt: true },
        }),
        app.prisma.artisan.findMany({
          where: publicArtisanWhere,
          select: { slug: true, updatedAt: true },
        }),
      ]);

      const entries: PublicSitemapEntry[] = [
        ...pages.map((row) => ({ path: row.path, updatedAt: row.updatedAt })),
        ...products.map((row) => ({
          path: `${PUBLIC_PRODUCT_PATH_PREFIX}/${row.slug}`,
          updatedAt: row.updatedAt,
        })),
        ...articles.map((row) => ({
          path: `${PUBLIC_ARTICLE_PATH_PREFIX}/${row.slug}`,
          updatedAt: row.updatedAt,
        })),
        ...artisans.map((row) => ({
          path: `${PUBLIC_ARTISAN_PATH_PREFIX}/${row.slug}`,
          updatedAt: row.updatedAt,
        })),
      ]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((entry) => ({ path: entry.path, updatedAt: entry.updatedAt.toISOString() }));

      // Slug lama (`SlugRedirect`) sengaja tidak ikut (§5.5).
      const data: PublicSitemap = { enabled: setting?.sitemapEnabled ?? false, entries };
      return ok(data);
    },
  );

  app.get(
    '/public/redirects',
    {
      config: publicReadAccess(),
      schema: {
        querystring: publicRedirectQuerySchema,
        response: { 200: publicRedirectResponseSchema },
      },
    },
    async (request) => {
      const { type, slug } = request.query;
      const now = new Date();

      // Slug aktif selalu menang atas redirect (§6.10): bila ada entitas tayang
      // yang slug-nya persis `slug`, detailnya yang benar, bukan `301` ke tempat
      // lain. Normalnya barisnya memang sudah dihapus saat slug itu dipakai
      // ulang; pemeriksaan ini menjaga data lama tetap aman.
      const activeSlugTaken =
        type === 'PRODUCT'
          ? (await app.prisma.product.count({
              where: { slug, ...publishedProductWhere },
            })) > 0
          : (await app.prisma.article.count({
              where: { slug, ...publishedArticleWhere(now) },
            })) > 0;
      if (activeSlugTaken) throw notFound('Redirect tidak ditemukan.');

      const redirect = await app.prisma.slugRedirect.findUnique({
        where: { type_fromSlug: { type, fromSlug: slug } },
        select: {
          type: true,
          fromSlug: true,
          product: { select: { slug: true } },
          article: { select: { slug: true } },
        },
      });
      if (redirect === null) throw notFound('Redirect tidak ditemukan.');

      // Redirect hanya dikembalikan bila entitas tujuan **sedang tayang**
      // (§6.10); selain itu `404`, supaya `301` tidak pernah menuju halaman 404.
      const target = type === 'PRODUCT' ? redirect.product : redirect.article;
      if (target === null) throw notFound('Redirect tidak ditemukan.');

      const live =
        type === 'PRODUCT'
          ? await app.prisma.product.count({
              where: { slug: target.slug, ...publishedProductWhere },
            })
          : await app.prisma.article.count({
              where: { slug: target.slug, ...publishedArticleWhere(now) },
            });
      if (live === 0) throw notFound('Redirect tidak ditemukan.');

      return ok({
        type: redirect.type,
        fromSlug: redirect.fromSlug,
        toSlug: target.slug,
        path: publicRedirectPath(redirect.type, target.slug),
        statusCode: 301 as const,
      });
    },
  );

  return Promise.resolve();
};
