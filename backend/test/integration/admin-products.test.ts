import type {
  AdminProduct,
  AdminProductRow,
  BulkResult,
  PageMeta,
  ProductRevisionSummary,
} from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import {
  createArtisan,
  createCategory,
  createMaterial,
  createMedia,
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Admin produk (#24) terhadap database tes.
 *
 * Seluruh fixture dibuat sendiri dengan slug/email bersufiks acak dan
 * dibersihkan di `afterAll`; tidak ada satu pun assertion yang bergantung pada
 * data seed dev. Semua request melewati login sungguhan lewat
 * `/v1/admin/auth/login`, bukan baris `Session` yang disuntik langsung.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: CatalogFixtureIds = emptyFixtureIds();
const userIds: string[] = [];

const s = randomSuffix();
let categoryId = '';
let otherCategoryId = '';
let materialId = '';
let secondMaterialId = '';
let artisanId = '';
let archivedArtisanId = '';
let mediaId = '';
let privateMediaId = '';

interface Session {
  id: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: role.toLowerCase() });
  userIds.push(user.id);
  return { id: user.id, token: await loginToken(app, user.email, user.password) };
}

const dataOf = (res: LightMyRequestResponse): AdminProduct =>
  res.json<{ data: AdminProduct }>().data;
const rowsOf = (res: LightMyRequestResponse): { data: AdminProductRow[]; meta: PageMeta } =>
  res.json<{ data: AdminProductRow[]; meta: PageMeta }>();
const bulkOf = (res: LightMyRequestResponse): BulkResult => res.json<{ data: BulkResult }>().data;

/** `meta.counts` wajib ada pada daftar produk (kontrak §5.6: tab UI). */
function countsOf(meta: PageMeta): Record<string, number> {
  const counts = meta.counts;
  if (counts === undefined) throw new Error('meta.counts tidak dikirim pada daftar produk');
  return counts;
}

/** Body `POST /v1/admin/products` yang lengkap kecuali yang sengaja dihilangkan. */
function productPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `Produk Tes ${randomSuffix()}`,
    categoryId,
    moqQuantity: 50,
    moqUnit: 'pcs',
    ...overrides,
  };
}

/** Membuat produk lewat API lalu mencatatnya untuk dibersihkan. */
async function createViaApi(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<AdminProduct> {
  const res = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/products',
    token,
    payload: productPayload(overrides),
  });
  expect(res.statusCode, res.body).toBe(201);
  const product = dataOf(res);
  ids.productIds.push(product.id);
  return product;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false, adminOrigin: ADMIN_ORIGIN });

  categoryId = await createCategory(prisma, ids, { slug: `kat-${s}`, name: `Kategori ${s}` });
  otherCategoryId = await createCategory(prisma, ids, { slug: `kat-lain-${s}` });
  materialId = await createMaterial(prisma, ids, `rotan-${s}`, `Rotan ${s}`);
  secondMaterialId = await createMaterial(prisma, ids, `jati-${s}`, `Jati ${s}`);
  artisanId = await createArtisan(prisma, ids, { slug: `pengrajin-${s}`, regency: 'Bantul' });
  archivedArtisanId = await createArtisan(prisma, ids, {
    slug: `pengrajin-arsip-${s}`,
    archived: true,
  });
  mediaId = await createMedia(prisma, ids, { key: `foto-${s}` });
  privateMediaId = await createMedia(prisma, ids, { key: `privat-${s}`, visibility: 'PRIVATE' });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { actorId: { in: userIds } } });
  await deleteCatalogFixture(prisma, ids);
  await deleteTestUsers(prisma, userIds);
  await app.close();
});

// ── Matriks izin per endpoint (kontrak §3) ───────────────────────────────────

describe('matriks izin /v1/admin/products/*', () => {
  let target: AdminProduct;

  beforeAll(async () => {
    target = await createViaApi(admin.token);
  });

  const endpoints = [
    { method: 'GET' as const, url: () => '/v1/admin/products', roles: ['ADM', 'EDT', 'CTR'] },
    {
      method: 'GET' as const,
      url: (id: string) => `/v1/admin/products/${id}`,
      roles: ['ADM', 'EDT', 'CTR'],
    },
    {
      method: 'POST' as const,
      url: () => '/v1/admin/products/sku-suggestions',
      payload: {},
      roles: ['ADM', 'EDT', 'CTR'],
    },
    {
      method: 'POST' as const,
      url: (id: string) => `/v1/admin/products/${id}/publish`,
      payload: {},
      roles: ['ADM', 'EDT'],
    },
    {
      method: 'POST' as const,
      url: (id: string) => `/v1/admin/products/${id}/unpublish`,
      roles: ['ADM', 'EDT'],
    },
    {
      method: 'PATCH' as const,
      url: (id: string) => `/v1/admin/products/${id}/qc/MATERIAL`,
      payload: { status: 'IN_PROGRESS' },
      roles: ['ADM', 'EDT'],
    },
    {
      method: 'DELETE' as const,
      url: (id: string) => `/v1/admin/products/${id}/permanent`,
      roles: ['ADM'],
    },
  ];

  test('tanpa sesi selalu 401 UNAUTHENTICATED, sebelum validasi apa pun', async () => {
    for (const endpoint of endpoints) {
      const res = await adminRequest(app, {
        method: endpoint.method,
        url: endpoint.url(target.id),
        ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload }),
      });
      expect(res.statusCode, `${endpoint.method} ${endpoint.url(target.id)}`).toBe(401);
      expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    }
  });

  test('peran yang tidak cukup mendapat 403 FORBIDDEN, bukan 404 atau 400', async () => {
    const sessions = { ADM: admin, EDT: editor, CTR: contributor };
    for (const endpoint of endpoints) {
      for (const [code, session] of Object.entries(sessions)) {
        if (endpoint.roles.includes(code)) continue;
        const res = await adminRequest(app, {
          method: endpoint.method,
          url: endpoint.url(target.id),
          token: session.token,
          ...(endpoint.payload === undefined ? {} : { payload: endpoint.payload }),
        });
        expect(res.statusCode, `${code} ${endpoint.method} ${endpoint.url(target.id)}`).toBe(403);
        expect(errorBody(res).code).toBe('FORBIDDEN');
      }
    }
  });

  test('Editor ditolak 403 pada hapus permanen (Administrator saja, A3)', async () => {
    const trash = await createViaApi(admin.token);
    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${trash.id}`,
      token: admin.token,
    });

    const ditolak = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${trash.id}/permanent`,
      token: editor.token,
    });
    expect(ditolak.statusCode).toBe(403);
    expect(errorBody(ditolak).details).toMatchObject({ requiredRoles: ['ADMINISTRATOR'] });

    const diizinkan = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${trash.id}/permanent`,
      token: admin.token,
    });
    expect(diizinkan.statusCode).toBe(204);
  });
});

// ── Contributor: hanya draf miliknya (A1, kontrak §2.4) ──────────────────────

describe('batas Contributor (A1)', () => {
  test('boleh membuat dan mengedit draf miliknya sendiri', async () => {
    const product = await createViaApi(contributor.token);
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: contributor.token,
      payload: { expectedRevision: product.revision, excerpt: 'Ringkasan baru' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(dataOf(res).excerpt).toBe('Ringkasan baru');
  });

  test('draf milik orang lain → 403 dengan reason NOT_OWNER', async () => {
    const product = await createViaApi(admin.token);
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: contributor.token,
      payload: { expectedRevision: product.revision, excerpt: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toEqual({ reason: 'NOT_OWNER' });
  });

  test('produk terbit miliknya sendiri → 403 dengan reason NOT_DRAFT', async () => {
    const product = await publishable(contributor.token);
    const terbit = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(terbit.statusCode, terbit.body).toBe(200);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: contributor.token,
      payload: { expectedRevision: dataOf(terbit).revision, excerpt: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toEqual({ reason: 'NOT_DRAFT' });
  });

  test('mengirim slug → 403 FORBIDDEN_FIELD (slug milik Editor+, §6.1)', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: contributor.token,
      payload: productPayload({ slug: `slug-paksa-${randomSuffix()}` }),
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('FORBIDDEN_FIELD');
    expect(errorBody(res).details).toEqual({ fields: ['slug'] });
  });

  test('boleh membaca produk orang lain (§3.2: baca ✓✓✓)', async () => {
    const product = await createViaApi(admin.token);
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: contributor.token,
    });
    expect(res.statusCode).toBe(200);
  });

  test('revisi produk orang lain → 403 NOT_OWNER (snapshot 🔒)', async () => {
    const product = await createViaApi(admin.token);
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}/revisions`,
      token: contributor.token,
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toEqual({ reason: 'NOT_OWNER' });
  });
});

/** Produk yang sudah memenuhi seluruh syarat publish §6.3. */
async function publishable(token: string, overrides: Record<string, unknown> = {}) {
  return createViaApi(token, {
    sku: `ORN-TES-${randomSuffix().toUpperCase().slice(0, 6)}`,
    artisanId,
    primaryImageId: mediaId,
    materials: [{ materialId, isPrimary: true }],
    ...overrides,
  });
}

// ── Syarat publish (model §6.3) ──────────────────────────────────────────────

describe('syarat publish (§6.3)', () => {
  test('draf kosong ditolak 422 dengan daftar field yang kurang', async () => {
    const product = await createViaApi(editor.token);
    expect(product.publishReadiness).toEqual({
      ready: false,
      missing: ['sku', 'artisanId', 'primaryImageId', 'materials'],
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('PUBLISH_REQUIREMENTS_NOT_MET');
    expect(errorBody(res).details).toEqual([
      { path: 'sku', code: 'required' },
      { path: 'artisanId', code: 'required' },
      { path: 'primaryImageId', code: 'required' },
      { path: 'materials', code: 'required' },
    ]);
  });

  test('setelah dilengkapi, produk terbit dan publishedAt terisi', async () => {
    const product = await publishable(editor.token);
    expect(product.publishReadiness.ready).toBe(true);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(dataOf(res).publishStatus).toBe('PUBLISHED');
    expect(dataOf(res).publishedAt).not.toBeNull();
  });

  test('pengrajin yang diarsipkan menahan publikasi dengan kode tersendiri', async () => {
    const product = await publishable(editor.token, { artisanId: archivedArtisanId });
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual([{ path: 'artisanId', code: 'artisan_archived' }]);
  });

  test('PATCH tidak boleh membuat produk terbit menjadi tidak layak tayang', async () => {
    const product = await publishable(editor.token);
    const terbit = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: dataOf(terbit).revision, primaryImageId: null },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('PUBLISH_REQUIREMENTS_NOT_MET');

    // Transaksi dibatalkan seutuhnya: produk masih punya foto utama.
    const setelah = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    expect(dataOf(setelah).primaryImage).not.toBeNull();
  });
});

// ── Konkurensi (kontrak §1.9) ────────────────────────────────────────────────

describe('expectedRevision (§1.9)', () => {
  test('revisi basi → 409 EDIT_CONFLICT dengan revisi terkini', async () => {
    const product = await createViaApi(editor.token);
    const pertama = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: product.revision, excerpt: 'v2' },
    });
    expect(pertama.statusCode).toBe(200);

    const kedua = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: product.revision, excerpt: 'v3' },
    });
    expect(kedua.statusCode).toBe(409);
    expect(errorBody(kedua).code).toBe('EDIT_CONFLICT');
    expect(errorBody(kedua).details).toMatchObject({
      currentRevision: dataOf(pertama).revision,
      updatedBy: { id: editor.id },
    });
  });

  test('expectedRevision wajib pada PATCH (kontrak §1.9)', async () => {
    const product = await createViaApi(editor.token);
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { excerpt: 'tanpa revisi' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });
});

// ── Revisi (model §6.3) ──────────────────────────────────────────────────────

describe('ProductRevision (§6.3)', () => {
  test('setiap simpan menaikkan revisi dan menulis snapshot', async () => {
    const product = await createViaApi(editor.token);
    expect(product.revision).toBe(1);

    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: 1, excerpt: 'v2' },
    });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}/revisions`,
      token: editor.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const revisions = res.json<{ data: ProductRevisionSummary[] }>().data;
    expect(revisions.map((revision) => revision.number)).toEqual([2, 1]);
    expect(revisions[0]?.editedBy).toMatchObject({ id: editor.id });

    const detail = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}/revisions/1`,
      token: editor.token,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ data: { snapshot: AdminProduct } }>().data.snapshot.excerpt).toBeNull();
  });
});

// ── Duplikat (model §6.3) ────────────────────────────────────────────────────

describe('duplikat (§6.3)', () => {
  test('menghasilkan draf tanpa SKU dengan QC tereset', async () => {
    const source = await publishable(editor.token);
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${source.id}/qc/MATERIAL`,
      token: editor.token,
      payload: { status: 'PASSED', criteria: 'Kadar air rotan dicatat', notes: 'catatan internal' },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${source.id}/duplicate`,
      token: editor.token,
    });
    expect(res.statusCode, res.body).toBe(201);
    const copy = dataOf(res);
    ids.productIds.push(copy.id);

    expect(copy.name).toBe(`${source.name} (copy)`);
    expect(copy.slug).toBe(`${source.slug}-copy`);
    expect(copy.sku).toBeNull();
    expect(copy.publishStatus).toBe('DRAFT');
    expect(copy.publishedAt).toBeNull();
    expect(copy.revision).toBe(1);
    expect(copy.duplicatedFromId).toBe(source.id);
    // Isi produk ikut tersalin …
    expect(copy.materials).toHaveLength(1);
    expect(copy.primaryImage?.id).toBe(mediaId);
    // … tetapi hasil pemeriksaan QC tidak (Q6).
    expect(copy.qcChecks.map((check) => check.status)).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    expect(copy.qcChecks.every((check) => check.checkedBy === null)).toBe(true);
    expect(copy.qcChecks.every((check) => check.notes === null)).toBe(true);
    // `criteria` adalah isi produk, jadi ikut tersalin.
    expect(copy.qcChecks[0]?.criteria).toBe('Kadar air rotan dicatat');
  });
});

// ── Trash & restore (model §6.4) ─────────────────────────────────────────────

describe('Trash dan restore (§6.4)', () => {
  test('restore SELALU menghasilkan DRAFT, bahkan dari produk terbit (Q3)', async () => {
    const product = await publishable(editor.token);
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });

    const trash = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    expect(trash.statusCode, trash.body).toBe(200);
    expect(trash.json<{ data: { deletedAt: string } }>().data.deletedAt).not.toBeNull();

    const restore = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/restore`,
      token: editor.token,
    });
    expect(restore.statusCode, restore.body).toBe(200);
    expect(dataOf(restore).publishStatus).toBe('DRAFT');
    expect(dataOf(restore).deletedAt).toBeNull();
    // `publishedAt` dipertahankan: ia jejak pernah tayang, bukan status kini.
    expect(dataOf(restore).publishedAt).not.toBeNull();
  });

  test('trash dua kali → 409 INVALID_STATE', async () => {
    const product = await createViaApi(editor.token);
    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    const lagi = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    expect(lagi.statusCode).toBe(409);
    expect(errorBody(lagi).code).toBe('INVALID_STATE');
  });

  test('restore produk yang tidak di Trash → 409 INVALID_STATE', async () => {
    const product = await createViaApi(editor.token);
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/restore`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });

  test('hapus permanen hanya untuk yang sudah di Trash', async () => {
    const product = await createViaApi(admin.token);
    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${product.id}/permanent`,
      token: admin.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });
});

// ── Daftar: tab, filter, pencarian (kontrak §5.6) ────────────────────────────

describe('daftar produk (§5.6)', () => {
  let terbit: AdminProduct;
  let draf: AdminProduct;
  let diTrash: AdminProduct;

  beforeAll(async () => {
    terbit = await publishable(admin.token, { name: `Kursi Rotan Daftar ${s}` });
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${terbit.id}/publish`,
      token: admin.token,
      payload: {},
    });
    draf = await createViaApi(admin.token, { name: `Draf Daftar ${s}`, artisanId });
    diTrash = await createViaApi(admin.token, { name: `Trash Daftar ${s}` });
    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/products/${diTrash.id}`,
      token: admin.token,
    });
  });

  test('default menyembunyikan Trash; meta.counts mengisi tab', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?categoryId=${categoryId}&pageSize=100`,
      token: admin.token,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { data, meta } = rowsOf(res);

    const idsInList = data.map((row) => row.id);
    expect(idsInList).toContain(terbit.id);
    expect(idsInList).toContain(draf.id);
    expect(idsInList).not.toContain(diTrash.id);

    const counts = countsOf(meta);
    expect(counts.all).toBe((counts.PUBLISHED ?? 0) + (counts.DRAFT ?? 0));
    expect(counts.PUBLISHED).toBeGreaterThanOrEqual(1);
    expect(counts.trash).toBeGreaterThanOrEqual(1);
  });

  test('tab Trash menampilkan hanya baris di Trash', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?categoryId=${categoryId}&trashed=true&pageSize=100`,
      token: admin.token,
    });
    const { data } = rowsOf(res);
    expect(data.map((row) => row.id)).toContain(diTrash.id);
    expect(data.every((row) => row.deletedAt !== null)).toBe(true);
  });

  test('counts tidak terpengaruh filter tab itu sendiri (§1.4)', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?categoryId=${categoryId}&publishStatus=DRAFT&pageSize=100`,
      token: admin.token,
    });
    const { data, meta } = rowsOf(res);
    expect(data.every((row) => row.publishStatus === 'DRAFT')).toBe(true);
    // `counts.PUBLISHED` tetap terisi walau filternya DRAFT.
    expect(countsOf(meta).PUBLISHED).toBeGreaterThanOrEqual(1);
  });

  test('filter kategori, material, daerah, dan pencarian q', async () => {
    const lain = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?categoryId=${otherCategoryId}&pageSize=100`,
      token: admin.token,
    });
    expect(rowsOf(lain).data.map((row) => row.id)).not.toContain(terbit.id);

    const byMaterial = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?materialId=${materialId}&pageSize=100`,
      token: admin.token,
    });
    expect(rowsOf(byMaterial).data.map((row) => row.id)).toContain(terbit.id);

    const byRegency = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?regency=Bantul&categoryId=${categoryId}&pageSize=100`,
      token: admin.token,
    });
    expect(rowsOf(byRegency).data.map((row) => row.id)).toContain(terbit.id);

    const byQuery = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products?q=${encodeURIComponent(`Kursi Rotan Daftar ${s}`)}`,
      token: admin.token,
    });
    expect(rowsOf(byQuery).data.map((row) => row.id)).toEqual([terbit.id]);
  });

  test('sort di luar allowlist → 400 VALIDATION_FAILED (§1.7)', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/products?sort=stockNote',
      token: admin.token,
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
  });

  test('halaman di luar rentang → 200 dengan data kosong, bukan 404 (§1.6)', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/products?page=9999',
      token: admin.token,
    });
    expect(res.statusCode).toBe(200);
    expect(rowsOf(res).data).toEqual([]);
  });
});

// ── Aksi massal (kontrak §5, §5.6) ───────────────────────────────────────────

describe('aksi massal (§5.6)', () => {
  test('sebagian boleh gagal: BulkResult memuat sukses dan kegagalan', async () => {
    const siap = await publishable(editor.token);
    const belumSiap = await createViaApi(editor.token);

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: editor.token,
      payload: { action: 'PUBLISH', ids: [siap.id, belumSiap.id] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = bulkOf(res);
    expect(result.succeeded).toEqual([siap.id]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({
      id: belumSiap.id,
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
    });
  });

  test('izin dicek per item: Contributor gagal pada PUBLISH, berhasil pada TRASH miliknya', async () => {
    const milikSendiri = await createViaApi(contributor.token);
    const milikOrangLain = await createViaApi(admin.token);

    const publish = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: contributor.token,
      payload: { action: 'PUBLISH', ids: [milikSendiri.id] },
    });
    expect(publish.statusCode).toBe(200);
    expect(bulkOf(publish).failed[0]).toMatchObject({ code: 'FORBIDDEN' });

    const trash = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: contributor.token,
      payload: { action: 'TRASH', ids: [milikSendiri.id, milikOrangLain.id] },
    });
    const result = bulkOf(trash);
    expect(result.succeeded).toEqual([milikSendiri.id]);
    expect(result.failed[0]).toMatchObject({ id: milikOrangLain.id, code: 'FORBIDDEN' });
  });

  test('SET_STOCK_OVERRIDE wajib mengirim field-nya (boleh null)', async () => {
    const product = await createViaApi(editor.token);
    const tanpaField = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: editor.token,
      payload: { action: 'SET_STOCK_OVERRIDE', ids: [product.id] },
    });
    expect(tanpaField.statusCode).toBe(400);

    const denganField = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: editor.token,
      payload: {
        action: 'SET_STOCK_OVERRIDE',
        ids: [product.id],
        stockStatusOverride: 'MADE_TO_ORDER',
      },
    });
    expect(denganField.statusCode).toBe(200);
    expect(bulkOf(denganField).succeeded).toEqual([product.id]);

    const setelah = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    expect(dataOf(setelah).stockStatus).toBe('MADE_TO_ORDER');
  });

  test('id tidak dikenal menjadi item gagal, bukan menggagalkan seluruh request', async () => {
    const product = await createViaApi(editor.token);
    const hilang = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/bulk',
      token: editor.token,
      payload: { action: 'TRASH', ids: [product.id, hilang] },
    });
    expect(res.statusCode).toBe(200);
    expect(bulkOf(res).succeeded).toEqual([product.id]);
    expect(bulkOf(res).failed[0]).toMatchObject({ id: hilang, code: 'NOT_FOUND' });
  });
});

// ── Stok (model §6.3 Q13, A11) ───────────────────────────────────────────────

describe('status stok turunan (§6.3)', () => {
  test('dihitung server setiap simpan, tidak diambil dari klien', async () => {
    const product = await createViaApi(editor.token, { stockQuantity: 100 });
    expect(product.stockStatus).toBe('IN_STOCK');

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: product.revision, stockQuantity: 1 },
    });
    expect(dataOf(res).stockStatus).toBe('LOW_STOCK');
    expect(dataOf(res).effectiveLowStockThreshold).toBeGreaterThanOrEqual(1);
  });

  test('stockStatus tidak bisa dikirim klien (field read-only, §1.3)', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ stockStatus: 'IN_STOCK' }),
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ code: 'unrecognized_keys' }]);
  });

  test('A11: override MADE_TO_ORDER dengan stockQuantity → 400', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ stockQuantity: 5, stockStatusOverride: 'MADE_TO_ORDER' }),
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ path: 'stockQuantity' }]);
  });
});

// ── Slug & redirect (model §6.1, §6.10) ──────────────────────────────────────

describe('slug dan SlugRedirect (§6.1, §6.10)', () => {
  test('slug diturunkan dari nama dan diberi akhiran saat bentrok', async () => {
    const nama = `Kursi Bentrok ${s}`;
    const pertama = await createViaApi(editor.token, { name: nama });
    const kedua = await createViaApi(editor.token, { name: nama });
    expect(kedua.slug).toBe(`${pertama.slug}-2`);
  });

  test('slug eksplisit yang bentrok → 409 CONFLICT, bukan diberi akhiran diam-diam', async () => {
    const pertama = await createViaApi(editor.token);
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ slug: pertama.slug }),
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT');
    expect(errorBody(res).details).toEqual({ fields: ['slug'] });
  });

  test('SKU duplikat → 409 CONFLICT pada field sku', async () => {
    const sku = `ORN-DUP-${randomSuffix().toUpperCase().slice(0, 6)}`;
    await createViaApi(editor.token, { sku });
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ sku }),
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).details).toEqual({ fields: ['sku'] });
  });

  test('slug berubah → redirect lama dibuat dan ditemukan endpoint publik', async () => {
    const product = await publishable(editor.token);
    const slugLama = product.slug;
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });

    const terkini = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    const slugBaru = `${slugLama}-v2`;
    const ubah = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: dataOf(terkini).revision, slug: slugBaru },
    });
    expect(ubah.statusCode, ubah.body).toBe(200);
    expect(dataOf(ubah).slug).toBe(slugBaru);

    const redirect = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PRODUCT&slug=${slugLama}`,
    });
    expect(redirect.statusCode, redirect.body).toBe(200);
    expect(
      redirect.json<{ data: { toSlug: string; path: string; statusCode: number } }>().data,
    ).toEqual({
      type: 'PRODUCT',
      fromSlug: slugLama,
      toSlug: slugBaru,
      path: `/produk/${slugBaru}`,
      statusCode: 301,
    });
  });

  test('slug aktif selalu menang: redirect ke slug yang kini hidup dihapus (§6.10)', async () => {
    const product = await publishable(editor.token);
    const slugAwal = product.slug;
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/products/${product.id}/publish`,
      token: editor.token,
      payload: {},
    });

    // A → B (redirect A→B dibuat) …
    const r1 = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: dataOf(r1).revision, slug: `${slugAwal}-b` },
    });
    // … lalu B → A: redirect A→B harus hilang, diganti B→A.
    const r2 = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: { expectedRevision: dataOf(r2).revision, slug: slugAwal },
    });

    const kePermulaan = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PRODUCT&slug=${slugAwal}`,
    });
    expect(kePermulaan.statusCode).toBe(404);

    const keB = await app.inject({
      method: 'GET',
      url: `/v1/public/redirects?type=PRODUCT&slug=${slugAwal}-b`,
    });
    expect(keB.statusCode).toBe(200);
    expect(keB.json<{ data: { toSlug: string } }>().data.toSlug).toBe(slugAwal);
  });
});

// ── QC & saran SKU ───────────────────────────────────────────────────────────

describe('QC dan saran SKU (§5.6)', () => {
  test('empat baris QC dibuat bersama produk dan status berubah tanpa menaikkan revisi', async () => {
    const product = await createViaApi(editor.token);
    expect(product.qcChecks.map((check) => check.stage)).toEqual([
      'MATERIAL',
      'FRAME',
      'FINISHING',
      'PACKAGING',
    ]);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}/qc/FRAME`,
      token: editor.token,
      payload: { status: 'PASSED', notes: 'catatan internal 🔒' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const check = res.json<{ data: { status: string; checkedBy: { id: string } | null } }>().data;
    expect(check.status).toBe('PASSED');
    expect(check.checkedBy).toMatchObject({ id: editor.id });

    const setelah = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
    });
    expect(dataOf(setelah).revision).toBe(product.revision);
  });

  test('tahap QC di luar enum → 400 VALIDATION_FAILED', async () => {
    const product = await createViaApi(editor.token);
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}/qc/TIDAK_ADA`,
      token: editor.token,
      payload: { status: 'PASSED' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('saran SKU memakai skuCode material primer, dan YYMM bila tidak ada', async () => {
    await prisma.material.update({ where: { id: materialId }, data: { skuCode: 'RTN' } });

    const dengan = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/sku-suggestions',
      token: contributor.token,
      payload: { materialId },
    });
    expect(dengan.statusCode, dengan.body).toBe(200);
    expect(dengan.json<{ data: { sku: string } }>().data.sku).toMatch(/^ORN-RTN-\d{4,}$/);

    const tanpa = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/sku-suggestions',
      token: contributor.token,
      payload: {},
    });
    expect(tanpa.json<{ data: { sku: string } }>().data.sku).toMatch(/^ORN-\d{4}-\d{4,}$/);

    // Nomor sequence tidak pernah dipakai ulang (§6.2).
    const lagi = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/sku-suggestions',
      token: contributor.token,
      payload: { materialId },
    });
    expect(lagi.json<{ data: { sku: string } }>().data.sku).not.toBe(
      dengan.json<{ data: { sku: string } }>().data.sku,
    );
  });

  test('materialId tak dikenal pada saran SKU → 404', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products/sku-suggestions',
      token: editor.token,
      payload: { materialId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Relasi & media (kontrak §5.6) ────────────────────────────────────────────

describe('relasi produk (§1.3, §5.6)', () => {
  test('array mengganti seluruh isi saat dikirim (§1.3)', async () => {
    const product = await createViaApi(editor.token, {
      materials: [{ materialId, isPrimary: true }],
      tags: ['handwoven', 'Bantul'],
      specs: [{ label: 'Finishing', value: 'Natural' }],
    });
    expect(product.materials).toHaveLength(1);
    expect(product.tags.map((tag) => tag.slug).sort()).toEqual(['bantul', 'handwoven']);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/products/${product.id}`,
      token: editor.token,
      payload: {
        expectedRevision: product.revision,
        materials: [
          { materialId, isPrimary: true },
          { materialId: secondMaterialId, isPrimary: false },
        ],
        tags: [],
        specs: [],
      },
    });
    expect(dataOf(res).materials).toHaveLength(2);
    expect(dataOf(res).tags).toEqual([]);
    expect(dataOf(res).specs).toEqual([]);
  });

  test('Contributor tidak bisa menambah tag baru, tetapi boleh memakai yang sudah ada', async () => {
    // Aturan yang sama dengan artikel: `Tag` satu tabel untuk keduanya, jadi
    // membuat baris di sana adalah `taxonomy.write` (Editor+), bukan menulis
    // draf sendiri.
    const tagName = `Tag Produk Kurasi ${randomSuffix()}`;

    const ditolak = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: contributor.token,
      payload: productPayload({ tags: [tagName] }),
    });
    expect(ditolak.statusCode).toBe(403);
    expect(errorBody(ditolak).details).toMatchObject({
      reason: 'TAG_NOT_FOUND',
      unknownTags: [tagName],
    });

    // Setelah Editor membuatnya, Contributor bisa memakainya.
    const olehEditor = await createViaApi(editor.token, { tags: [tagName] });
    const slug = olehEditor.tags[0]?.slug ?? '';
    expect(slug).not.toBe('');

    const diterima = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: contributor.token,
      payload: productPayload({ tags: [tagName] }),
    });
    expect(diterima.statusCode).toBe(201);
    ids.productIds.push(dataOf(diterima).id);
    expect(dataOf(diterima).tags.map((tag) => tag.slug)).toEqual([slug]);
  });

  test('dua material primer ditolak 400 (bentuk yang tidak pernah sah)', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({
        materials: [
          { materialId, isPrimary: true },
          { materialId: secondMaterialId, isPrimary: true },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ path: 'materials' }]);
  });

  test('media PRIVATE ditolak 422 PRIVATE_MEDIA_NOT_ALLOWED', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ primaryImageId: privateMediaId }),
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('BUSINESS_RULE_VIOLATION');
    expect(errorBody(res).details).toEqual({ rule: 'PRIVATE_MEDIA_NOT_ALLOWED' });
  });

  test('kategori tak dikenal → 422 CATEGORY_NOT_FOUND', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ categoryId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }),
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CATEGORY_NOT_FOUND' });
  });

  test('galeri tidak boleh memuat foto utama (model §3.5)', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/products',
      token: editor.token,
      payload: productPayload({ primaryImageId: mediaId, images: [mediaId] }),
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).details).toMatchObject([{ path: 'images' }]);
  });
});

// ── Idempotensi opsional (kontrak §1.8) ──────────────────────────────────────

describe('Idempotency-Key pada duplicate dan bulk (§1.8)', () => {
  test('duplicate dengan key sama hanya membuat satu salinan', async () => {
    const source = await createViaApi(editor.token);
    const key = `dup-${randomSuffix()}${randomSuffix()}`;

    const pertama = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${source.id}/duplicate`,
      headers: {
        origin: ADMIN_ORIGIN,
        cookie: `__Host-osa_session=${editor.token}`,
        'idempotency-key': key,
      },
    });
    expect(pertama.statusCode, pertama.body).toBe(201);
    ids.productIds.push(dataOf(pertama).id);

    const kedua = await app.inject({
      method: 'POST',
      url: `/v1/admin/products/${source.id}/duplicate`,
      headers: {
        origin: ADMIN_ORIGIN,
        cookie: `__Host-osa_session=${editor.token}`,
        'idempotency-key': key,
      },
    });
    expect(kedua.statusCode).toBe(201);
    expect(kedua.headers['idempotent-replayed']).toBe('true');
    expect(dataOf(kedua).id).toBe(dataOf(pertama).id);

    const salinan = await prisma.product.count({ where: { duplicatedFromId: source.id } });
    expect(salinan).toBe(1);
  });
});
