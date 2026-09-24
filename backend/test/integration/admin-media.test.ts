import type { AdminMedia, AdminMediaDetail, MediaUploadTicket, MediaUrl } from '@ornament/shared';
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
import { createFakeR2, pngHeader, type FakeR2 } from '../helpers/r2.js';

/**
 * Media Library (#28/#29) terhadap database tes — kontrak §5.12, model §3.2.
 *
 * Empat hal yang paling mahal bila salah, dan karena itu diuji eksplisit:
 *
 * 1. **Tiket unggah tidak bisa dipakai menembus allowlist.** Ukuran dan MIME
 *    yang ditandatangani harus cocok dengan objek yang benar-benar ada.
 * 2. **Berkas `PRIVATE` tidak pernah punya URL permanen** dan tidak pernah
 *    terlihat Contributor — termasuk keberadaannya (`404`, bukan `403`).
 * 3. **"Sedang dipakai" dihitung dari semua sumber**, termasuk blok gambar di
 *    dalam `Article.content` yang tidak punya kolom FK.
 * 4. **Urutan hapus permanen**: baris DB dulu, objek R2 sesudahnya.
 */

const UPLOAD_SECRET = 'rahasia-uji-media-yang-cukup-panjang-sekali';
const MEDIA_PUBLIC_URL = 'https://media.uji.ornament.id';

let prisma: PrismaClient;
let app: FastifyInstance;
let appWithoutR2: FastifyInstance;
let r2: FakeR2;

const ids: CatalogFixtureIds = emptyFixtureIds();
const userIds: string[] = [];
const s = randomSuffix();

interface Session {
  id: string;
  email: string;
  password: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

let categoryId = '';

const ticketOf = (res: LightMyRequestResponse): MediaUploadTicket =>
  res.json<{ data: MediaUploadTicket }>().data;
const mediaOf = (res: LightMyRequestResponse): AdminMedia => res.json<{ data: AdminMedia }>().data;
const detailOf = (res: LightMyRequestResponse): AdminMediaDetail =>
  res.json<{ data: AdminMediaDetail }>().data;
const rowsOf = (res: LightMyRequestResponse): AdminMedia[] =>
  res.json<{ data: AdminMedia[] }>().data;
const urlOf = (res: LightMyRequestResponse): MediaUrl => res.json<{ data: MediaUrl }>().data;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `media-${role.toLowerCase()}` });
  userIds.push(user.id);
  return {
    id: user.id,
    email: user.email,
    password: user.password,
    token: await loginToken(app, user.email, user.password),
  };
}

/** Presign → `PUT` (disimulasikan di dobel R2) → konfirmasi, seperti klien sungguhan. */
async function uploadViaApi(
  session: Session,
  options: {
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
    visibility?: 'PUBLIC' | 'PRIVATE';
    alt?: string | null;
    body?: Buffer;
  } = {},
): Promise<AdminMedia> {
  const mimeType = options.mimeType ?? 'image/png';
  const sizeBytes = options.sizeBytes ?? 2048;

  const presign = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/media/uploads',
    token: session.token,
    payload: {
      fileName: options.fileName ?? `Berkas ${s}.png`,
      mimeType,
      sizeBytes,
      ...(options.visibility === undefined ? {} : { visibility: options.visibility }),
    },
  });
  if (presign.statusCode !== 201) throw new Error(`presign gagal: ${presign.body}`);
  const ticket = ticketOf(presign);

  r2.put(ticket.key, {
    sizeBytes,
    mimeType,
    ...(options.body === undefined ? {} : { body: options.body }),
  });

  const confirm = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/media',
    token: session.token,
    payload: {
      uploadId: ticket.uploadId,
      ...(options.alt === undefined ? {} : { alt: options.alt }),
    },
  });
  if (confirm.statusCode !== 201) throw new Error(`konfirmasi gagal: ${confirm.body}`);

  const media = mediaOf(confirm);
  ids.mediaIds.push(media.id);
  return media;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  r2 = createFakeR2();
  app = buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    scheduledPublish: false,
    r2,
    uploadSecret: UPLOAD_SECRET,
    // Basis URL publik: tanpa ini `AdminMedia.url` selalu null dan assertion
    // tentang URL permanen kehilangan maknanya.
    mediaPublicUrl: MEDIA_PUBLIC_URL,
  });
  // App kedua tanpa R2, untuk membuktikan Media Library tetap hidup dan rute
  // yang butuh bucket menjawab 503 alih-alih 500.
  appWithoutR2 = buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    scheduledPublish: false,
    r2: null,
  });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');

  categoryId = await createCategory(prisma, ids, { slug: `kat-media-${s}`, name: `Kat ${s}` });
});

afterAll(async () => {
  await deleteCatalogFixture(prisma, ids);
  await deleteTestUsers(prisma, userIds);
  await app.close();
  await appWithoutR2.close();
  await prisma.$disconnect();
});

describe('POST /v1/admin/media/uploads', () => {
  test('mengembalikan tiket dengan header yang harus dipakai klien', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: 'Kursi Lounge.jpg', mimeType: 'image/jpeg', sizeBytes: 845112 },
    });

    expect(res.statusCode).toBe(201);
    const ticket = ticketOf(res);
    expect(ticket.method).toBe('PUT');
    expect(ticket.headers['Content-Type']).toBe('image/jpeg');
    expect(ticket.headers['Content-Length']).toBe('845112');
    expect(ticket.key).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f-]{36}-kursi-lounge\.jpg$/);
    expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('berkas privat memakai prefix private/ agar tidak pernah tertebak dari domain publik', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: {
        fileName: 'KTP.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 120_000,
        visibility: 'PRIVATE',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(ticketOf(res).key.startsWith('private/media/')).toBe(true);
  });

  test('MIME di luar allowlist → 415', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: 'skrip.svg', mimeType: 'image/svg+xml', sizeBytes: 1000 },
    });
    expect(res.statusCode).toBe(415);
    expect(errorBody(res).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('melebihi batas ukuran → 413, dengan batasnya disebut', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: 'besar.jpg', mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 },
    });
    expect(res.statusCode).toBe(413);
    expect(errorBody(res).details).toMatchObject({ maxBytes: 10 * 1024 * 1024 });
  });

  test('Contributor tidak bisa meminta berkas privat', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: contributor.token,
      payload: {
        fileName: 'ktp.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        visibility: 'PRIVATE',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toMatchObject({ requiredPermission: 'media.private' });
  });

  test('tanpa R2 → 503, bukan 500 dan bukan URL karangan', async () => {
    const token = await loginToken(appWithoutR2, editor.email, editor.password);
    const res = await adminRequest(appWithoutR2, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token,
      payload: { fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
    });
    expect(res.statusCode).toBe(503);
    expect(errorBody(res).code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('POST /v1/admin/media (konfirmasi)', () => {
  test('membaca dimensi gambar dari header berkas', async () => {
    const media = await uploadViaApi(editor, {
      fileName: `Foto ${s}.png`,
      body: pngHeader(1600, 2000),
      alt: 'Kursi rotan tampak depan',
    });

    expect(media.kind).toBe('IMAGE');
    expect(media.width).toBe(1600);
    expect(media.height).toBe(2000);
    expect(media.alt).toBe('Kursi rotan tampak depan');
    expect(media.usageCount).toBe(0);
  });

  test('konfirmasi ulang tiket yang sama → 200 dan media yang sama, bukan 409', async () => {
    const presign = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: `Ulang ${s}.png`, mimeType: 'image/png', sizeBytes: 512 },
    });
    const ticket = ticketOf(presign);
    r2.put(ticket.key, { sizeBytes: 512, mimeType: 'image/png' });

    const first = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: editor.token,
      payload: { uploadId: ticket.uploadId },
    });
    expect(first.statusCode).toBe(201);
    ids.mediaIds.push(mediaOf(first).id);

    const again = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: editor.token,
      payload: { uploadId: ticket.uploadId },
    });
    expect(again.statusCode).toBe(200);
    expect(mediaOf(again).id).toBe(mediaOf(first).id);
  });

  test('objek belum ada di bucket → 422 NOT_FOUND', async () => {
    const presign = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: `Hantu ${s}.png`, mimeType: 'image/png', sizeBytes: 512 },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: editor.token,
      payload: { uploadId: ticketOf(presign).uploadId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('UPLOAD_INVALID');
    expect(errorBody(res).details).toMatchObject({ reason: 'NOT_FOUND' });
  });

  test('objek yang diunggah lebih besar dari yang disetujui → 422 MISMATCH', async () => {
    const presign = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: `Curang ${s}.png`, mimeType: 'image/png', sizeBytes: 1024 },
    });
    const ticket = ticketOf(presign);
    // Klien mengunggah 50 MB meski hanya menandatangani 1 KB.
    r2.put(ticket.key, { sizeBytes: 50 * 1024 * 1024, mimeType: 'image/png' });

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: editor.token,
      payload: { uploadId: ticket.uploadId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ reason: 'MISMATCH' });
  });

  test('tiket milik orang lain ditolak seolah tidak ada', async () => {
    const presign = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media/uploads',
      token: editor.token,
      payload: { fileName: `Milik Editor ${s}.png`, mimeType: 'image/png', sizeBytes: 512 },
    });
    const ticket = ticketOf(presign);
    r2.put(ticket.key, { sizeBytes: 512, mimeType: 'image/png' });

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: contributor.token,
      payload: { uploadId: ticket.uploadId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ reason: 'NOT_FOUND' });
  });

  test('tiket yang dipalsukan ditolak', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/media',
      token: editor.token,
      payload: { uploadId: 'eyJrZXkiOiJtZWRpYS94LmpwZyJ9.tandatangan-palsu' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ reason: 'NOT_FOUND' });
  });
});

describe('GET /v1/admin/media', () => {
  test('meta memuat total ukuran dan daftar bulan', async () => {
    await uploadViaApi(editor, { fileName: `Daftar ${s}.png`, sizeBytes: 4096 });

    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/media?pageSize=100',
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);

    const meta = res.json<{
      meta: { totalSizeBytes: number; months: string[]; pageSize: number };
    }>().meta;
    expect(meta.totalSizeBytes).toBeGreaterThan(0);
    expect(meta.months.length).toBeGreaterThan(0);
    expect(meta.months.every((month) => /^\d{4}-\d{2}$/.test(month))).toBe(true);
  });

  test('pageSize default 40 (kontrak §5.12), bukan 20 seperti daftar lain', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/media',
      token: editor.token,
    });
    expect(res.json<{ meta: { pageSize: number } }>().meta.pageSize).toBe(40);
  });

  test('berkas privat tidak pernah muncul di daftar Contributor', async () => {
    const privateMedia = await uploadViaApi(editor, {
      fileName: `Rahasia ${s}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'PRIVATE',
    });

    const asContributor = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/media?pageSize=100',
      token: contributor.token,
    });
    expect(rowsOf(asContributor).some((row) => row.id === privateMedia.id)).toBe(false);

    // Filter `visibility` yang dikirimnya dipaksa `PUBLIC` (kontrak §5.12):
    // ia tetap menerima daftar, tetapi tidak satu pun berkas privat di dalamnya.
    const forced = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/media?visibility=PRIVATE&pageSize=100',
      token: contributor.token,
    });
    expect(rowsOf(forced).every((row) => row.visibility === 'PUBLIC')).toBe(true);
    expect(rowsOf(forced).some((row) => row.id === privateMedia.id)).toBe(false);

    const asEditor = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/media?visibility=PRIVATE&pageSize=100',
      token: editor.token,
    });
    expect(rowsOf(asEditor).some((row) => row.id === privateMedia.id)).toBe(true);
  });

  test('filter kind dan q', async () => {
    const media = await uploadViaApi(editor, { fileName: `Unik-${s}.png` });

    const byQuery = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media?q=${encodeURIComponent(`Unik-${s}`)}`,
      token: editor.token,
    });
    expect(rowsOf(byQuery).map((row) => row.id)).toContain(media.id);

    const asDocument = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media?kind=DOCUMENT&q=${encodeURIComponent(`Unik-${s}`)}`,
      token: editor.token,
    });
    expect(rowsOf(asDocument)).toHaveLength(0);
  });
});

describe('pemakaian, Trash, dan hapus permanen', () => {
  test('media yang dipakai produk terbit: tidak bisa ke Trash, dan usages menyebut pemakainya', async () => {
    const mediaId = await createMedia(prisma, ids, { key: `dipakai-${s}` });
    const productId = await createProduct(prisma, ids, {
      slug: `produk-media-${s}`,
      name: `Produk Media ${s}`,
      categoryId,
      published: true,
    });
    await prisma.product.update({
      where: { id: productId },
      data: { primaryImageId: mediaId },
      select: { id: true },
    });

    const detail = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
    });
    expect(detailOf(detail).usages).toContainEqual(
      expect.objectContaining({
        entityType: 'Product',
        entityId: productId,
        field: 'primaryImageId',
        isPublished: true,
      }),
    );

    const trash = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
    });
    expect(trash.statusCode).toBe(409);
    expect(errorBody(trash).code).toBe('IN_USE');
  });

  test('blok gambar di dalam Article.content ikut terhitung meski tanpa kolom FK', async () => {
    const mediaId = await createMedia(prisma, ids, { key: `di-artikel-${s}` });
    const articleCategoryId = await prisma.articleCategory
      .create({ data: { slug: `kat-art-media-${s}`, name: `Kat ${s}` }, select: { id: true } })
      .then((row) => row.id);
    ids.articleCategoryIds.push(articleCategoryId);

    const article = await prisma.article.create({
      data: {
        title: `Artikel Media ${s}`,
        slug: `artikel-media-${s}`,
        content: [
          { id: 'p1', type: 'paragraph', text: [{ text: 'Paragraf.' }] },
          { id: 'i1', type: 'image', mediaId },
        ],
        categoryId: articleCategoryId,
        authorId: editor.id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        wordCount: 1,
      },
      select: { id: true },
    });
    ids.articleIds.push(article.id);

    const detail = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
    });
    expect(detailOf(detail).usages).toContainEqual(
      expect.objectContaining({ entityType: 'Article', field: 'content', isPublished: true }),
    );

    const trash = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
    });
    expect(trash.statusCode).toBe(409);
  });

  test('media bebas: Trash → pulih → hapus permanen menghapus objek R2 sesudah baris DB', async () => {
    const media = await uploadViaApi(editor, { fileName: `Bebas ${s}.png` });
    const key = (
      await prisma.media.findUniqueOrThrow({ where: { id: media.id }, select: { key: true } })
    ).key;

    const trash = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}`,
      token: editor.token,
    });
    expect(trash.statusCode).toBe(200);

    const restore = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/media/${media.id}/restore`,
      token: editor.token,
    });
    expect(restore.statusCode).toBe(200);
    expect(mediaOf(restore).deletedAt).toBeNull();

    // Hapus permanen menuntut media sudah di Trash lebih dulu.
    const tooEarly = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}/permanent`,
      token: admin.token,
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(errorBody(tooEarly).code).toBe('INVALID_STATE');

    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}`,
      token: editor.token,
    });

    const purge = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}/permanent`,
      token: admin.token,
    });
    expect(purge.statusCode).toBe(204);
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toBeNull();
    expect(r2.removed).toContain(key);
  });

  test('hapus permanen hanya Administrator', async () => {
    const media = await uploadViaApi(editor, { fileName: `Izin ${s}.png` });
    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}`,
      token: editor.token,
    });

    const res = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/media/${media.id}/permanent`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH dan GET /:id/url', () => {
  test('Contributor tidak bisa mengubah berkas orang lain', async () => {
    const media = await uploadViaApi(editor, { fileName: `Punya Editor ${s}.png` });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/media/${media.id}`,
      token: contributor.token,
      payload: { alt: 'diubah' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toMatchObject({ reason: 'NOT_OWNER' });
  });

  test('alt tidak boleh dikosongkan selama dipakai konten terbit', async () => {
    const mediaId = await createMedia(prisma, ids, { key: `alt-wajib-${s}` });
    const productId = await createProduct(prisma, ids, {
      slug: `produk-alt-${s}`,
      name: `Produk Alt ${s}`,
      categoryId,
      published: true,
    });
    await prisma.product.update({
      where: { id: productId },
      data: { primaryImageId: mediaId },
      select: { id: true },
    });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
      payload: { alt: null },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ reason: 'ALT_REQUIRED' });

    // Mengganti isinya tetap boleh; yang dilarang hanya mengosongkannya.
    const rename = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/media/${mediaId}`,
      token: editor.token,
      payload: { alt: 'Teks alternatif baru' },
    });
    expect(rename.statusCode).toBe(200);
    expect(mediaOf(rename).alt).toBe('Teks alternatif baru');
  });

  test('berkas publik: URL permanen dari domain media, tanpa kedaluwarsa', async () => {
    const media = await uploadViaApi(editor, { fileName: `Publik ${s}.png` });
    expect(media.url?.startsWith(`${MEDIA_PUBLIC_URL}/media/`)).toBe(true);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${media.id}/url`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);
    expect(urlOf(res).expiresAt).toBeNull();
    expect(urlOf(res).url).not.toContain('X-Amz-Signature');
  });

  test('berkas privat: URL bertanda tangan yang kedaluwarsa, dan tak terlihat Contributor', async () => {
    const media = await uploadViaApi(editor, {
      fileName: `Dokumen ${s}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'PRIVATE',
    });
    // DTO tidak pernah membawa URL permanen untuk berkas privat.
    expect(media.url).toBeNull();

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${media.id}/url?download=true`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);
    expect(urlOf(res).expiresAt).not.toBeNull();
    expect(urlOf(res).url).toContain('X-Amz-Signature');

    const asContributor = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${media.id}/url`,
      token: contributor.token,
    });
    expect(asContributor.statusCode).toBe(404);
  });

  test('Contributor mendapat 404 — bukan 403 — untuk detail berkas privat', async () => {
    const media = await uploadViaApi(editor, {
      fileName: `Tersembunyi ${s}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'PRIVATE',
    });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/media/${media.id}`,
      token: contributor.token,
    });
    expect(res.statusCode).toBe(404);
  });
});
