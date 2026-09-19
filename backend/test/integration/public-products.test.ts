import type {
  CursorMetaWithTotal,
  PublicCategory,
  PublicMaterial,
  PublicProductCard,
  PublicProductDetail,
} from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PUBLIC_GET_CACHE_CONTROL } from '../../src/modules/public/guard.js';
import { errorBody } from '../helpers/auth.js';
import {
  createArtisan,
  createCategory,
  createMaterial,
  createProduct,
  createTag,
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Katalog publik (#17) terhadap database tes.
 *
 * Seluruh fixture dibuat sendiri dengan slug bersufiks acak dan dibersihkan di
 * `afterAll`; tidak ada assertion yang bergantung pada data seed.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: CatalogFixtureIds = emptyFixtureIds();

const s = randomSuffix();
const slugs = {
  furniture: `furniture-${s}`,
  kursi: `kursi-${s}`,
  lighting: `lighting-${s}`,
  rotan: `rotan-${s}`,
  besi: `besi-${s}`,
  jati: `jati-${s}`,
  tag: `handwoven-${s}`,
  artisanActive: `anyam-${s}`,
  artisanArchived: `arsip-${s}`,
  artisanVerification: `verif-${s}`,
  productA: `produk-a-${s}`,
  productB: `produk-b-${s}`,
  productC: `produk-c-${s}`,
  productD: `produk-d-${s}`,
  draft: `draf-${s}`,
  trashed: `trash-${s}`,
  late: `produk-baru-${s}`,
};

/** Waktu terbit dibuat eksplisit agar urutan `-publishedAt` deterministik. */
const at = (minutesAgo: number): Date => new Date(Date.now() - minutesAgo * 60_000);

function listOf(res: LightMyRequestResponse): {
  data: PublicProductCard[];
  meta: CursorMetaWithTotal;
} {
  return res.json<{ data: PublicProductCard[]; meta: CursorMetaWithTotal }>();
}

const slugsOf = (res: LightMyRequestResponse): string[] =>
  listOf(res).data.map((product) => product.slug);

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false });

  const furnitureId = await createCategory(prisma, ids, { slug: slugs.furniture, position: 0 });
  const kursiId = await createCategory(prisma, ids, {
    slug: slugs.kursi,
    parentId: furnitureId,
    position: 0,
  });
  const lightingId = await createCategory(prisma, ids, { slug: slugs.lighting, position: 1 });

  const rotanId = await createMaterial(prisma, ids, slugs.rotan);
  const besiId = await createMaterial(prisma, ids, slugs.besi);
  const jatiId = await createMaterial(prisma, ids, slugs.jati);
  const tagId = await createTag(prisma, ids, slugs.tag);

  const activeId = await createArtisan(prisma, ids, { slug: slugs.artisanActive });
  const archivedId = await createArtisan(prisma, ids, {
    slug: slugs.artisanArchived,
    archived: true,
  });
  const verificationId = await createArtisan(prisma, ids, {
    slug: slugs.artisanVerification,
    status: 'VERIFICATION',
  });

  // Urutan `-publishedAt`: A (terbaru) → B → C → D.
  await createProduct(prisma, ids, {
    slug: slugs.productA,
    name: 'Aneka Kursi',
    categoryId: kursiId,
    artisanId: activeId,
    materialIds: [rotanId, besiId],
    tagIds: [tagId],
    publishedAt: at(1),
  });
  await createProduct(prisma, ids, {
    slug: slugs.productB,
    name: 'Bangku Panjang',
    categoryId: furnitureId,
    artisanId: archivedId,
    materialIds: [rotanId],
    publishedAt: at(2),
  });
  await createProduct(prisma, ids, {
    slug: slugs.productC,
    name: 'Cahaya Gantung',
    categoryId: lightingId,
    artisanId: verificationId,
    materialIds: [rotanId, besiId, jatiId],
    publishedAt: at(3),
  });
  await createProduct(prisma, ids, {
    slug: slugs.productD,
    name: 'Dipan Kayu',
    categoryId: kursiId,
    artisanId: activeId,
    materialIds: [besiId],
    publishedAt: at(4),
  });
  await createProduct(prisma, ids, {
    slug: slugs.draft,
    categoryId: furnitureId,
    artisanId: activeId,
    materialIds: [rotanId],
    published: false,
  });
  await createProduct(prisma, ids, {
    slug: slugs.trashed,
    categoryId: furnitureId,
    artisanId: activeId,
    materialIds: [rotanId],
    trashed: true,
    publishedAt: at(5),
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteCatalogFixture(prisma, ids);
  await prisma.$disconnect();
});

// ── Daftar, filter, sort ─────────────────────────────────────────────────────

describe('GET /v1/public/products', () => {
  test('filter kategori mencakup turunannya dan hanya produk terbit', async () => {
    const res = await app.inject({ url: `/v1/public/products?category=${slugs.furniture}` });

    expect(res.statusCode).toBe(200);
    // Urut `-publishedAt` (default): A, B, D. `kursi` adalah anak `furniture`.
    expect(slugsOf(res)).toEqual([slugs.productA, slugs.productB, slugs.productD]);
    expect(listOf(res).meta.total).toBe(3);
  });

  test('produk draf dan produk di Trash tidak pernah muncul', async () => {
    const res = await app.inject({ url: `/v1/public/products?category=${slugs.furniture}` });
    const found = slugsOf(res);

    expect(found).not.toContain(slugs.draft);
    expect(found).not.toContain(slugs.trashed);
  });

  test('filter material adalah AND, dan AND juga terhadap filter kategori', async () => {
    const both = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&material=${slugs.rotan},${slugs.besi}`,
    });
    // Hanya A yang punya **kedua** material dan ada di cabang `furniture`:
    // B hanya rotan, C punya keduanya tetapi kategorinya `lighting`.
    expect(slugsOf(both)).toEqual([slugs.productA]);

    const rotanOnly = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&material=${slugs.rotan}`,
    });
    expect(slugsOf(rotanOnly)).toEqual([slugs.productA, slugs.productB]);

    const three = await app.inject({
      url: `/v1/public/products?material=${slugs.rotan},${slugs.besi},${slugs.jati}`,
    });
    expect(slugsOf(three)).toEqual([slugs.productC]);
  });

  test('filter tag dan pengrajin menyempit bersama filter lain', async () => {
    const byTag = await app.inject({ url: `/v1/public/products?tag=${slugs.tag}` });
    expect(slugsOf(byTag)).toEqual([slugs.productA]);

    const byArtisan = await app.inject({
      url: `/v1/public/products?artisan=${slugs.artisanActive}`,
    });
    expect(slugsOf(byArtisan)).toEqual([slugs.productA, slugs.productD]);
  });

  test('slug filter tak dikenal menjawab 200 dengan data kosong, bukan 404', async () => {
    for (const url of [
      '/v1/public/products?category=kategori-entah-apa',
      '/v1/public/products?material=material-entah-apa',
      `/v1/public/products?material=${slugs.rotan},material-entah-apa`,
      '/v1/public/products?tag=tag-entah-apa',
      '/v1/public/products?artisan=pengrajin-entah-apa',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(listOf(res).data, url).toEqual([]);
      expect(listOf(res).meta, url).toEqual({ limit: 12, nextCursor: null, total: 0 });
    }
  });

  test('sort=name mengurutkan menaik dan tetap memakai kursor yang sama', async () => {
    const res = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&sort=name`,
    });
    expect(slugsOf(res)).toEqual([slugs.productA, slugs.productB, slugs.productD]);
  });

  test('sort di luar allowlist ditolak 400 VALIDATION_FAILED', async () => {
    const res = await app.inject({ url: '/v1/public/products?sort=stockNote' });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });

  test('GET publik membawa Cache-Control yang bisa di-cache edge (§1.2)', async () => {
    const res = await app.inject({ url: '/v1/public/products' });
    expect(res.headers['cache-control']).toBe(PUBLIC_GET_CACHE_CONTROL);
  });
});

// ── Pagination kursor ────────────────────────────────────────────────────────

describe('pagination kursor katalog (§1.6)', () => {
  test('halaman berikutnya tidak melewatkan atau menggandakan item saat ada data baru', async () => {
    const first = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&limit=2`,
    });
    expect(slugsOf(first)).toEqual([slugs.productA, slugs.productB]);
    const cursor = listOf(first).meta.nextCursor;
    expect(cursor).not.toBeNull();

    // Produk baru terbit **di antara** dua klik "Muat lagi"; dengan keyset ia
    // masuk di halaman pertama versi berikutnya, tetapi tidak menggeser
    // halaman kedua yang sedang diambil (tidak ada item terlewat/ganda).
    await createProduct(prisma, ids, {
      slug: slugs.late,
      name: 'Zebra Terbaru',
      categoryId: ids.categoryIds[0] ?? '',
      // Tanpa material, supaya hitungan material di blok tes berikutnya tetap
      // ditentukan hanya oleh fixture awal.
      materialIds: [],
      publishedAt: new Date(),
    });

    const second = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&limit=2&cursor=${encodeURIComponent(
        cursor ?? '',
      )}`,
    });
    expect(slugsOf(second)).toEqual([slugs.productD]);
    expect(listOf(second).meta.nextCursor).toBeNull();

    const semua = [...slugsOf(first), ...slugsOf(second)];
    expect(new Set(semua).size).toBe(semua.length);
    expect(semua).not.toContain(slugs.late);

    // `total` ikut memperhitungkan produk baru itu.
    expect(listOf(second).meta.total).toBe(4);
  });

  test('kursor dari filter atau sort lain ditolak 400 INVALID_CURSOR', async () => {
    const first = await app.inject({
      url: `/v1/public/products?category=${slugs.furniture}&limit=1`,
    });
    const cursor = encodeURIComponent(listOf(first).meta.nextCursor ?? '');

    for (const url of [
      `/v1/public/products?limit=1&cursor=${cursor}`,
      `/v1/public/products?category=${slugs.lighting}&limit=1&cursor=${cursor}`,
      `/v1/public/products?category=${slugs.furniture}&sort=name&limit=1&cursor=${cursor}`,
      '/v1/public/products?cursor=bukan-kursor',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(400);
      expect(errorBody(res).code, url).toBe('INVALID_CURSOR');
    }
  });
});

// ── Detail ───────────────────────────────────────────────────────────────────

function detailOf(res: LightMyRequestResponse): PublicProductDetail {
  return res.json<{ data: PublicProductDetail }>().data;
}

describe('GET /v1/public/products/:slug', () => {
  test('detail memuat spesifikasi, checklist QC, pengrajin, dan produk terkait', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.productA}` });
    expect(res.statusCode).toBe(200);
    const product = detailOf(res);

    expect(product.slug).toBe(slugs.productA);
    expect(product.specs).toEqual([
      { label: 'Finishing', value: 'Natural clear coat' },
      { label: 'Material', value: 'Rotan alami' },
    ]);
    // Selalu empat tahap, urut MATERIAL → PACKAGING (kontrak §5.1).
    expect(product.qcChecks.map((check) => check.stage)).toEqual([
      'MATERIAL',
      'FRAME',
      'FINISHING',
      'PACKAGING',
    ]);
    expect(product.qcChecks[0]?.criteria).toBe('Kriteria MATERIAL');

    expect(product.artisan?.slug).toBe(slugs.artisanActive);
    expect(product.artisan?.name).toBe(slugs.artisanActive);
    expect(product.origin).toBe('Bangunjiwo, Bantul');

    expect(product.materials.map((material) => material.slug).sort()).toEqual(
      [slugs.rotan, slugs.besi].sort(),
    );
    expect(product.materials.filter((material) => material.isPrimary)).toHaveLength(1);
    expect(product.tags).toEqual([{ slug: slugs.tag, name: slugs.tag }]);
    expect(product.dimensions).toEqual({ lengthCm: 45, widthCm: 45, heightCm: 38 });
    expect(product.weightKg).toBe(3.2);
    // Uang sebagai string desimal (kontrak §1.3).
    expect(product.fobPriceUsd).toBe('42.00');
  });

  test('produk terkait: kategori sama, terbit, dan tidak memuat dirinya sendiri', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.productA}` });
    const related = detailOf(res).related.map((item) => item.slug);

    expect(related).not.toContain(slugs.productA);
    expect(related).toContain(slugs.productD);
    expect(related).not.toContain(slugs.draft);
    expect(related).not.toContain(slugs.trashed);
    // `productB` ada di `furniture`, bukan `kursi`: kategori harus sama persis.
    expect(related).not.toContain(slugs.productB);
    expect(related.length).toBeLessThanOrEqual(4);
  });

  test('pengrajin diarsipkan: produk tetap tayang, tautan pengrajin dimatikan (§6.7/A10)', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.productB}` });
    expect(res.statusCode).toBe(200);
    const product = detailOf(res);

    expect(product.artisan?.name).toBe(slugs.artisanArchived);
    expect(product.artisan?.slug).toBeNull();
    // Profilnya sendiri memang tidak bisa dibuka.
    const profil = await app.inject({ url: `/v1/public/artisans/${slugs.artisanArchived}` });
    expect(profil.statusCode).toBe(404);
  });

  test('pengrajin VERIFICATION: produk tetap tayang tanpa tautan (§6.3)', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.productC}` });
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).artisan?.slug).toBeNull();
  });

  test('slug tak dikenal, draf, dan Trash sama-sama 404 envelope kontrak', async () => {
    for (const slug of ['slug-entah-apa', slugs.draft, slugs.trashed]) {
      const res = await app.inject({ url: `/v1/public/products/${slug}` });
      expect(res.statusCode, slug).toBe(404);
      const error = errorBody(res);
      expect(error.code, slug).toBe('NOT_FOUND');
      expect(error.requestId, slug).toEqual(expect.any(String));
    }
  });
});

// ── Privasi DTO (§4) ─────────────────────────────────────────────────────────

/** Semua nama field yang muncul di seluruh pohon JSON. */
function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

/** Field 🔒 kontrak §4 yang tidak boleh pernah muncul di respons `/v1/public/*`. */
const FIELD_TERLARANG = [
  'stockNote',
  'stockStatusOverride',
  'lowStockThreshold',
  'notes',
  'checkedById',
  'checkedAt',
  'revision',
  'publishStatus',
  'deletedAt',
  'duplicatedFromId',
  'createdById',
  'updatedById',
  'updatedAt',
  'categoryId',
  'artisanId',
  'primaryImageId',
  'archivedAt',
  'phone',
  'address',
  'contactName',
  'internalNotes',
  'documents',
];

describe('privasi DTO publik (kontrak §4)', () => {
  test('detail produk tidak memuat satu pun field privat', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.productA}` });
    const keys = collectKeys(res.json());

    for (const field of FIELD_TERLARANG) {
      expect(keys.has(field), `field ${field} bocor di detail produk`).toBe(false);
    }
    // Isinya pun tidak boleh ikut lewat jalur lain (mis. teks yang disalin).
    expect(res.payload).not.toContain('Catatan stok internal.');
    expect(res.payload).not.toContain('Catatan QC internal');
    expect(res.payload).not.toContain('+628123456789');
    expect(res.payload).not.toContain('Jl. Rahasia');
    expect(res.payload).not.toContain('Catatan negosiasi internal.');
  });

  test('daftar produk tidak memuat satu pun field privat', async () => {
    const res = await app.inject({ url: `/v1/public/products?category=${slugs.furniture}` });
    const keys = collectKeys(res.json());

    for (const field of FIELD_TERLARANG) {
      expect(keys.has(field), `field ${field} bocor di daftar produk`).toBe(false);
    }
    // Harga FOB sengaja tidak ada di kartu (kontrak §5.1).
    expect(keys.has('fobPriceUsd')).toBe(false);
  });
});

// ── Kategori & material publik ───────────────────────────────────────────────

describe('GET /v1/public/categories dan /v1/public/materials', () => {
  test('kategori datar urut pohon dengan depth dan hitungan turunan', async () => {
    const res = await app.inject({ url: '/v1/public/categories' });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ data: PublicCategory[] }>().data;

    const furniture = data.find((row) => row.slug === slugs.furniture);
    const kursi = data.find((row) => row.slug === slugs.kursi);
    const lighting = data.find((row) => row.slug === slugs.lighting);

    expect(kursi?.depth).toBe(1);
    expect(furniture?.depth).toBe(0);
    expect(lighting?.productCount).toBe(1);
    expect(kursi?.productCount).toBe(2);

    // Invarian yang sebenarnya dijanjikan kontrak: `productCount` sebuah
    // kategori = `meta.total` daftar produk dengan filter kategori itu
    // (yang memang mencakup turunannya).
    for (const kategori of [furniture, kursi, lighting]) {
      const daftar = await app.inject({
        url: `/v1/public/products?category=${kategori?.slug ?? ''}&limit=1`,
      });
      expect(kategori?.productCount, kategori?.slug).toBe(listOf(daftar).meta.total);
    }
    expect(furniture?.productCount).toBeGreaterThan(kursi?.productCount ?? 0);

    // Induk selalu mendahului anaknya pada daftar datar.
    const indexFurniture = data.findIndex((row) => row.slug === slugs.furniture);
    const indexKursi = data.findIndex((row) => row.slug === slugs.kursi);
    expect(indexFurniture).toBeLessThan(indexKursi);
  });

  test('kategori dan material kosong disembunyikan kecuali withEmpty=true', async () => {
    const kosongSlug = `kosong-${s}`;
    await createCategory(prisma, ids, { slug: kosongSlug, position: 9 });
    const kosongMaterial = `material-kosong-${s}`;
    await createMaterial(prisma, ids, kosongMaterial);

    const kategori = await app.inject({ url: '/v1/public/categories' });
    expect(
      kategori.json<{ data: PublicCategory[] }>().data.some((row) => row.slug === kosongSlug),
    ).toBe(false);

    const kategoriSemua = await app.inject({ url: '/v1/public/categories?withEmpty=true' });
    expect(
      kategoriSemua.json<{ data: PublicCategory[] }>().data.some((row) => row.slug === kosongSlug),
    ).toBe(true);

    const material = await app.inject({ url: '/v1/public/materials' });
    expect(
      material.json<{ data: PublicMaterial[] }>().data.some((row) => row.slug === kosongMaterial),
    ).toBe(false);

    const materialSemua = await app.inject({ url: '/v1/public/materials?withEmpty=true' });
    expect(
      materialSemua
        .json<{ data: PublicMaterial[] }>()
        .data.some((row) => row.slug === kosongMaterial),
    ).toBe(true);
  });

  test('hitungan material memakai produk terbit saja dan tidak membocorkan skuCode', async () => {
    const res = await app.inject({ url: '/v1/public/materials' });
    const data = res.json<{ data: PublicMaterial[] }>().data;

    const rotan = data.find((row) => row.slug === slugs.rotan);
    // A, B, C terbit memakai rotan; draf dan Trash tidak dihitung.
    expect(rotan?.productCount).toBe(3);
    expect(collectKeys(res.json()).has('skuCode')).toBe(false);
  });
});
