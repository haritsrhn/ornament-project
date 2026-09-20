import type {
  AdminArticleCategory,
  AdminCategory,
  AdminMaterial,
  AdminTag,
} from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import {
  createArticleCategory,
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
 * Admin taksonomi (#25) terhadap database tes: kategori produk hierarkis,
 * kategori artikel lewat rute yang sama dengan query `type`, material, dan tag.
 *
 * Fixture dibuat sendiri dengan slug bersufiks acak; tidak ada assertion yang
 * bergantung pada data seed dev.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: CatalogFixtureIds = emptyFixtureIds();
const userIds: string[] = [];
/** Kategori/material yang dibuat lewat API di dalam tes, untuk dibersihkan. */
const createdCategoryIds: string[] = [];
const createdArticleCategoryIds: string[] = [];
const createdMaterialIds: string[] = [];

const s = randomSuffix();
let rootId = '';
let childId = '';
let usedCategoryId = '';
let usedMaterialId = '';
let usedArticleCategoryId = '';
let tagId = '';

interface Session {
  id: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `tax-${role.toLowerCase()}` });
  userIds.push(user.id);
  return { id: user.id, token: await loginToken(app, user.email, user.password) };
}

const categoriesOf = (res: LightMyRequestResponse): AdminCategory[] =>
  res.json<{ data: AdminCategory[] }>().data;
const articleCategoriesOf = (res: LightMyRequestResponse): AdminArticleCategory[] =>
  res.json<{ data: AdminArticleCategory[] }>().data;
const materialsOf = (res: LightMyRequestResponse): AdminMaterial[] =>
  res.json<{ data: AdminMaterial[] }>().data;
const materialOf = (res: LightMyRequestResponse): AdminMaterial =>
  res.json<{ data: AdminMaterial }>().data;
const tagsOf = (res: LightMyRequestResponse): AdminTag[] => res.json<{ data: AdminTag[] }>().data;

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false, adminOrigin: ADMIN_ORIGIN });

  rootId = await createCategory(prisma, ids, { slug: `akar-${s}`, name: `Akar ${s}` });
  childId = await createCategory(prisma, ids, {
    slug: `anak-${s}`,
    name: `Anak ${s}`,
    parentId: rootId,
  });
  usedCategoryId = await createCategory(prisma, ids, {
    slug: `dipakai-${s}`,
    name: `Dipakai ${s}`,
  });
  usedMaterialId = await createMaterial(prisma, ids, `material-dipakai-${s}`);
  tagId = await createTag(prisma, ids, `tag-${s}`);

  await createProduct(prisma, ids, {
    slug: `produk-taksonomi-${s}`,
    categoryId: usedCategoryId,
    materialIds: [usedMaterialId],
    tagIds: [tagId],
    published: false,
  });
  // Produk kedua di kategori anak: membuktikan hitungan naik ke induknya.
  await createProduct(prisma, ids, {
    slug: `produk-anak-${s}`,
    categoryId: childId,
    published: false,
  });

  usedArticleCategoryId = await createArticleCategory(prisma, ids, {
    slug: `kat-artikel-${s}`,
    name: `Kategori Artikel ${s}`,
  });
  const author = await createTestUser(prisma, { localPart: 'penulis-taksonomi' });
  userIds.push(author.id);
  const article = await prisma.article.create({
    data: {
      slug: `artikel-taksonomi-${s}`,
      title: `Artikel ${s}`,
      content: [],
      categoryId: usedArticleCategoryId,
      authorId: author.id,
      status: 'DRAFT',
      wordCount: 0,
    },
    select: { id: true },
  });
  ids.articleIds.push(article.id);

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');
});

afterAll(async () => {
  if (createdMaterialIds.length > 0) {
    await prisma.material.deleteMany({ where: { id: { in: createdMaterialIds } } });
  }
  if (createdArticleCategoryIds.length > 0) {
    await prisma.articleCategory.deleteMany({ where: { id: { in: createdArticleCategoryIds } } });
  }
  // Anak lebih dulu (FK `Restrict` ke induk).
  for (const id of [...createdCategoryIds].reverse()) {
    await prisma.category.deleteMany({ where: { id } });
  }
  await deleteCatalogFixture(prisma, ids);
  await deleteTestUsers(prisma, userIds);
  await app.close();
});

// ── Matriks izin (kontrak §3.2: baca ✓✓✓, tulis Editor+) ─────────────────────

describe('matriks izin /v1/admin/categories, /materials, /tags', () => {
  const writeEndpoints = [
    {
      method: 'POST' as const,
      url: () => '/v1/admin/categories',
      payload: { name: 'Uji Izin' },
    },
    {
      method: 'PATCH' as const,
      url: (id: string) => `/v1/admin/categories/${id}`,
      payload: { name: 'Uji Izin' },
    },
    { method: 'DELETE' as const, url: (id: string) => `/v1/admin/categories/${id}` },
    {
      method: 'PUT' as const,
      url: () => '/v1/admin/categories/order',
      payload: {
        items: [{ id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', parentId: null, position: 0 }],
      },
    },
    { method: 'POST' as const, url: () => '/v1/admin/materials', payload: { name: 'Uji Izin' } },
    {
      method: 'PATCH' as const,
      url: (id: string) => `/v1/admin/materials/${id}`,
      payload: { name: 'Uji Izin' },
    },
    { method: 'DELETE' as const, url: (id: string) => `/v1/admin/materials/${id}` },
    { method: 'DELETE' as const, url: (id: string) => `/v1/admin/tags/${id}` },
  ];

  const readEndpoints = [
    { method: 'GET' as const, url: '/v1/admin/categories' },
    { method: 'GET' as const, url: '/v1/admin/categories?type=ARTICLE' },
    { method: 'GET' as const, url: '/v1/admin/materials' },
    { method: 'GET' as const, url: '/v1/admin/tags' },
  ];

  test('baca boleh semua peran, termasuk Contributor (§3.2)', async () => {
    for (const endpoint of readEndpoints) {
      for (const session of [admin, editor, contributor]) {
        const res = await adminRequest(app, { ...endpoint, token: session.token });
        expect(res.statusCode, endpoint.url).toBe(200);
      }
    }
  });

  test('baca tanpa sesi → 401', async () => {
    for (const endpoint of readEndpoints) {
      const res = await adminRequest(app, endpoint);
      expect(res.statusCode).toBe(401);
      expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    }
  });

  test('tulis oleh Contributor → 403 FORBIDDEN (taxonomy.write Editor+)', async () => {
    for (const endpoint of writeEndpoints) {
      const res = await adminRequest(app, {
        method: endpoint.method,
        url: endpoint.url(rootId),
        token: contributor.token,
        ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload }),
      });
      expect(res.statusCode, `${endpoint.method} ${endpoint.url(rootId)}`).toBe(403);
      expect(errorBody(res).code).toBe('FORBIDDEN');
      expect(errorBody(res).details).toMatchObject({
        requiredRoles: ['ADMINISTRATOR', 'EDITOR'],
      });
    }
  });

  test('tulis tanpa sesi → 401, bukan 403 (urutan guard §1.10)', async () => {
    for (const endpoint of writeEndpoints) {
      const res = await adminRequest(app, {
        method: endpoint.method,
        url: endpoint.url(rootId),
        ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload }),
      });
      expect(res.statusCode).toBe(401);
    }
  });
});

// ── Kategori produk: hierarki & hitungan ─────────────────────────────────────

describe('kategori produk (hierarkis)', () => {
  test('daftar datar urut pohon dengan depth dan productCount termasuk turunan', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/categories',
      token: contributor.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const all = categoriesOf(res);

    const root = all.find((category) => category.id === rootId);
    const child = all.find((category) => category.id === childId);
    expect(root?.type).toBe('PRODUCT');
    expect(root?.depth).toBe(0);
    expect(child?.depth).toBe(1);
    expect(child?.parentId).toBe(rootId);
    // Anak berada tepat setelah induknya dalam daftar datar urut pohon.
    expect(all.findIndex((c) => c.id === childId)).toBeGreaterThan(
      all.findIndex((c) => c.id === rootId),
    );

    // Produk ada di kategori anak, tetapi hitungan induk ikut naik (§5.7).
    expect(child?.productCount).toBe(1);
    expect(root?.productCount).toBe(1);
  });

  test('membuat kategori: slug diturunkan dari nama, parentId dihormati', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories',
      token: editor.token,
      payload: { name: `Lighting Baru ${s}`, parentId: rootId, description: 'Lampu' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<{ data: AdminCategory }>().data;
    createdCategoryIds.push(created.id);

    expect(created.type).toBe('PRODUCT');
    expect(created.slug).toBe(`lighting-baru-${s}`);
    expect(created.parentId).toBe(rootId);
    expect(created.depth).toBe(1);
    expect(created.productCount).toBe(0);
  });

  test('parentId tak dikenal → 422 PARENT_NOT_FOUND', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories',
      token: editor.token,
      payload: { name: `Yatim ${s}`, parentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'PARENT_NOT_FOUND' });
  });

  test('siklus ditolak: induk = diri sendiri', async () => {
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/categories/${rootId}`,
      token: editor.token,
      payload: { parentId: rootId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('BUSINESS_RULE_VIOLATION');
    expect(errorBody(res).details).toEqual({ rule: 'CATEGORY_CYCLE' });
  });

  test('siklus ditolak: induk = turunannya sendiri', async () => {
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/categories/${rootId}`,
      token: editor.token,
      payload: { parentId: childId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CATEGORY_CYCLE' });
  });

  test('slug bentrok → 409 CONFLICT', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories',
      token: editor.token,
      payload: { name: 'Apa saja', slug: `akar-${s}` },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).details).toEqual({ fields: ['slug'] });
  });

  test('hapus kategori yang masih dipakai → 409 IN_USE dengan jumlahnya (Q5)', async () => {
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/categories/${usedCategoryId}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('IN_USE');
    expect(errorBody(res).details).toMatchObject({ total: 1, counts: { Product: 1 } });
    expect(errorBody(res).message).toContain('1 produk');
  });

  test('hapus kategori yang masih punya anak → 409 IN_USE dengan counts.Category', async () => {
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/categories/${rootId}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    const details = errorBody(res).details as { counts: Record<string, number> };
    // Tes lain di berkas ini ikut menambah anak di bawah akar yang sama, jadi
    // yang dijamin adalah "ada subkategori", bukan angka pastinya.
    expect(details.counts.Category).toBeGreaterThanOrEqual(1);
    expect(errorBody(res).message).toContain('subkategori');
  });

  test('kategori kosong bisa dihapus (204)', async () => {
    const dibuat = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories',
      token: editor.token,
      payload: { name: `Sekali Pakai ${s}` },
    });
    const id = dibuat.json<{ data: AdminCategory }>().data.id;
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/categories/${id}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(204);
  });

  test('PUT /order menolak kiriman sebagian (CATEGORY_SET_MISMATCH)', async () => {
    const res = await adminRequest(app, {
      method: 'PUT',
      url: '/v1/admin/categories/order',
      token: editor.token,
      payload: { items: [{ id: rootId, parentId: null, position: 0 }] },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CATEGORY_SET_MISMATCH' });
  });

  test('PUT /order menerapkan urutan & induk baru untuk seluruh pohon', async () => {
    const semua = categoriesOf(
      await adminRequest(app, { method: 'GET', url: '/v1/admin/categories', token: editor.token }),
    );
    const items = semua.map((category) => ({
      id: category.id,
      parentId: category.parentId,
      // Anak dipindah ke posisi 5 agar perubahannya terlihat.
      position: category.id === childId ? 5 : category.position,
    }));

    const res = await adminRequest(app, {
      method: 'PUT',
      url: '/v1/admin/categories/order',
      token: editor.token,
      payload: { items },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(categoriesOf(res).find((c) => c.id === childId)?.position).toBe(5);
  });
});

// ── Kategori artikel lewat rute yang sama (Q4) ───────────────────────────────

describe('kategori artikel (type=ARTICLE)', () => {
  test('daftar memakai rute yang sama dengan type berbeda', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/categories?type=ARTICLE',
      token: editor.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = articleCategoriesOf(res).find((c) => c.id === usedArticleCategoryId);
    expect(found?.type).toBe('ARTICLE');
    expect(found?.articleCount).toBe(1);
    // Kategori artikel datar: tidak ada `parentId` di DTO-nya.
    expect(found).not.toHaveProperty('parentId');
  });

  test('id kategori produk tidak ditemukan pada type=ARTICLE → 404', async () => {
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/categories/${rootId}?type=ARTICLE`,
      token: editor.token,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });

  test('parentId pada type=ARTICLE → 400 (kategori artikel datar)', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories?type=ARTICLE',
      token: editor.token,
      payload: { name: `Proses ${s}`, parentId: rootId },
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ path: 'parentId' }]);
  });

  test('membuat, mengubah, dan menghapus kategori artikel', async () => {
    const dibuat = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/categories?type=ARTICLE',
      token: editor.token,
      payload: { name: `Material Journal ${s}`, position: 3 },
    });
    expect(dibuat.statusCode, dibuat.body).toBe(201);
    const created = dibuat.json<{ data: AdminArticleCategory }>().data;
    createdArticleCategoryIds.push(created.id);
    expect(created.type).toBe('ARTICLE');
    expect(created.slug).toBe(`material-journal-${s}`);
    expect(created.position).toBe(3);

    const diubah = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/categories/${created.id}?type=ARTICLE`,
      token: editor.token,
      payload: { description: 'Catatan material' },
    });
    expect(diubah.statusCode, diubah.body).toBe(200);
    expect(diubah.json<{ data: AdminArticleCategory }>().data.description).toBe('Catatan material');

    const dihapus = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/categories/${created.id}?type=ARTICLE`,
      token: editor.token,
    });
    expect(dihapus.statusCode).toBe(204);
  });

  test('hapus kategori artikel yang masih dipakai → 409 IN_USE dengan jumlahnya', async () => {
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/categories/${usedArticleCategoryId}?type=ARTICLE`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).details).toMatchObject({ total: 1, counts: { Article: 1 } });
    expect(errorBody(res).message).toContain('1 artikel');
  });
});

// ── Material ─────────────────────────────────────────────────────────────────

describe('material', () => {
  test('daftar urut nama dengan productCount turunan', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/materials?q=material-dipakai-${s}`,
      token: contributor.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = materialsOf(res).find((material) => material.id === usedMaterialId);
    expect(found?.productCount).toBe(1);
  });

  test('membuat material dengan skuCode dinormalisasi huruf besar', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/materials',
      token: editor.token,
      payload: { name: `Rotan Baru ${s}`, skuCode: 'rtx' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = materialOf(res);
    createdMaterialIds.push(created.id);
    expect(created.skuCode).toBe('RTX');
    expect(created.slug).toBe(`rotan-baru-${s}`);
    expect(created.productCount).toBe(0);
  });

  test('skuCode duplikat ditolak 409 CONFLICT', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/materials',
      token: editor.token,
      payload: { name: `Material Lain ${s}`, skuCode: 'RTX' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT');
    expect(errorBody(res).details).toEqual({ fields: ['skuCode'] });
  });

  test('skuCode harus tepat 3 huruf → 400 VALIDATION_FAILED', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/materials',
      token: editor.token,
      payload: { name: `Material Salah ${s}`, skuCode: 'RT1' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ path: 'skuCode' }]);
  });

  test('nama duplikat ditolak 409 CONFLICT', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/materials',
      token: editor.token,
      payload: { name: `Rotan Baru ${s}` },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).details).toEqual({ fields: ['name'] });
  });

  test('material yang masih dipakai tidak bisa dihapus → 409 IN_USE', async () => {
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/materials/${usedMaterialId}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).details).toMatchObject({ counts: { Product: 1 } });
  });

  test('material tanpa pemakaian bisa dihapus (204)', async () => {
    const dibuat = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/materials',
      token: editor.token,
      payload: { name: `Sekali Pakai Material ${s}` },
    });
    const id = materialOf(dibuat).id;
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/materials/${id}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(204);
  });

  test('mengubah skuCode tidak mengubah SKU produk lama (§6.2)', async () => {
    const produk = await prisma.product.findFirst({
      where: { materials: { some: { materialId: usedMaterialId } } },
      select: { id: true, sku: true },
    });
    expect(produk).not.toBeNull();

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/materials/${usedMaterialId}`,
      token: editor.token,
      payload: { skuCode: 'ZZZ' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(materialOf(res).skuCode).toBe('ZZZ');

    const setelah = await prisma.product.findUniqueOrThrow({
      where: { id: produk?.id ?? '' },
      select: { sku: true },
    });
    expect(setelah.sku).toBe(produk?.sku);
  });
});

// ── Tag ──────────────────────────────────────────────────────────────────────

describe('tag', () => {
  test('autocomplete prefix dengan jumlah pemakaian', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/tags?q=tag-${s}`,
      token: contributor.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = tagsOf(res).find((tag) => tag.id === tagId);
    expect(found?.usageCount).toBe(1);
  });

  test('limit dibatasi 20 (kontrak §5.7)', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/tags?limit=50',
      token: editor.token,
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });

  test('hapus tag melepasnya dari konten tanpa 409 (Cascade)', async () => {
    const lepas = await createTag(prisma, ids, `tag-lepas-${s}`);
    const produk = await prisma.product.findFirstOrThrow({
      where: { id: { in: ids.productIds } },
      select: { id: true },
    });
    await prisma.productTag.create({ data: { productId: produk.id, tagId: lepas } });

    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/tags/${lepas}`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(204);

    // Produknya tetap ada; hanya tautan tagnya yang hilang.
    const masihAda = await prisma.product.count({ where: { id: produk.id } });
    expect(masihAda).toBe(1);
  });

  test('tag tidak dikenal → 404', async () => {
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: '/v1/admin/tags/3fa85f64-5717-4562-b3fc-2c963f66afa6',
      token: editor.token,
    });
    expect(res.statusCode).toBe(404);
  });
});
