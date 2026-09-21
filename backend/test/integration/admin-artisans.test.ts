import type {
  AdminArtisan,
  AdminArtisanRow,
  ArtisanArchived,
  ArtisanDocumentDto,
  ArtisanRedacted,
  PageMeta,
} from '@ornament/shared';
import { ARTISAN_PRIVATE_FIELDS } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import {
  createCategory,
  createMedia,
  createProduct,
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Admin pengrajin (#26) terhadap database tes — kontrak §5.8, model §6.7.
 *
 * Tiga hal yang paling mahal bila salah, dan karena itu diuji secara eksplisit:
 * 1. **Field 🔒 tidak pernah sampai ke Contributor** (kontrak §3.1/§5.8), dan
 *    tidak ada sama sekali — bukan `null`.
 * 2. **Dokumen privat tidak pernah bocor ke `/v1/public/*`** (kontrak §4).
 * 3. **Arsip (A10)**: profil publik `404`, tetapi produk terbitnya tetap tayang.
 *
 * Fixture dibuat dengan slug bersufiks acak; tidak ada assertion yang
 * bergantung pada data seed dev.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: CatalogFixtureIds = emptyFixtureIds();
const userIds: string[] = [];

const s = randomSuffix();
let publicMediaId = '';
let privateMediaId = '';
let secondPrivateMediaId = '';
let categoryId = '';

interface Session {
  id: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `art-${role.toLowerCase()}` });
  userIds.push(user.id);
  return { id: user.id, token: await loginToken(app, user.email, user.password) };
}

const artisanOf = (res: LightMyRequestResponse): AdminArtisan =>
  res.json<{ data: AdminArtisan }>().data;
const redactedOf = (res: LightMyRequestResponse): ArtisanRedacted =>
  res.json<{ data: ArtisanRedacted }>().data;
const rowsOf = (res: LightMyRequestResponse): AdminArtisanRow[] =>
  res.json<{ data: AdminArtisanRow[] }>().data;
const metaOf = (res: LightMyRequestResponse): PageMeta => res.json<{ meta: PageMeta }>().meta;
const documentsOf = (res: LightMyRequestResponse): ArtisanDocumentDto[] =>
  res.json<{ data: ArtisanDocumentDto[] }>().data;
const documentOf = (res: LightMyRequestResponse): ArtisanDocumentDto =>
  res.json<{ data: ArtisanDocumentDto }>().data;

/** Body `ArtisanInput` lengkap, termasuk keempat field 🔒. */
function artisanBody(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    name: `Pengrajin ${suffix}`,
    regency: `Bantul-${s}`,
    province: 'DI Yogyakarta',
    village: 'Bangunjiwo',
    skills: ['anyaman rotan', 'rangka besi'],
    summary: 'Workshop keluarga.',
    contactName: 'Pak Rahasia',
    phone: '+62 812-3456-789',
    address: 'Jl. Rahasia No. 1, RT 03',
    internalNotes: 'Catatan negosiasi internal.',
    monthlyCapacity: 600,
    ...extra,
  };
}

/** Membuat pengrajin lewat API sebagai Editor dan mencatatnya untuk dibersihkan. */
async function createViaApi(suffix: string, extra: Record<string, unknown> = {}) {
  const res = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/artisans',
    token: editor.token,
    payload: artisanBody(suffix, extra),
  });
  if (res.statusCode !== 201) throw new Error(`fixture pengrajin gagal: ${res.body}`);
  const artisan = artisanOf(res);
  ids.artisanIds.push(artisan.id);
  return artisan;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    // Job publikasi terjadwal dimatikan: berkas ini tidak mengujinya, dan
    // timer latar tidak boleh ikut memengaruhi hasil.
    scheduledPublish: false,
  });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');

  categoryId = await createCategory(prisma, ids, { slug: `kat-art-${s}`, name: `Kat ${s}` });
  publicMediaId = await createMedia(prisma, ids, { key: `foto-workshop-${s}` });
  privateMediaId = await createMedia(prisma, ids, {
    key: `ktp-${s}`,
    visibility: 'PRIVATE',
    alt: null,
  });
  secondPrivateMediaId = await createMedia(prisma, ids, {
    key: `kontrak-${s}`,
    visibility: 'PRIVATE',
    alt: null,
  });
});

afterAll(async () => {
  await deleteCatalogFixture(prisma, ids);
  await deleteTestUsers(prisma, userIds);
  await app.close();
});

describe('GET /v1/admin/artisans', () => {
  test('daftar memuat meta.counts per status + archived', async () => {
    await createViaApi(`daftar-a-${s}`);
    await createViaApi(`daftar-b-${s}`);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans?regency=bantul-${s}&pageSize=1`,
      token: contributor.token,
    });
    expect(res.statusCode).toBe(200);

    const meta = metaOf(res);
    expect(rowsOf(res)).toHaveLength(1);
    expect(meta.pageSize).toBe(1);
    expect(meta.total).toBeGreaterThanOrEqual(2);
    expect(meta.counts?.VERIFICATION).toBeGreaterThanOrEqual(2);
    expect(meta.counts?.archived).toBe(0);
    // `regency` dicocokkan tanpa memperhatikan besar-kecil huruf.
    expect(rowsOf(res)[0]?.regency).toBe(`Bantul-${s}`);
  });

  test('pencarian q mencocokkan nama, dan sort di luar allowlist ditolak 400', async () => {
    const found = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans?q=daftar-a-${s}`,
      token: editor.token,
    });
    expect(found.statusCode).toBe(200);
    expect(rowsOf(found).every((row) => row.name.includes(`daftar-a-${s}`))).toBe(true);

    const bad = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/artisans?sort=internalNotes',
      token: editor.token,
    });
    expect(bad.statusCode).toBe(400);
    expect(errorBody(bad).code).toBe('VALIDATION_FAILED');
  });

  test('baris daftar tidak pernah memuat field 🔒', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans?q=daftar-a-${s}`,
      token: admin.token,
    });
    for (const row of rowsOf(res) as unknown as Record<string, unknown>[]) {
      for (const field of ARTISAN_PRIVATE_FIELDS) expect(field in row).toBe(false);
    }
  });
});

describe('matriks izin (kontrak §3.1)', () => {
  test('tanpa sesi → 401 pada baca maupun tulis', async () => {
    const list = await adminRequest(app, { method: 'GET', url: '/v1/admin/artisans' });
    expect(list.statusCode).toBe(401);

    const create = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/artisans',
      payload: artisanBody(`anon-${s}`),
    });
    expect(create.statusCode).toBe(401);
  });

  test('Contributor boleh membaca tetapi tidak boleh menulis', async () => {
    const artisan = await createViaApi(`izin-${s}`);

    const read = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: contributor.token,
    });
    expect(read.statusCode).toBe(200);

    const writes: {
      method: 'POST' | 'PATCH' | 'DELETE' | 'GET';
      url: string;
      payload?: unknown;
    }[] = [
      { method: 'POST', url: '/v1/admin/artisans', payload: artisanBody(`tolak-${s}`) },
      {
        method: 'PATCH',
        url: `/v1/admin/artisans/${artisan.id}`,
        payload: { name: 'Baru', expectedUpdatedAt: artisan.updatedAt },
      },
      { method: 'POST', url: `/v1/admin/artisans/${artisan.id}/archive` },
      { method: 'POST', url: `/v1/admin/artisans/${artisan.id}/unarchive` },
      { method: 'GET', url: `/v1/admin/artisans/${artisan.id}/documents` },
      {
        method: 'POST',
        url: `/v1/admin/artisans/${artisan.id}/documents`,
        payload: { mediaId: privateMediaId, kind: 'IDENTITY', title: 'KTP' },
      },
      {
        method: 'GET',
        url: `/v1/admin/artisans/${artisan.id}/documents/${artisan.id}/url`,
      },
    ];

    for (const request of writes) {
      const res = await adminRequest(app, { ...request, token: contributor.token });
      expect({ url: request.url, status: res.statusCode }).toEqual({
        url: request.url,
        status: 403,
      });
      expect(errorBody(res).code).toBe('FORBIDDEN');
    }
  });
});

describe('DTO per peran (kontrak §5.8)', () => {
  test('Editor+ melihat field 🔒; Contributor tidak melihatnya sama sekali', async () => {
    const artisan = await createViaApi(`privasi-${s}`);

    const asEditor = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
    });
    const full = artisanOf(asEditor);
    expect(full.phone).toBe('+628123456789');
    expect(full.contactName).toBe('Pak Rahasia');
    expect(full.address).toContain('Jl. Rahasia');
    expect(full.internalNotes).toBe('Catatan negosiasi internal.');

    const asContributor = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: contributor.token,
    });
    expect(asContributor.statusCode).toBe(200);
    const redacted = redactedOf(asContributor) as unknown as Record<string, unknown>;
    for (const field of ARTISAN_PRIVATE_FIELDS) {
      expect(field in redacted).toBe(false);
    }
    // Yang publik tetap ada: Contributor butuh konteks untuk menulis draf.
    expect(redacted.regency).toBe(`Bantul-${s}`);
    expect(redacted.publishedProductCount).toBe(0);
    // Nilai 🔒 tidak muncul di mana pun, termasuk sebagai substring body.
    expect(asContributor.body).not.toContain('Rahasia');
    expect(asContributor.body).not.toContain('628123456789');
  });
});

describe('POST / PATCH /v1/admin/artisans', () => {
  test('pengrajin baru selalu VERIFICATION dan slug dibuat dari nama', async () => {
    const artisan = await createViaApi(`baru-${s}`);
    expect(artisan.status).toBe('VERIFICATION');
    expect(artisan.slug).toBe(`pengrajin-baru-${s}`);
    expect(artisan.archivedAt).toBeNull();
    expect(artisan.phone).toBe('+628123456789');
  });

  test('slug eksplisit yang bentrok → 409 CONFLICT', async () => {
    const artisan = await createViaApi(`slug-${s}`);
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/artisans',
      token: editor.token,
      payload: artisanBody(`slug-lain-${s}`, { slug: artisan.slug }),
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT');
    expect(errorBody(res).details).toEqual({ fields: ['slug'] });
  });

  test('media PRIVATE tidak boleh dipakai sebagai foto/galeri publik', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/artisans',
      token: editor.token,
      payload: artisanBody(`foto-privat-${s}`, { photoId: privateMediaId }),
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('BUSINESS_RULE_VIOLATION');
    expect(errorBody(res).details).toEqual({ rule: 'PRIVATE_MEDIA_NOT_ALLOWED' });
  });

  test('expectedUpdatedAt basi → 409 EDIT_CONFLICT; yang segar tersimpan', async () => {
    const artisan = await createViaApi(`konkuren-${s}`);

    const ok = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
      payload: {
        expectedUpdatedAt: artisan.updatedAt,
        status: 'ACTIVE',
        images: [{ mediaId: publicMediaId, caption: 'Proses anyam' }],
      },
    });
    expect(ok.statusCode).toBe(200);
    const saved = artisanOf(ok);
    expect(saved.status).toBe('ACTIVE');
    expect(saved.images).toHaveLength(1);
    expect(saved.images[0]?.caption).toBe('Proses anyam');

    const stale = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: artisan.updatedAt, name: 'Nama lain' },
    });
    expect(stale.statusCode).toBe(409);
    expect(errorBody(stale).code).toBe('EDIT_CONFLICT');
    expect(errorBody(stale).details).toMatchObject({ updatedAt: saved.updatedAt });
  });
});

describe('arsip & pulihkan (model §6.7, A10)', () => {
  test('arsip memberi peringatan, profil publik 404, produknya tetap tayang', async () => {
    const artisan = await createViaApi(`arsip-${s}`);

    // Aktifkan dulu supaya profilnya memang pernah tayang publik.
    const activated = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: artisan.updatedAt, status: 'ACTIVE' },
    });
    expect(activated.statusCode).toBe(200);

    const productSlug = `produk-arsip-${s}`;
    await createProduct(prisma, ids, {
      slug: productSlug,
      categoryId,
      artisanId: artisan.id,
      published: true,
    });

    const before = await app.inject({
      method: 'GET',
      url: `/v1/public/artisans/${artisan.slug}`,
    });
    expect(before.statusCode).toBe(200);

    const archived = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/archive`,
      token: editor.token,
    });
    expect(archived.statusCode).toBe(200);
    const body = archived.json<{ data: ArtisanArchived }>().data;
    expect(body.archivedAt).not.toBeNull();
    expect(body.warnings).toEqual([{ code: 'HAS_PUBLISHED_PRODUCTS', count: 1 }]);

    // Profil publik hilang…
    const profile = await app.inject({
      method: 'GET',
      url: `/v1/public/artisans/${artisan.slug}`,
    });
    expect(profile.statusCode).toBe(404);

    // …tetapi produknya tetap tayang, dan pengrajinnya tampil tanpa tautan (A10).
    const product = await app.inject({ method: 'GET', url: `/v1/public/products/${productSlug}` });
    expect(product.statusCode).toBe(200);
    const detail = product.json<{ data: { artisan: { slug: string | null; name: string } } }>()
      .data;
    expect(detail.artisan.slug).toBeNull();
    expect(detail.artisan.name).toBe(artisan.name);

    // Mengarsipkan dua kali dan mengubah yang diarsipkan → 409 INVALID_STATE.
    const again = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/archive`,
      token: editor.token,
    });
    expect(again.statusCode).toBe(409);
    expect(errorBody(again).code).toBe('INVALID_STATE');

    const edit = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: body.updatedAt, name: 'Nama baru' },
    });
    expect(edit.statusCode).toBe(409);
    expect(errorBody(edit).code).toBe('INVALID_STATE');

    // Pulihkan: status tetap seperti sebelumnya, profil publik kembali.
    const restored = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/unarchive`,
      token: editor.token,
    });
    expect(restored.statusCode).toBe(200);
    expect(artisanOf(restored).archivedAt).toBeNull();
    expect(artisanOf(restored).status).toBe('ACTIVE');

    const back = await app.inject({ method: 'GET', url: `/v1/public/artisans/${artisan.slug}` });
    expect(back.statusCode).toBe(200);
  });

  test('pulihkan yang tidak diarsipkan → 409 INVALID_STATE', async () => {
    const artisan = await createViaApi(`tak-diarsip-${s}`);
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/unarchive`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });
});

describe('dokumen 🔒 (kontrak §5.8, model §3.4)', () => {
  test('media harus PRIVATE, tidak boleh dipakai dua kali, dan metadata bisa diubah', async () => {
    const artisan = await createViaApi(`dokumen-${s}`);

    const publik = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: { mediaId: publicMediaId, kind: 'IDENTITY', title: 'KTP pemilik' },
    });
    expect(publik.statusCode).toBe(422);
    expect(errorBody(publik).details).toEqual({ rule: 'MEDIA_NOT_PRIVATE' });

    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: { mediaId: privateMediaId, kind: 'IDENTITY', title: 'KTP pemilik' },
    });
    expect(created.statusCode).toBe(201);
    const document = documentOf(created);
    expect(document.kind).toBe('IDENTITY');
    expect(document.media.id).toBe(privateMediaId);
    expect(document.uploadedBy?.id).toBe(editor.id);

    const reuse = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: { mediaId: privateMediaId, kind: 'OTHER', title: 'Salinan' },
    });
    expect(reuse.statusCode).toBe(422);
    expect(errorBody(reuse).details).toEqual({ rule: 'MEDIA_ALREADY_USED' });

    const patched = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}/documents/${document.id}`,
      token: editor.token,
      payload: { kind: 'CONTRACT', title: 'Kontrak kerja 2026' },
    });
    expect(patched.statusCode).toBe(200);
    expect(documentOf(patched).kind).toBe('CONTRACT');
    expect(documentOf(patched).title).toBe('Kontrak kerja 2026');

    const list = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: admin.token,
    });
    expect(documentsOf(list).map((item) => item.id)).toEqual([document.id]);
  });

  test('URL akses berdurasi pendek menegakkan kontrak, lalu 503 selama R2 belum ada', async () => {
    const artisan = await createViaApi(`url-dokumen-${s}`);
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: { mediaId: secondPrivateMediaId, kind: 'BANK_ACCOUNT', title: 'Rekening' },
    });
    const document = documentOf(created);

    // Dokumen milik pengrajin lain → `404`, bukan bocor lewat pesan berbeda.
    const other = await createViaApi(`url-lain-${s}`);
    const wrongOwner = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${other.id}/documents/${document.id}/url`,
      token: editor.token,
    });
    expect(wrongOwner.statusCode).toBe(404);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/artisans/${artisan.id}/documents/${document.id}/url`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(503);
    expect(errorBody(res).code).toBe('SERVICE_UNAVAILABLE');
  });

  test('menghapus dokumen memindahkan Media-nya ke Trash', async () => {
    const artisan = await createViaApi(`hapus-dokumen-${s}`);
    const mediaId = await createMedia(prisma, ids, {
      key: `dokumen-hapus-${s}`,
      visibility: 'PRIVATE',
      alt: null,
    });
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: { mediaId, kind: 'MATERIAL_ORIGIN', title: 'Asal material' },
    });
    const document = documentOf(created);

    const removed = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/artisans/${artisan.id}/documents/${document.id}`,
      token: editor.token,
    });
    expect(removed.statusCode).toBe(204);

    const media = await prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
      select: { deletedAt: true },
    });
    expect(media.deletedAt).not.toBeNull();

    const again = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/artisans/${artisan.id}/documents/${document.id}`,
      token: editor.token,
    });
    expect(again.statusCode).toBe(404);
  });

  test('dokumen dan field 🔒 tidak pernah muncul di /v1/public/*', async () => {
    const artisan = await createViaApi(`bocor-${s}`, { photoId: publicMediaId });
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/artisans/${artisan.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: artisan.updatedAt, status: 'ACTIVE' },
    });
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/artisans/${artisan.id}/documents`,
      token: editor.token,
      payload: {
        mediaId: await createMedia(prisma, ids, {
          key: `dokumen-bocor-${s}`,
          visibility: 'PRIVATE',
          alt: null,
        }),
        kind: 'IDENTITY',
        title: 'KTP-RAHASIA-BOCOR',
      },
    });
    expect(created.statusCode).toBe(201);

    for (const url of ['/v1/public/artisans', `/v1/public/artisans/${artisan.slug}`]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      for (const marker of [
        'KTP-RAHASIA-BOCOR',
        'Pak Rahasia',
        '628123456789',
        'Jl. Rahasia',
        'Catatan negosiasi',
        'internalNotes',
        'documents',
        'archivedAt',
      ]) {
        expect({ url, marker, found: res.body.includes(marker) }).toEqual({
          url,
          marker,
          found: false,
        });
      }
    }
  });
});
