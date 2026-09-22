import type { AdminArticle, AdminArticleRow, BulkResult, PageMeta } from '@ornament/shared';
import { quickDraftContent } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { publishScheduledArticles } from '../../src/modules/jobs/publish-scheduled.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import { randomSuffix } from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import {
  createArticleCategory,
  createMedia,
  deleteJournalFixture,
  emptyJournalIds,
  type JournalFixtureIds,
} from '../helpers/journal.js';

/**
 * Admin artikel (#27) terhadap database tes — kontrak §5.9, model §6.6.
 *
 * Yang diuji langsung, bukan lewat timer: **job publikasi terjadwal**
 * (`publishScheduledArticles`). Menunggu interval 60 detik akan membuat tes
 * lambat dan rapuh; yang perlu dibuktikan adalah bahwa jobnya sendiri benar
 * dan idempoten.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: JournalFixtureIds = emptyJournalIds();
/** Slug tag yang lahir dari `tags` di body; `Tag` dipakai ulang lintas konten. */
const createdTagSlugs: string[] = [];

const s = randomSuffix();
let categoryId = '';
let mediaWithAltId = '';
let mediaWithoutAltId = '';
let privateMediaId = '';

interface Session {
  id: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `art-${role.toLowerCase()}` });
  ids.userIds.push(user.id);
  return { id: user.id, token: await loginToken(app, user.email, user.password) };
}

const articleOf = (res: LightMyRequestResponse): AdminArticle =>
  res.json<{ data: AdminArticle }>().data;
const rowsOf = (res: LightMyRequestResponse): AdminArticleRow[] =>
  res.json<{ data: AdminArticleRow[] }>().data;
const metaOf = (res: LightMyRequestResponse): PageMeta => res.json<{ meta: PageMeta }>().meta;

const paragraphBlock = (id: string, text: string) => ({
  id,
  type: 'paragraph' as const,
  text: [{ text }],
});

/** Membuat artikel lewat API dan mencatatnya untuk dibersihkan. */
async function createViaApi(
  token: string,
  payload: Record<string, unknown>,
): Promise<AdminArticle> {
  const res = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/articles',
    token,
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`fixture artikel gagal: ${res.body}`);
  const article = articleOf(res);
  ids.articleIds.push(article.id);
  return article;
}

/** Artikel yang sudah memenuhi syarat terbit §6.6. */
function publishableBody(suffix: string, extra: Record<string, unknown> = {}) {
  return {
    title: `Artikel ${suffix}`,
    categoryId,
    content: [paragraphBlock('b1', 'Rotan dipanen dari hulu lalu dikeringkan.')],
    ...extra,
  };
}

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    // Job dimatikan; tes memanggilnya sendiri agar hasilnya tidak bergantung
    // pada kapan timer kebetulan berjalan.
    scheduledPublish: false,
  });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');

  categoryId = await createArticleCategory(prisma, ids, {
    slug: `kat-artikel-${s}`,
    name: `Kategori ${s}`,
  });
  mediaWithAltId = await createMedia(prisma, ids, { key: `gambar-beralt-${s}` });
  mediaWithoutAltId = await createMedia(prisma, ids, { key: `gambar-tanpa-alt-${s}`, alt: null });
  privateMediaId = await createMedia(prisma, ids, {
    key: `dokumen-privat-${s}`,
    visibility: 'PRIVATE',
    alt: null,
  });
});

afterAll(async () => {
  await deleteJournalFixture(prisma, ids);
  if (createdTagSlugs.length > 0) {
    await prisma.tag.deleteMany({ where: { slug: { in: createdTagSlugs } } });
  }
  await deleteTestUsers(prisma, ids.userIds);
  await app.close();
});

describe('matriks izin (kontrak §3, §5.9)', () => {
  test('tanpa sesi → 401', async () => {
    const list = await adminRequest(app, { method: 'GET', url: '/v1/admin/articles' });
    expect(list.statusCode).toBe(401);
  });

  test('Contributor: draf miliknya boleh, milik orang lain 403 NOT_OWNER', async () => {
    const mine = await createViaApi(contributor.token, { title: `Draf CTR ${s}` });
    const theirs = await createViaApi(editor.token, { title: `Draf EDT ${s}` });

    const editMine = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${mine.id}`,
      token: contributor.token,
      payload: { expectedUpdatedAt: mine.updatedAt, title: `Draf CTR ${s} v2` },
    });
    expect(editMine.statusCode).toBe(200);

    const editTheirs = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${theirs.id}`,
      token: contributor.token,
      payload: { expectedUpdatedAt: theirs.updatedAt, title: 'Rebut' },
    });
    expect(editTheirs.statusCode).toBe(403);
    expect(errorBody(editTheirs).details).toEqual({ reason: 'NOT_OWNER' });

    // Membaca tetap boleh (§3.2): Contributor butuh konteks.
    const read = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/articles/${theirs.id}`,
      token: contributor.token,
    });
    expect(read.statusCode).toBe(200);
  });

  test('Contributor tidak boleh terbit/jadwal/tarik, dan tidak boleh hapus permanen', async () => {
    const mine = await createViaApi(contributor.token, publishableBody(`izin-ctr-${s}`));

    for (const url of [
      `/v1/admin/articles/${mine.id}/publish`,
      `/v1/admin/articles/${mine.id}/unpublish`,
    ]) {
      const res = await adminRequest(app, {
        method: 'POST',
        url,
        token: contributor.token,
        payload: {},
      });
      expect({ url, status: res.statusCode }).toEqual({ url, status: 403 });
      expect(errorBody(res).code).toBe('FORBIDDEN');
    }

    const purge = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${mine.id}/permanent`,
      token: editor.token,
    });
    expect(purge.statusCode).toBe(403);
    expect(errorBody(purge).code).toBe('FORBIDDEN');
  });

  test('Contributor tidak boleh mengirim slug maupun authorId → 403 FORBIDDEN_FIELD', async () => {
    for (const payload of [
      { title: `Slug CTR ${s}`, slug: `slug-ctr-${s}` },
      { title: `Author CTR ${s}`, authorId: editor.id },
    ]) {
      const res = await adminRequest(app, {
        method: 'POST',
        url: '/v1/admin/articles',
        token: contributor.token,
        payload,
      });
      expect(res.statusCode).toBe(403);
      expect(errorBody(res).code).toBe('FORBIDDEN_FIELD');
    }
  });
});

describe('GET /v1/admin/articles', () => {
  test('meta.counts per status + trash, filter, dan sort allowlist', async () => {
    const draft = await createViaApi(editor.token, publishableBody(`hitung-draf-${s}`));
    const published = await createViaApi(editor.token, publishableBody(`hitung-terbit-${s}`));
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${published.id}/publish`,
      token: editor.token,
      payload: {},
    });
    const trashed = await createViaApi(editor.token, publishableBody(`hitung-trash-${s}`));
    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${trashed.id}`,
      token: editor.token,
    });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/articles?categoryId=${categoryId}&q=hitung-`,
      token: contributor.token,
    });
    expect(res.statusCode).toBe(200);
    const meta = metaOf(res);
    expect(meta.counts?.DRAFT).toBeGreaterThanOrEqual(1);
    expect(meta.counts?.PUBLISHED).toBeGreaterThanOrEqual(1);
    expect(meta.counts?.trash).toBeGreaterThanOrEqual(1);
    // Default hanya baris hidup: yang di Trash tidak ikut.
    expect(rowsOf(res).some((row) => row.id === trashed.id)).toBe(false);
    expect(rowsOf(res).some((row) => row.id === draft.id)).toBe(true);

    const onlyTrash = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/articles?trashed=true&q=hitung-`,
      token: editor.token,
    });
    expect(rowsOf(onlyTrash).map((row) => row.id)).toEqual([trashed.id]);

    const bad = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/articles?sort=wordCount',
      token: editor.token,
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('POST /v1/admin/articles', () => {
  test('draf cepat dashboard (Q1): judul + catatan → DRAFT dengan id untuk editor', async () => {
    const note = 'Ide: rotan dari hulu ke anyaman.';
    const article = await createViaApi(contributor.token, {
      title: `Draf cepat ${s}`,
      content: quickDraftContent(note),
    });

    expect(article.status).toBe('DRAFT');
    expect(article.author.id).toBe(contributor.id);
    expect(article.category).toBeNull();
    expect(article.publishAt).toBeNull();
    expect(article.blockCount).toBe(1);
    expect(article.wordCount).toBe(6);
    expect(article.content[0]).toMatchObject({ type: 'paragraph' });
    // Responsnya memberi id yang dipakai UI untuk menautkan ke editor.
    expect(article.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('blok tidak valid ditolak 400 sebelum menyentuh database', async () => {
    for (const content of [
      [{ id: 'v1', type: 'video', src: 'https://contoh.test/v.mp4' }],
      [{ id: 'i1', type: 'image', mediaId: 'bukan-uuid' }],
      [paragraphBlock('b1', 'Satu'), paragraphBlock('b1', 'Dua')],
    ]) {
      const res = await adminRequest(app, {
        method: 'POST',
        url: '/v1/admin/articles',
        token: editor.token,
        payload: { title: `Blok tidak valid ${s}`, content },
      });
      expect(res.statusCode).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    }
  });

  test('media privat tidak boleh dipakai sebagai gambar unggulan', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/articles',
      token: editor.token,
      payload: { title: `Privat ${s}`, featuredImageId: privateMediaId },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'PRIVATE_MEDIA_NOT_ALLOWED' });
  });

  test('kategori tak dikenal → 422 CATEGORY_NOT_FOUND', async () => {
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/articles',
      token: editor.token,
      payload: {
        title: `Kategori hilang ${s}`,
        categoryId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CATEGORY_NOT_FOUND' });
  });
});

describe('PATCH /v1/admin/articles/:id', () => {
  test('expectedUpdatedAt basi → 409 EDIT_CONFLICT; wordCount dihitung ulang', async () => {
    const article = await createViaApi(editor.token, { title: `Konkuren ${s}` });

    const ok = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: {
        expectedUpdatedAt: article.updatedAt,
        content: [paragraphBlock('b1', 'satu dua tiga empat lima')],
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(articleOf(ok).wordCount).toBe(5);

    const stale = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: article.updatedAt, title: 'Lain' },
    });
    expect(stale.statusCode).toBe(409);
    expect(errorBody(stale).code).toBe('EDIT_CONFLICT');
    // `Article` tidak menyimpan penyimpan terakhir; `author` bukan jawabannya,
    // jadi `updatedBy` harus null alih-alih menuduh penulis aslinya.
    expect(errorBody(stale).details).toMatchObject({ updatedBy: null });
  });

  test('slug berubah → SlugRedirect dari slug lama ke artikel yang sama (§6.10)', async () => {
    const article = await createViaApi(editor.token, publishableBody(`redirect-${s}`));
    const oldSlug = article.slug;
    const newSlug = `redirect-baru-${s}`;

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: article.updatedAt, slug: newSlug },
    });
    expect(res.statusCode).toBe(200);
    expect(articleOf(res).slug).toBe(newSlug);

    const redirect = await prisma.slugRedirect.findUnique({
      where: { type_fromSlug: { type: 'ARTICLE', fromSlug: oldSlug } },
      select: { articleId: true },
    });
    expect(redirect?.articleId).toBe(article.id);
    // Slug aktif tidak boleh mengalihkan ke dirinya sendiri.
    const selfRedirect = await prisma.slugRedirect.findUnique({
      where: { type_fromSlug: { type: 'ARTICLE', fromSlug: newSlug } },
      select: { id: true },
    });
    expect(selfRedirect).toBeNull();
  });

  test('artikel terbit tidak bisa kehilangan kategori lewat PATCH', async () => {
    const article = await createViaApi(editor.token, publishableBody(`kategori-wajib-${s}`));
    const published = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(published.statusCode).toBe(200);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: articleOf(published).updatedAt, categoryId: null },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('PUBLISH_REQUIREMENTS_NOT_MET');
    expect(errorBody(res).details).toContainEqual({ path: 'categoryId', code: 'required' });
  });
});

describe('syarat publish (model §6.6)', () => {
  test('tanpa kategori / tanpa isi → 422 dengan path yang tepat', async () => {
    const article = await createViaApi(editor.token, { title: `Belum lengkap ${s}` });
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('PUBLISH_REQUIREMENTS_NOT_MET');
    expect(errorBody(res).details).toContainEqual({ path: 'categoryId', code: 'required' });
    expect(errorBody(res).details).toContainEqual({ path: 'content', code: 'required' });
  });

  test('gambar tanpa alt → 422 alt_required, baik unggulan maupun blok', async () => {
    const article = await createViaApi(
      editor.token,
      publishableBody(`alt-${s}`, {
        featuredImageId: mediaWithoutAltId,
        content: [
          paragraphBlock('b1', 'Paragraf.'),
          { id: 'b2', type: 'image', mediaId: mediaWithoutAltId },
        ],
      }),
    );
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toContainEqual({
      path: 'featuredImageId',
      code: 'alt_required',
    });
    expect(errorBody(res).details).toContainEqual({
      path: 'content[1].mediaId',
      code: 'alt_required',
    });

    // Dengan media yang punya alt, syaratnya terpenuhi.
    const fixed = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: {
        expectedUpdatedAt: article.updatedAt,
        featuredImageId: mediaWithAltId,
        content: [
          paragraphBlock('b1', 'Paragraf.'),
          { id: 'b2', type: 'image', mediaId: mediaWithAltId },
        ],
      },
    });
    expect(fixed.statusCode).toBe(200);
    const published = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: {},
    });
    expect(published.statusCode).toBe(200);
    expect(articleOf(published).status).toBe('PUBLISHED');
  });

  test('jadwal di masa lalu → 422 PUBLISH_AT_IN_PAST', async () => {
    const article = await createViaApi(editor.token, publishableBody(`jadwal-lalu-${s}`));
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: { publishAt: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'PUBLISH_AT_IN_PAST' });
  });
});

describe('publikasi terjadwal (ADR K8, model §6.6)', () => {
  test('jadwal masa depan belum tayang; setelah job jalan menjadi PUBLISHED dan tayang', async () => {
    const article = await createViaApi(editor.token, publishableBody(`jadwal-${s}`));
    const publishAt = new Date(Date.now() + 60 * 60 * 1000);

    const scheduled = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: { publishAt: publishAt.toISOString() },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(articleOf(scheduled).status).toBe('SCHEDULED');
    expect(articleOf(scheduled).publishedAt).toBeNull();

    // Belum jatuh tempo → `404` di publik (kontrak §4).
    const early = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${article.slug}`,
    });
    expect(early.statusCode).toBe(404);

    // Job pada waktu sekarang tidak menyentuh apa pun.
    const noop = await publishScheduledArticles(prisma);
    expect(noop.slugs).not.toContain(article.slug);

    // Majukan jadwal ke masa lalu (seolah waktunya tiba), lalu jalankan job.
    await prisma.article.update({
      where: { id: article.id },
      data: { publishAt: new Date(Date.now() - 1000) },
      select: { id: true },
    });

    const result = await publishScheduledArticles(prisma);
    expect(result.published).toBeGreaterThanOrEqual(1);
    expect(result.slugs).toContain(article.slug);

    const after = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true, publishedAt: true },
    });
    expect(after.status).toBe('PUBLISHED');
    expect(after.publishedAt).not.toBeNull();

    const live = await app.inject({ method: 'GET', url: `/v1/public/articles/${article.slug}` });
    expect(live.statusCode).toBe(200);

    // Idempoten: putaran kedua tidak menerbitkan ulang.
    const second = await publishScheduledArticles(prisma);
    expect(second.slugs).not.toContain(article.slug);

    // `ActivityLog` ditulis sekali, dengan actor "Sistem".
    const logs = await prisma.activityLog.findMany({
      where: { entityId: article.id, action: 'article.published_scheduled' },
      select: { actorId: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.actorId).toBeNull();
  });

  test('job tidak menyentuh updatedAt, sehingga form editor yang terbuka tetap sah', async () => {
    const article = await createViaApi(editor.token, publishableBody(`jadwal-lock-${s}`));
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: { publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    await prisma.article.update({
      where: { id: article.id },
      data: { publishAt: new Date(Date.now() - 1000) },
      select: { id: true },
    });

    // Snapshot yang dipegang editor di formulirnya sesaat sebelum jadwal jatuh tempo.
    const before = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { updatedAt: true },
    });

    const result = await publishScheduledArticles(prisma);
    expect(result.slugs).toContain(article.slug);

    const after = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true, updatedAt: true },
    });
    expect(after.status).toBe('PUBLISHED');
    // `updatedAt` adalah token konkurensi optimistis artikel: job sistem tidak
    // boleh membatalkannya, karena tidak ada manusia yang mengubah isi.
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());

    const save = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
      payload: { expectedUpdatedAt: before.updatedAt.toISOString(), title: `Sunting ${s}` },
    });
    expect(save.statusCode).toBe(200);
  });

  test('artikel terjadwal di Trash tidak pernah diterbitkan job', async () => {
    const article = await createViaApi(editor.token, publishableBody(`jadwal-trash-${s}`));
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: { publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    await prisma.article.update({
      where: { id: article.id },
      data: { publishAt: new Date(Date.now() - 1000), deletedAt: new Date() },
      select: { id: true },
    });

    const result = await publishScheduledArticles(prisma);
    expect(result.slugs).not.toContain(article.slug);
    const after = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { status: true },
    });
    expect(after.status).toBe('SCHEDULED');
  });
});

describe('POST /v1/admin/articles/:id/preview', () => {
  test('mengembalikan DTO publik tanpa menyimpan apa pun', async () => {
    const article = await createViaApi(editor.token, publishableBody(`pratinjau-${s}`));
    const before = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { title: true, content: true, updatedAt: true, wordCount: true },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/preview`,
      token: editor.token,
      payload: {
        title: 'Judul pratinjau yang belum disimpan',
        content: [paragraphBlock('b1', 'Isi editor yang belum disimpan.')],
        tags: ['Bantul Raya'],
      },
    });
    expect(res.statusCode).toBe(200);

    const preview = res.json<{
      data: {
        title: string;
        excerpt: string;
        category: { slug: string };
        tags: { slug: string; name: string }[];
        commentCount: number;
        publishedAt: string;
        content: { type: string }[];
      };
    }>().data;
    expect(preview.title).toBe('Judul pratinjau yang belum disimpan');
    expect(preview.excerpt).toBe('Isi editor yang belum disimpan.');
    expect(preview.category.slug).toBe(`kat-artikel-${s}`);
    expect(preview.tags).toEqual([{ slug: 'bantul-raya', name: 'Bantul Raya' }]);
    expect(preview.commentCount).toBe(0);
    expect(preview.publishedAt).toMatch(/Z$/);

    // Tidak ada yang tersimpan: baris artikel dan tabel tag tidak berubah.
    const after = await prisma.article.findUniqueOrThrow({
      where: { id: article.id },
      select: { title: true, content: true, updatedAt: true, wordCount: true },
    });
    expect(after).toEqual(before);
    expect(await prisma.tag.findUnique({ where: { slug: 'bantul-raya' } })).toBeNull();
  });

  test('Contributor tidak bisa memratinjau tulisan orang lain → 403 NOT_OWNER', async () => {
    const theirs = await createViaApi(editor.token, publishableBody(`pratinjau-lain-${s}`));
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${theirs.id}/preview`,
      token: contributor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toEqual({ reason: 'NOT_OWNER' });
  });
});

describe('Trash, restore, hapus permanen (model §6.4, Q3)', () => {
  test('pemulihan selalu DRAFT dengan publishAt kosong', async () => {
    const article = await createViaApi(editor.token, publishableBody(`restore-${s}`));
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/publish`,
      token: editor.token,
      payload: { publishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });

    const trashed = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
    });
    expect(trashed.statusCode).toBe(200);

    const restored = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/restore`,
      token: editor.token,
    });
    expect(restored.statusCode).toBe(200);
    expect(articleOf(restored).status).toBe('DRAFT');
    expect(articleOf(restored).publishAt).toBeNull();
    expect(articleOf(restored).deletedAt).toBeNull();

    const again = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/articles/${article.id}/restore`,
      token: editor.token,
    });
    expect(again.statusCode).toBe(409);
    expect(errorBody(again).code).toBe('INVALID_STATE');
  });

  test('hapus permanen hanya Administrator dan hanya dari Trash', async () => {
    const article = await createViaApi(editor.token, publishableBody(`purge-${s}`));

    const tooEarly = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${article.id}/permanent`,
      token: admin.token,
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(errorBody(tooEarly).code).toBe('INVALID_STATE');

    await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${article.id}`,
      token: editor.token,
    });
    const purged = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/articles/${article.id}/permanent`,
      token: admin.token,
    });
    expect(purged.statusCode).toBe(204);
    expect(await prisma.article.findUnique({ where: { id: article.id } })).toBeNull();
  });
});

describe('POST /v1/admin/articles/bulk', () => {
  test('sukses parsial: izin dicek per item', async () => {
    const mine = await createViaApi(contributor.token, publishableBody(`bulk-ctr-${s}`));
    const theirs = await createViaApi(editor.token, publishableBody(`bulk-edt-${s}`));

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/articles/bulk',
      token: contributor.token,
      payload: { action: 'TRASH', ids: [mine.id, theirs.id] },
    });
    expect(res.statusCode).toBe(200);

    const result = res.json<{ data: BulkResult }>().data;
    expect(result.succeeded).toEqual([mine.id]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ id: theirs.id, code: 'FORBIDDEN' });

    // Contributor tidak punya `article.publish`: seluruh item gagal, tetap 200.
    const publish = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/articles/bulk',
      token: contributor.token,
      payload: { action: 'PUBLISH', ids: [theirs.id] },
    });
    expect(publish.statusCode).toBe(200);
    expect(publish.json<{ data: BulkResult }>().data.failed[0]?.code).toBe('FORBIDDEN');
  });
});

describe('tag artikel', () => {
  test('tag dibuat sekali dan dipakai ulang lintas artikel', async () => {
    const tagName = `Tag Bersama ${s}`;
    const slug = `tag-bersama-${s}`;
    createdTagSlugs.push(slug);

    const first = await createViaApi(
      editor.token,
      publishableBody(`tag-a-${s}`, { tags: [tagName] }),
    );
    const second = await createViaApi(
      editor.token,
      publishableBody(`tag-b-${s}`, { tags: [tagName] }),
    );

    expect(first.tags.map((tag) => tag.slug)).toEqual([slug]);
    expect(second.tags[0]?.id).toBe(first.tags[0]?.id);
    expect(await prisma.tag.count({ where: { slug } })).toBe(1);
  });
});
