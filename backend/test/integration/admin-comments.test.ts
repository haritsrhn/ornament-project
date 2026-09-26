import type { AdminComment, CommentStatus, PageMeta } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import { randomSuffix } from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import {
  COMMENT_EMAIL_MARKER,
  COMMENT_IP_HASH_MARKER,
  COMMENT_USER_AGENT_MARKER,
  createArticle,
  createComment,
  deleteJournalFixture,
  emptyJournalIds,
  type JournalFixtureIds,
} from '../helpers/journal.js';

/**
 * Moderasi komentar (#30) — kontrak §5.10, model §6.8 & §6.11.
 *
 * Empat hal yang paling mahal bila salah:
 *
 * 1. **Contributor tidak punya akses sama sekali** (A2) — termasuk membaca
 *    daftar, karena isinya email pengunjung.
 * 2. **`ipHash` dan `userAgent` tidak pernah keluar**, bahkan ke Administrator.
 * 3. **`DELETED` adalah titik akhir**: tidak bisa dipulihkan lewat UI.
 * 4. **Anonimisasi tidak bisa dibatalkan** dan harus idempoten.
 */

let prisma: PrismaClient;
let app: FastifyInstance;

const ids: JournalFixtureIds = emptyJournalIds();
const s = randomSuffix();

interface Session {
  id: string;
  name: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

let articleId = '';
let draftArticleId = '';

const commentOf = (res: LightMyRequestResponse): AdminComment =>
  res.json<{ data: AdminComment }>().data;
const rowsOf = (res: LightMyRequestResponse): AdminComment[] =>
  res.json<{ data: AdminComment[] }>().data;
const metaOf = (res: LightMyRequestResponse): PageMeta => res.json<{ meta: PageMeta }>().meta;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `cmt-${role.toLowerCase()}` });
  ids.userIds.push(user.id);
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true },
  });
  return { id: user.id, name: row.name, token: await loginToken(app, user.email, user.password) };
}

/** Komentar pengunjung baru untuk satu tes, supaya tes tidak saling mengganggu. */
function visitorComment(status: CommentStatus = 'PENDING', authorName = `Sofia ${s}`) {
  return createComment(prisma, { articleId, authorName, status });
}

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false, adminOrigin: ADMIN_ORIGIN, scheduledPublish: false });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');

  articleId = await createArticle(prisma, ids, {
    slug: `artikel-komentar-${s}`,
    title: `Artikel Komentar ${s}`,
    authorId: editor.id,
  });
  draftArticleId = await createArticle(prisma, ids, {
    slug: `artikel-draf-${s}`,
    title: `Artikel Draf ${s}`,
    authorId: editor.id,
    status: 'DRAFT',
  });
});

afterAll(async () => {
  await deleteJournalFixture(prisma, ids);
  await deleteTestUsers(prisma, ids.userIds);
  await app.close();
  await prisma.$disconnect();
});

describe('akses (A2)', () => {
  test('Contributor tidak bisa membaca daftar komentar sama sekali', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/comments',
      token: contributor.token,
    });
    expect(res.statusCode).toBe(403);
  });

  test('tanpa sesi → 401', async () => {
    const res = await adminRequest(app, { method: 'GET', url: '/v1/admin/comments' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/admin/comments', () => {
  test('default status PENDING, dengan counts per status', async () => {
    await visitorComment('PENDING', `Antre ${s}`);
    await visitorComment('APPROVED', `Tayang ${s}`);
    await visitorComment('SPAM', `Spam ${s}`);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/comments?articleId=${articleId}&pageSize=100`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);

    // Layar moderasi dibuka untuk mengerjakan antrean, jadi antrean yang muncul.
    expect(rowsOf(res).every((row) => row.status === 'PENDING')).toBe(true);

    // `counts` mengabaikan filter tab itu sendiri (kontrak §1.4).
    const counts = metaOf(res).counts ?? {};
    expect(counts.PENDING).toBeGreaterThanOrEqual(1);
    expect(counts.APPROVED).toBeGreaterThanOrEqual(1);
    expect(counts.SPAM).toBeGreaterThanOrEqual(1);
  });

  test('ipHash dan userAgent tidak pernah keluar, bahkan untuk Administrator', async () => {
    await visitorComment('PENDING', `Privat ${s}`);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/comments?articleId=${articleId}&pageSize=100`,
      token: admin.token,
    });
    expect(res.body).not.toContain(COMMENT_IP_HASH_MARKER);
    expect(res.body).not.toContain(COMMENT_USER_AGENT_MARKER);
    // `authorEmail` justru harus ada: moderator memakainya untuk menilai spam.
    expect(res.body).toContain(COMMENT_EMAIL_MARKER);
  });

  test('filter status dan pencarian q', async () => {
    const unik = `Penanda-${s}`;
    await createComment(prisma, {
      articleId,
      authorName: unik,
      status: 'SPAM',
      body: 'Tautan promosi.',
    });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/comments?status=SPAM&q=${encodeURIComponent(unik)}`,
      token: editor.token,
    });
    expect(rowsOf(res).map((row) => row.authorName)).toEqual([unik]);

    const kosong = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/comments?status=APPROVED&q=${encodeURIComponent(unik)}`,
      token: editor.token,
    });
    expect(rowsOf(kosong)).toHaveLength(0);
  });
});

describe('PATCH /v1/admin/comments/:id', () => {
  test('menyetujui mengisi moderatedBy dan moderatedAt', async () => {
    const id = await visitorComment('PENDING', `Disetujui ${s}`);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/comments/${id}`,
      token: editor.token,
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(200);
    expect(commentOf(res).status).toBe('APPROVED');
    expect(commentOf(res).moderatedBy).toMatchObject({ id: editor.id });
    expect(commentOf(res).moderatedAt).not.toBeNull();
  });

  test('SPAM masih bisa dikembalikan ke APPROVED (model §6.8)', async () => {
    const id = await visitorComment('SPAM', `Salah Spam ${s}`);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/comments/${id}`,
      token: editor.token,
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(200);
    expect(commentOf(res).status).toBe('APPROVED');
  });

  test('DELETED adalah titik akhir: tidak bisa diubah lagi', async () => {
    const id = await visitorComment('APPROVED', `Dihapus ${s}`);
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/comments/${id}`,
      token: editor.token,
      payload: { status: 'DELETED' },
    });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/comments/${id}`,
      token: editor.token,
      payload: { status: 'APPROVED' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });
});

describe('POST /v1/admin/comments/:id/replies', () => {
  test('balasan admin langsung tayang dan menyetujui induknya (A7)', async () => {
    const parentId = await visitorComment('PENDING', `Bertanya ${s}`);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${parentId}/replies`,
      token: editor.token,
      payload: { body: 'Rotan dikeringkan sekitar dua minggu.' },
    });
    expect(res.statusCode).toBe(201);

    const reply = commentOf(res);
    expect(reply.status).toBe('APPROVED');
    expect(reply.isStaffReply).toBe(true);
    expect(reply.author).toMatchObject({ id: editor.id });
    expect(reply.authorName).toBe(editor.name);
    // Balasan admin bukan data pengunjung, jadi tidak punya email.
    expect(reply.authorEmail).toBeNull();
    expect(reply.parentId).toBe(parentId);

    // Tanpa ini balasan akan tampil tanpa pertanyaan yang dijawabnya.
    const parent = await prisma.comment.findUniqueOrThrow({
      where: { id: parentId },
      select: { status: true },
    });
    expect(parent.status).toBe('APPROVED');
  });

  test('balasan atas balasan ditolak: utas hanya satu tingkat', async () => {
    const parentId = await visitorComment('APPROVED', `Induk ${s}`);
    const first = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${parentId}/replies`,
      token: editor.token,
      payload: { body: 'Balasan pertama.' },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${commentOf(first).id}/replies`,
      token: editor.token,
      payload: { body: 'Balasan atas balasan.' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ rule: 'REPLY_DEPTH_EXCEEDED' });
  });

  test('artikel yang belum terbit ditolak: balasan tidak akan terlihat pengunjung', async () => {
    const id = await createComment(prisma, {
      articleId: draftArticleId,
      authorName: `Di Draf ${s}`,
      status: 'PENDING',
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/replies`,
      token: editor.token,
      payload: { body: 'Halo.' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ rule: 'ARTICLE_NOT_PUBLISHED' });
  });
});

describe('POST /v1/admin/comments/:id/anonymize', () => {
  test('Editor tidak bisa menganonimkan (A3)', async () => {
    const id = await visitorComment('APPROVED', `Minta Hapus ${s}`);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/anonymize`,
      token: editor.token,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).details).toMatchObject({ requiredPermission: 'privacy.anonymize' });
  });

  test('komentar tayang: nama dan email hilang, isi dipertahankan, idempoten', async () => {
    const id = await visitorComment('APPROVED', `Sofia Asli ${s}`);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ data: { comment: AdminComment; affected: { comments: number } } }>()
      .data;
    expect(body.comment.authorName).toBe('Anonim');
    expect(body.comment.authorEmail).toBeNull();
    expect(body.comment.anonymizedAt).not.toBeNull();
    // Isi komentar yang sudah tayang dipertahankan: utas publik tetap utuh.
    expect(body.comment.body).not.toBe('');
    expect(body.affected.comments).toBe(1);

    const stored = await prisma.comment.findUniqueOrThrow({
      where: { id },
      select: { ipHash: true, userAgent: true },
    });
    expect(stored.ipHash).toBeNull();
    expect(stored.userAgent).toBeNull();

    // Idempoten (§6.11): putaran kedua tidak merusak apa pun.
    const again = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    expect(again.statusCode).toBe(200);
  });

  test('komentar yang tidak tayang kehilangan isinya juga', async () => {
    const id = await visitorComment('SPAM', `Spam Pribadi ${s}`);

    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });

    const stored = await prisma.comment.findUniqueOrThrow({
      where: { id },
      select: { body: true, authorName: true },
    });
    // Isinya tidak pernah dibaca publik, jadi menyimpannya hanya menahan data
    // yang diminta hilang.
    expect(stored.body).toBe('');
    expect(stored.authorName).toBe('Anonim');
  });

  test('balasan admin ditolak: bukan data pengunjung', async () => {
    const parentId = await visitorComment('APPROVED', `Induk Balasan ${s}`);
    const reply = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${parentId}/replies`,
      token: editor.token,
      payload: { body: 'Jawaban resmi.' },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${commentOf(reply).id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });

  test('sameEmail menyapu seluruh komentar orang yang sama', async () => {
    const email = `hapus-saya-${s}@contoh.invalid`;
    const first = await visitorComment('APPROVED', `Sama A ${s}`);
    const second = await visitorComment('PENDING', `Sama B ${s}`);
    await prisma.comment.updateMany({
      where: { id: { in: [first, second] } },
      data: { authorEmail: email },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${first}/anonymize`,
      token: admin.token,
      payload: { sameEmail: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { affected: { comments: number } } }>().data.affected.comments).toBe(2);

    const other = await prisma.comment.findUniqueOrThrow({
      where: { id: second },
      select: { authorName: true, authorEmail: true },
    });
    expect(other.authorName).toBe('Anonim');
    expect(other.authorEmail).toBeNull();
  });

  test('log aktivitas lama ikut kehilangan isinya', async () => {
    const id = await visitorComment('APPROVED', `Berjejak ${s}`);
    // Moderasi menulis log yang memuat nama penulis komentar.
    await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/comments/${id}`,
      token: editor.token,
      payload: { status: 'SPAM' },
    });

    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/comments/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });

    const logs = await prisma.activityLog.findMany({
      where: { entityType: 'Comment', entityId: id },
      select: { message: true },
    });
    // Tanpa langkah ini anonimisasi hanya memindahkan nama ke tabel lain.
    expect(logs.every((log) => !log.message.includes(`Berjejak ${s}`))).toBe(true);
  });
});

describe('POST /v1/admin/comments/bulk', () => {
  test('sukses parsial: DELETED gagal, sisanya tetap diproses', async () => {
    const ok1 = await visitorComment('PENDING', `Massal A ${s}`);
    const ok2 = await visitorComment('PENDING', `Massal B ${s}`);
    const deleted = await visitorComment('DELETED', `Massal Terhapus ${s}`);

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/comments/bulk',
      token: editor.token,
      payload: { action: 'APPROVE', ids: [ok1, deleted, ok2] },
    });
    expect(res.statusCode).toBe(200);

    const data = res.json<{
      data: { succeeded: string[]; failed: { id: string; code: string; message: string }[] };
    }>().data;
    expect(data.succeeded.sort()).toEqual([ok1, ok2].sort());
    // Yang gagal dilaporkan per baris, bukan menjatuhkan seluruh batch.
    expect(data.failed.map(({ id, code }) => ({ id, code }))).toEqual([
      { id: deleted, code: 'INVALID_STATE' },
    ]);
  });

  test('ANONYMIZE massal hanya untuk Administrator', async () => {
    const id = await visitorComment('APPROVED', `Massal Anonim ${s}`);

    const ditolak = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/comments/bulk',
      token: editor.token,
      payload: { action: 'ANONYMIZE', ids: [id] },
    });
    expect(ditolak.statusCode).toBe(403);

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/comments/bulk',
      token: admin.token,
      payload: { action: 'ANONYMIZE', ids: [id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { succeeded: string[] } }>().data.succeeded).toEqual([id]);
  });
});
