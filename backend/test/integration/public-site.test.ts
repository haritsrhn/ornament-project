import type {
  PublicBlock,
  PublicNavItem,
  PublicPage,
  PublicRedirect,
  PublicSitemap,
  PublicSiteSetting,
} from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient, SiteSetting } from '../../src/generated/prisma/client.js';
import { PUBLIC_GET_CACHE_CONTROL } from '../../src/modules/public/guard.js';
import { createTestUser, errorBody } from '../helpers/auth.js';
import {
  createCategory,
  createProduct,
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import {
  createArticle,
  createArticleCategory,
  createBlock,
  createNavItem,
  createPage,
  createSlugRedirect,
  deleteJournalFixture,
  emptyJournalIds,
  type JournalFixtureIds,
} from '../helpers/journal.js';

/**
 * Situs publik (#20) terhadap database tes: pengaturan, menu, halaman + blok,
 * sitemap, dan resolusi slug lama (§6.10).
 *
 * `SiteSetting` adalah singleton (`id = 1`), jadi berkas ini menyimpan baris
 * yang ada lebih dulu, memasang baris fixture-nya sendiri, lalu mengembalikan
 * baris semula di `afterAll` — tes tidak boleh meninggalkan jejak di DB tes.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: JournalFixtureIds = emptyJournalIds();
const catalogIds: CatalogFixtureIds = emptyFixtureIds();
let previousSetting: SiteSetting | null = null;

const s = randomSuffix();
const paths = {
  beranda: `/beranda-${s}`,
  draf: `/draf-${s}`,
  trash: `/trash-${s}`,
};
const slugs = {
  produkBaru: `produk-baru-${s}`,
  produkDraf: `produk-draf-${s}`,
  produkLama: `produk-lama-${s}`,
  artikelBaru: `artikel-baru-${s}`,
  artikelLama: `artikel-lama-${s}`,
  artikelDrafSlug: `artikel-draf-${s}`,
  kategoriProduk: `kategori-produk-${s}`,
  kategoriArtikel: `kategori-artikel-${s}`,
};

/** Nilai penanda kolom 🔒 `SiteSetting.lowStockThreshold` (kontrak §4). */
const LOW_STOCK_MARKER = 4321;

let berandaId = '';
let produkBaruId = '';
let produkDrafId = '';
let artikelBaruId = '';
let artikelDrafId = '';

const settingsOf = (res: LightMyRequestResponse): PublicSiteSetting =>
  res.json<{ data: PublicSiteSetting }>().data;
const navOf = (res: LightMyRequestResponse): PublicNavItem[] =>
  res.json<{ data: PublicNavItem[] }>().data;
const pageOf = (res: LightMyRequestResponse): PublicPage => res.json<{ data: PublicPage }>().data;
const blocksOf = (res: LightMyRequestResponse): PublicBlock[] =>
  res.json<{ data: PublicBlock[] }>().data;
const sitemapOf = (res: LightMyRequestResponse): PublicSitemap =>
  res.json<{ data: PublicSitemap }>().data;
const redirectOf = (res: LightMyRequestResponse): PublicRedirect =>
  res.json<{ data: PublicRedirect }>().data;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false });

  const author = await createTestUser(prisma, { name: `Penulis ${s}`, localPart: `situs-${s}` });
  ids.userIds.push(author.id);

  // ── Pengaturan situs (singleton) ──────────────────────────────────────────
  previousSetting = await prisma.siteSetting.findUnique({ where: { id: 1 } });
  if (previousSetting !== null) await prisma.siteSetting.delete({ where: { id: 1 } });
  await prisma.siteSetting.create({
    data: {
      id: 1,
      siteName: `Ornament ${s}`,
      tagline: 'Good Value, Crafted by Hand',
      contactEmail: `halo-${s}@ornament.id`,
      instagramHandle: '@ornament',
      instagramUrl: 'https://instagram.com/ornament',
      siteLanguage: 'ID',
      timezone: 'Asia/Jakarta',
      address: 'Jl. Contoh No. 1, Bantul',
      seoHomeTitle: 'Ornament — Sourcing Agent',
      seoKeywords: 'rotan, kerajinan',
      seoDescription: 'Deskripsi SEO.',
      sitemapEnabled: true,
      allowIndexing: true,
      // 🔒 diisi justru supaya tes bisa membuktikan ia tidak pernah muncul.
      lowStockThreshold: LOW_STOCK_MARKER,
      updatedById: author.id,
    },
  });

  // ── Halaman + blok ────────────────────────────────────────────────────────
  berandaId = await createPage(prisma, ids, {
    path: paths.beranda,
    title: `Beranda ${s}`,
    metaTitle: 'Meta judul',
    metaDescription: 'Meta deskripsi',
  });
  const drafId = await createPage(prisma, ids, {
    path: paths.draf,
    title: `Draf ${s}`,
    status: 'DRAFT',
  });
  await createPage(prisma, ids, { path: paths.trash, title: `Trash ${s}`, trashed: true });

  await createBlock(prisma, ids, {
    pageId: berandaId,
    visibility: 'ACTIVE',
    position: 1,
    type: 'STORY',
    title: 'Blok kedua',
  });
  await createBlock(prisma, ids, {
    pageId: berandaId,
    visibility: 'ACTIVE',
    position: 0,
    type: 'HERO',
    title: 'Blok pertama',
    cta1: { label: 'Lihat katalog', url: '/catalog' },
  });
  await createBlock(prisma, ids, {
    pageId: berandaId,
    visibility: 'HIDDEN',
    position: 2,
    type: 'TESTIMONIAL',
    title: 'Blok tersembunyi',
  });
  await createBlock(prisma, ids, {
    pageId: null,
    visibility: 'GLOBAL',
    position: 0,
    type: 'FOOTER',
    title: 'Footer global',
    config: { productCount: 6 },
  });
  await createBlock(prisma, ids, {
    pageId: drafId,
    visibility: 'ACTIVE',
    position: 0,
    type: 'HERO',
    title: 'Blok halaman draf',
  });

  // ── Menu ──────────────────────────────────────────────────────────────────
  const productCategoryId = await createCategory(prisma, catalogIds, {
    slug: slugs.kategoriProduk,
  });
  await createNavItem(prisma, ids, {
    label: `Beranda ${s}`,
    type: 'PAGE',
    pageId: berandaId,
    position: 0,
  });
  await createNavItem(prisma, ids, {
    label: `Katalog ${s}`,
    type: 'CATEGORY',
    categoryId: productCategoryId,
    position: 1,
  });
  await createNavItem(prisma, ids, { label: `Journal ${s}`, type: 'ARTICLE_ARCHIVE', position: 2 });
  await createNavItem(prisma, ids, {
    label: `Tautan ${s}`,
    type: 'CUSTOM_LINK',
    url: 'https://contoh.test/brosur',
    position: 3,
    style: 'BUTTON',
  });
  // Menunjuk halaman yang tidak terbit → tidak boleh dikirim (§5.5).
  await createNavItem(prisma, ids, {
    label: `Draf ${s}`,
    type: 'PAGE',
    pageId: drafId,
    position: 4,
  });

  // ── Produk & artikel untuk sitemap + redirect ─────────────────────────────
  produkBaruId = await createProduct(prisma, catalogIds, {
    slug: slugs.produkBaru,
    categoryId: productCategoryId,
  });
  produkDrafId = await createProduct(prisma, catalogIds, {
    slug: slugs.produkDraf,
    categoryId: productCategoryId,
    published: false,
  });

  const articleCategoryId = await createArticleCategory(prisma, ids, {
    slug: slugs.kategoriArtikel,
  });
  artikelBaruId = await createArticle(prisma, ids, {
    slug: slugs.artikelBaru,
    authorId: author.id,
    categoryId: articleCategoryId,
  });
  artikelDrafId = await createArticle(prisma, ids, {
    slug: slugs.artikelDrafSlug,
    authorId: author.id,
    categoryId: articleCategoryId,
    status: 'DRAFT',
  });

  await createSlugRedirect(prisma, ids, {
    type: 'PRODUCT',
    fromSlug: slugs.produkLama,
    productId: produkBaruId,
  });
  await createSlugRedirect(prisma, ids, {
    type: 'ARTICLE',
    fromSlug: slugs.artikelLama,
    articleId: artikelBaruId,
  });
  // Redirect ke entitas yang tidak tayang → `404` (§6.10).
  await createSlugRedirect(prisma, ids, {
    type: 'PRODUCT',
    fromSlug: `produk-mati-${s}`,
    productId: produkDrafId,
  });
  await createSlugRedirect(prisma, ids, {
    type: 'ARTICLE',
    fromSlug: `artikel-mati-${s}`,
    articleId: artikelDrafId,
  });
  // Slug aktif yang juga tercatat sebagai `fromSlug`: slug aktif menang.
  await createSlugRedirect(prisma, ids, {
    type: 'PRODUCT',
    fromSlug: slugs.produkBaru,
    productId: produkDrafId,
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteJournalFixture(prisma, ids);
  await deleteCatalogFixture(prisma, catalogIds);

  await prisma.siteSetting.deleteMany({ where: { id: 1 } });
  if (previousSetting !== null) await prisma.siteSetting.create({ data: previousSetting });

  await prisma.$disconnect();
});

describe('GET /v1/public/settings', () => {
  test('mengirim field publik §4 dan tidak pernah lowStockThreshold', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/settings' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(PUBLIC_GET_CACHE_CONTROL);
    expect(settingsOf(res)).toEqual({
      siteName: `Ornament ${s}`,
      tagline: 'Good Value, Crafted by Hand',
      contactEmail: `halo-${s}@ornament.id`,
      instagramHandle: '@ornament',
      instagramUrl: 'https://instagram.com/ornament',
      siteLanguage: 'ID',
      timezone: 'Asia/Jakarta',
      address: 'Jl. Contoh No. 1, Bantul',
      logo: null,
      icon: null,
      seoHomeTitle: 'Ornament — Sourcing Agent',
      seoKeywords: 'rotan, kerajinan',
      seoDescription: 'Deskripsi SEO.',
      sitemapEnabled: true,
      allowIndexing: true,
    });
    expect(res.body).not.toContain(String(LOW_STOCK_MARKER));
    expect(res.body).not.toContain('lowStockThreshold');
    expect(res.body).not.toContain('updatedById');
  });
});

describe('GET /v1/public/nav-items', () => {
  test('urut position dengan href turunan; item ke halaman tidak terbit dibuang', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/nav-items' });
    expect(res.statusCode).toBe(200);

    const items = navOf(res).filter((item) => item.label.endsWith(s));
    expect(items).toEqual([
      { label: `Beranda ${s}`, type: 'PAGE', href: paths.beranda, style: 'LINK', position: 0 },
      {
        label: `Katalog ${s}`,
        type: 'CATEGORY',
        href: `/catalog?category=${slugs.kategoriProduk}`,
        style: 'LINK',
        position: 1,
      },
      {
        label: `Journal ${s}`,
        type: 'ARTICLE_ARCHIVE',
        href: '/journal',
        style: 'LINK',
        position: 2,
      },
      {
        label: `Tautan ${s}`,
        type: 'CUSTOM_LINK',
        href: 'https://contoh.test/brosur',
        style: 'BUTTON',
        position: 3,
      },
    ]);
    expect(res.body).not.toContain('pageId');
    expect(res.body).not.toContain('categoryId');
  });
});

describe('GET /v1/public/pages', () => {
  test('blok ACTIVE urut position, lalu blok GLOBAL; blok HIDDEN tidak ikut', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/pages?path=${encodeURIComponent(paths.beranda)}`,
    });
    expect(res.statusCode).toBe(200);

    const page = pageOf(res);
    expect(page.path).toBe(paths.beranda);
    expect(page.title).toBe(`Beranda ${s}`);
    expect(page.metaTitle).toBe('Meta judul');
    expect(page.blocks.map((block) => block.title)).toEqual([
      'Blok pertama',
      'Blok kedua',
      'Footer global',
    ]);
    expect(page.blocks.map((block) => block.isGlobal)).toEqual([false, false, true]);
    expect(page.blocks[0]?.cta1).toEqual({ label: 'Lihat katalog', url: '/catalog' });
    expect(page.blocks[2]?.config).toEqual({ productCount: 6 });
    expect(res.body).not.toContain('Blok tersembunyi');
    expect(res.body).not.toContain('systemKey');
    expect(res.body).not.toContain('visibility');
  });

  test('halaman DRAFT, di Trash, dan path tak dikenal → 404', async () => {
    for (const path of [paths.draf, paths.trash, `/tidak-ada-${s}`]) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/public/pages?path=${encodeURIComponent(path)}`,
      });
      expect(res.statusCode).toBe(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
    }
  });

  test('path wajib dan harus diawali "/"', async () => {
    const tanpaPath = await app.inject({ method: 'GET', url: '/v1/public/pages' });
    expect(tanpaPath.statusCode).toBe(400);
    expect(errorBody(tanpaPath).code).toBe('VALIDATION_FAILED');

    const relatif = await app.inject({ method: 'GET', url: '/v1/public/pages?path=our-story' });
    expect(relatif.statusCode).toBe(400);
  });
});

describe('GET /v1/public/blocks/global', () => {
  test('hanya blok global, tanpa blok halaman', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/blocks/global' });
    expect(res.statusCode).toBe(200);

    const titles = blocksOf(res).map((block) => block.title);
    expect(titles).toContain('Footer global');
    expect(titles).not.toContain('Blok pertama');
    expect(blocksOf(res).every((block) => block.isGlobal)).toBe(true);
  });
});

describe('GET /v1/public/sitemap', () => {
  test('memuat halaman, produk, artikel, dan pengrajin yang tayang saja', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/sitemap' });
    expect(res.statusCode).toBe(200);

    const sitemap = sitemapOf(res);
    const allPaths = sitemap.entries.map((entry) => entry.path);
    expect(sitemap.enabled).toBe(true);
    expect(allPaths).toContain(paths.beranda);
    expect(allPaths).toContain(`/produk/${slugs.produkBaru}`);
    expect(allPaths).toContain(`/journal/${slugs.artikelBaru}`);

    expect(allPaths).not.toContain(paths.draf);
    expect(allPaths).not.toContain(paths.trash);
    expect(allPaths).not.toContain(`/produk/${slugs.produkDraf}`);
    expect(allPaths).not.toContain(`/journal/${slugs.artikelDrafSlug}`);
    // Slug lama tidak ikut di sitemap (§5.5).
    expect(allPaths).not.toContain(`/produk/${slugs.produkLama}`);
  });
});

describe('GET /v1/public/redirects', () => {
  test('slug lama produk & artikel menunjuk entitas yang benar', async () => {
    const produk = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PRODUCT&slug=${slugs.produkLama}`,
    });
    expect(produk.statusCode).toBe(200);
    expect(redirectOf(produk)).toEqual({
      type: 'PRODUCT',
      fromSlug: slugs.produkLama,
      toSlug: slugs.produkBaru,
      path: `/produk/${slugs.produkBaru}`,
      statusCode: 301,
    });

    const artikel = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=ARTICLE&slug=${slugs.artikelLama}`,
    });
    expect(artikel.statusCode).toBe(200);
    expect(redirectOf(artikel).path).toBe(`/journal/${slugs.artikelBaru}`);
  });

  test('slug aktif menang atas redirect', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PRODUCT&slug=${slugs.produkBaru}`,
    });
    expect(res.statusCode).toBe(404);
  });

  test('redirect ke entitas yang tidak tayang → 404', async () => {
    for (const url of [
      `/v1/public/redirects?type=PRODUCT&slug=produk-mati-${s}`,
      `/v1/public/redirects?type=ARTICLE&slug=artikel-mati-${s}`,
      `/v1/public/redirects?type=PRODUCT&slug=tidak-ada-${s}`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
    }
  });

  test('type di luar enum → 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PAGE&slug=${slugs.produkLama}`,
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });
});
