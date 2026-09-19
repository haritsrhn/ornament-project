import type { CursorMetaWithTotal, PublicArtisanCard, PublicArtisanDetail } from '@ornament/shared';
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
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Pengrajin publik (#18) terhadap database tes. Fokusnya dua hal yang tidak
 * boleh salah: **tidak ada field privat** (kontrak §4) dan perilaku pengrajin
 * `VERIFICATION`/diarsipkan (model §6.7).
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: CatalogFixtureIds = emptyFixtureIds();

const s = randomSuffix();
const slugs = {
  category: `kategori-${s}`,
  material: `material-${s}`,
  aktif: `aktif-${s}`,
  penuh: `penuh-${s}`,
  verifikasi: `verifikasi-${s}`,
  arsip: `arsip-${s}`,
  produkAktif: `produk-aktif-${s}`,
  produkDraf: `produk-draf-${s}`,
  produkArsip: `produk-arsip-${s}`,
};

/** Nama diatur agar urutan `name` naik jelas: Alfa → Beta → Gama. */
const names = { aktif: `Alfa ${s}`, penuh: `Beta ${s}`, arsip: `Gama ${s}` };

function listOf(res: LightMyRequestResponse): {
  data: PublicArtisanCard[];
  meta: CursorMetaWithTotal;
} {
  return res.json<{ data: PublicArtisanCard[]; meta: CursorMetaWithTotal }>();
}

const detailOf = (res: LightMyRequestResponse): PublicArtisanDetail =>
  res.json<{ data: PublicArtisanDetail }>().data;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false });

  const categoryId = await createCategory(prisma, ids, { slug: slugs.category });
  const materialId = await createMaterial(prisma, ids, slugs.material);

  const aktifId = await createArtisan(prisma, ids, {
    slug: slugs.aktif,
    name: names.aktif,
    status: 'ACTIVE',
    regency: `Bantul ${s}`,
  });
  await createArtisan(prisma, ids, {
    slug: slugs.penuh,
    name: names.penuh,
    status: 'FULL_CAPACITY',
    regency: `Bantul ${s}`,
  });
  await createArtisan(prisma, ids, {
    slug: slugs.verifikasi,
    name: `Delta ${s}`,
    status: 'VERIFICATION',
    regency: `Bantul ${s}`,
  });
  const arsipId = await createArtisan(prisma, ids, {
    slug: slugs.arsip,
    name: names.arsip,
    status: 'ACTIVE',
    archived: true,
    regency: `Bantul ${s}`,
  });

  await createProduct(prisma, ids, {
    slug: slugs.produkAktif,
    categoryId,
    artisanId: aktifId,
    materialIds: [materialId],
  });
  await createProduct(prisma, ids, {
    slug: slugs.produkDraf,
    categoryId,
    artisanId: aktifId,
    materialIds: [materialId],
    published: false,
  });
  await createProduct(prisma, ids, {
    slug: slugs.produkArsip,
    categoryId,
    artisanId: arsipId,
    materialIds: [materialId],
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteCatalogFixture(prisma, ids);
  await prisma.$disconnect();
});

describe('GET /v1/public/artisans', () => {
  test('hanya ACTIVE/FULL_CAPACITY yang tidak diarsipkan, urut nama', async () => {
    const res = await app.inject({ url: `/v1/public/artisans?regency=Bantul ${s}` });

    expect(res.statusCode).toBe(200);
    expect(listOf(res).data.map((artisan) => artisan.slug)).toEqual([slugs.aktif, slugs.penuh]);
    expect(listOf(res).data.map((artisan) => artisan.status)).toEqual(['ACTIVE', 'FULL_CAPACITY']);
    expect(listOf(res).meta.total).toBe(2);
    expect(res.headers['cache-control']).toBe(PUBLIC_GET_CACHE_CONTROL);
  });

  test('filter regency tidak memandang besar-kecil huruf', async () => {
    const res = await app.inject({ url: `/v1/public/artisans?regency=bantul ${s}` });
    expect(listOf(res).data).toHaveLength(2);
  });

  test('publishedProductCount hanya menghitung produk terbit', async () => {
    const res = await app.inject({ url: `/v1/public/artisans?regency=Bantul ${s}` });
    const aktif = listOf(res).data.find((artisan) => artisan.slug === slugs.aktif);

    // Satu produk terbit; drafnya tidak ikut dihitung.
    expect(aktif?.publishedProductCount).toBe(1);
  });

  test('kursor membagi halaman tanpa duplikat dan menolak filter yang berbeda', async () => {
    const first = await app.inject({ url: `/v1/public/artisans?regency=Bantul ${s}&limit=1` });
    expect(listOf(first).data.map((a) => a.slug)).toEqual([slugs.aktif]);
    const cursor = listOf(first).meta.nextCursor;
    expect(cursor).not.toBeNull();

    const second = await app.inject({
      url: `/v1/public/artisans?regency=Bantul ${s}&limit=1&cursor=${encodeURIComponent(
        cursor ?? '',
      )}`,
    });
    expect(listOf(second).data.map((a) => a.slug)).toEqual([slugs.penuh]);
    expect(listOf(second).meta.nextCursor).toBeNull();

    const salahFilter = await app.inject({
      url: `/v1/public/artisans?limit=1&cursor=${encodeURIComponent(cursor ?? '')}`,
    });
    expect(salahFilter.statusCode).toBe(400);
    expect(errorBody(salahFilter).code).toBe('INVALID_CURSOR');
  });
});

describe('GET /v1/public/artisans/:slug', () => {
  test('detail memuat profil publik dan produk miliknya', async () => {
    const res = await app.inject({ url: `/v1/public/artisans/${slugs.aktif}` });
    expect(res.statusCode).toBe(200);
    const artisan = detailOf(res);

    expect(artisan.slug).toBe(slugs.aktif);
    expect(artisan.name).toBe(names.aktif);
    expect(artisan.craftsmenCount).toBe(8);
    expect(artisan.monthlyCapacity).toBe(600);
    expect(artisan.capacityUnit).toBe('pcs');
    expect(artisan.avgLeadTimeDays).toBe(45);
    expect(artisan.partnerSinceYear).toBe(2018);
    expect(artisan.images).toEqual([]);
    expect(artisan.publishedProductCount).toBe(1);

    expect(artisan.products.map((product) => product.slug)).toEqual([slugs.produkAktif]);
    // Produk draf miliknya tidak pernah ikut.
    expect(artisan.products.map((product) => product.slug)).not.toContain(slugs.produkDraf);
  });

  test('VERIFICATION, diarsipkan, dan slug tak dikenal sama-sama 404', async () => {
    for (const slug of [slugs.verifikasi, slugs.arsip, `entah-apa-${s}`]) {
      const res = await app.inject({ url: `/v1/public/artisans/${slug}` });
      expect(res.statusCode, slug).toBe(404);
      expect(errorBody(res).code, slug).toBe('NOT_FOUND');
    }
  });

  test('produk pengrajin yang diarsipkan tetap tayang di katalog (§6.7/A10)', async () => {
    const katalog = await app.inject({ url: `/v1/public/products?artisan=${slugs.arsip}` });
    expect(katalog.statusCode).toBe(200);
    expect(katalog.json<{ data: { slug: string }[] }>().data.map((p) => p.slug)).toEqual([
      slugs.produkArsip,
    ]);

    const detail = await app.inject({ url: `/v1/public/products/${slugs.produkArsip}` });
    const produk = detail.json<{ data: { artisan: { slug: string | null; name: string } } }>().data;
    expect(produk.artisan.slug).toBeNull();
    expect(produk.artisan.name).toBe(names.arsip);
  });
});

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

/** Whitelist kontrak §5.2 — dibandingkan **persis**, bukan sekadar "tidak ada X". */
const KARTU_KEYS = [
  'slug',
  'name',
  'village',
  'regency',
  'province',
  'skills',
  'summary',
  'status',
  'partnerSinceYear',
  'photo',
  'publishedProductCount',
];
const DETAIL_KEYS = [
  ...KARTU_KEYS,
  'story',
  'craftsmenCount',
  'monthlyCapacity',
  'capacityUnit',
  'avgLeadTimeDays',
  'images',
  'products',
];

/** Field 🔒 kontrak §4 yang tidak boleh pernah muncul di mana pun di respons. */
const FIELD_TERLARANG = [
  'phone',
  'address',
  'contactName',
  'internalNotes',
  'documents',
  'archivedAt',
  'photoId',
];

describe('privasi DTO pengrajin (kontrak §4, model §6.7)', () => {
  test('detail dan daftar hanya memuat field whitelist kontrak', async () => {
    const detail = await app.inject({ url: `/v1/public/artisans/${slugs.aktif}` });
    expect(Object.keys(detailOf(detail)).sort()).toEqual([...DETAIL_KEYS].sort());

    const daftar = await app.inject({ url: `/v1/public/artisans?regency=Bantul ${s}` });
    for (const card of listOf(daftar).data) {
      expect(Object.keys(card).sort()).toEqual([...KARTU_KEYS].sort());
    }
  });

  test('tidak ada telepon, alamat, catatan internal, atau dokumen di seluruh pohon JSON', async () => {
    for (const url of [
      `/v1/public/artisans/${slugs.aktif}`,
      `/v1/public/artisans?regency=Bantul ${s}`,
    ]) {
      const res = await app.inject({ url });
      const keys = collectKeys(res.json());

      for (const field of FIELD_TERLARANG) {
        expect(keys.has(field), `field ${field} bocor di ${url}`).toBe(false);
      }

      expect(res.payload, url).not.toContain('+628123456789');
      expect(res.payload, url).not.toContain('Jl. Rahasia');
      expect(res.payload, url).not.toContain('Pak Rahasia');
      expect(res.payload, url).not.toContain('Catatan negosiasi internal.');
    }
  });

  test('pengrajin di dalam detail produk pun tanpa field privat', async () => {
    const res = await app.inject({ url: `/v1/public/products/${slugs.produkAktif}` });
    const artisan = res.json<{ data: { artisan: Record<string, unknown> } }>().data.artisan;

    expect(Object.keys(artisan).sort()).toEqual(
      ['name', 'photo', 'province', 'regency', 'skills', 'slug', 'village'].sort(),
    );
  });
});
