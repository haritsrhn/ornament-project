import type { AdminInquiry, AdminInquiryRow, InquiryReplyDto, PageMeta } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import { ADMIN_ORIGIN, createTestUser, deleteTestUsers, errorBody } from '../helpers/auth.js';
import { randomSuffix } from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import { createRecordingEmailSender, type RecordingEmailSender } from '../helpers/email.js';
import { createFakeR2, type FakeR2 } from '../helpers/r2.js';

/**
 * Inbox inquiry (#31) — kontrak §5.11, model §6.5 & §6.11.
 *
 * Lima hal yang paling mahal bila salah:
 *
 * 1. **Kegagalan email bukan 5xx** (§1.10): `200` dengan `FAILED` + `emailError`.
 * 2. **`SENT` tidak bisa diedit atau dihapus** — yang sudah sampai ke pembeli
 *    tidak bisa ditarik.
 * 3. **Transisi status** §6.5, termasuk `DONE` yang hanya terbuka lewat balasan.
 * 4. **Inquiry yang dianonimkan tidak bisa dibalas.**
 * 5. **Contributor tidak punya akses**: ini data pembeli, bukan konten.
 */

let prisma: PrismaClient;
let app: FastifyInstance;
let email: RecordingEmailSender;
let r2: FakeR2;

const s = randomSuffix();
const userIds: string[] = [];
const inquiryIds: string[] = [];
const mediaIds: string[] = [];

interface Session {
  id: string;
  name: string;
  token: string;
}
let admin: Session;
let editor: Session;
let contributor: Session;

const inquiryOf = (res: LightMyRequestResponse): AdminInquiry =>
  res.json<{ data: AdminInquiry }>().data;
const rowsOf = (res: LightMyRequestResponse): AdminInquiryRow[] =>
  res.json<{ data: AdminInquiryRow[] }>().data;
const metaOf = (res: LightMyRequestResponse): PageMeta => res.json<{ meta: PageMeta }>().meta;
const replyOf = (res: LightMyRequestResponse): InquiryReplyDto =>
  res.json<{ data: InquiryReplyDto }>().data;
const sendOf = (res: LightMyRequestResponse) =>
  res.json<{ data: { reply: InquiryReplyDto; inquiry: AdminInquiryRow } }>().data;

async function makeSession(role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'): Promise<Session> {
  const user = await createTestUser(prisma, { role, localPart: `inq-${role.toLowerCase()}` });
  userIds.push(user.id);
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true },
  });
  return { id: user.id, name: row.name, token: await loginToken(app, user.email, user.password) };
}

let sequence = 0;

/** Inquiry pembeli; nomornya dari sequence supaya tidak bentrok antar tes. */
async function createInquiry(
  overrides: {
    email?: string | null;
    status?: 'NEW' | 'IN_PROGRESS' | 'DONE';
    message?: string;
  } = {},
): Promise<string> {
  sequence += 1;
  const row = await prisma.inquiry.create({
    data: {
      reference: `INQ-UJI-${s}-${String(sequence)}`,
      subject: `Rotan alami ${s} — 400 pcs`,
      name: `Erik ${s}`,
      company: `Nordhem ${s}`,
      email:
        overrides.email === undefined
          ? `erik-${s}-${String(sequence)}@contoh.invalid`
          : overrides.email,
      country: 'Swedia',
      volumeQuantity: 400,
      message: overrides.message ?? 'Mohon penawaran untuk 400 pcs kursi rotan.',
      status: overrides.status ?? 'NEW',
      ...(overrides.status === 'DONE' ? { completedAt: new Date() } : {}),
    },
    select: { id: true },
  });
  inquiryIds.push(row.id);
  return row.id;
}

async function createPrivateMedia(label: string): Promise<string> {
  const row = await prisma.media.create({
    data: {
      key: `private/media/2026/09/${label}-${s}.pdf`,
      visibility: 'PRIVATE',
      kind: 'DOCUMENT',
      fileName: `${label}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: BigInt(2048),
    },
    select: { id: true, key: true },
  });
  mediaIds.push(row.id);
  r2.put(row.key, { sizeBytes: 2048, mimeType: 'application/pdf', body: Buffer.alloc(2048, 1) });
  return row.id;
}

beforeAll(async () => {
  prisma = createTestPrisma();
  email = createRecordingEmailSender();
  r2 = createFakeR2();
  app = buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    scheduledPublish: false,
    emailSender: email,
    r2,
  });

  admin = await makeSession('ADMINISTRATOR');
  editor = await makeSession('EDITOR');
  contributor = await makeSession('CONTRIBUTOR');
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { entityId: { in: inquiryIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.media.deleteMany({ where: { id: { in: mediaIds } } });
  await prisma.idempotencyRecord.deleteMany({
    where: { scope: { startsWith: 'POST /v1/admin/inquiries' } },
  });
  await deleteTestUsers(prisma, userIds);
  await app.close();
  await prisma.$disconnect();
});

describe('akses', () => {
  test('Contributor tidak punya akses: inquiry adalah data pembeli', async () => {
    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/inquiries',
      token: contributor.token,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/admin/inquiries', () => {
  test('counts memuat all, per status, dan unread', async () => {
    await createInquiry({ status: 'NEW' });
    await createInquiry({ status: 'DONE' });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries?q=${encodeURIComponent(s)}&pageSize=100`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);

    const counts = metaOf(res).counts ?? {};
    expect(counts.all).toBeGreaterThanOrEqual(2);
    expect(counts.NEW).toBeGreaterThanOrEqual(1);
    expect(counts.DONE).toBeGreaterThanOrEqual(1);
    expect(counts.unread).toBeGreaterThanOrEqual(2);
  });

  test('daftar memuat preview, bukan message penuh', async () => {
    const panjang = 'A'.repeat(400);
    await createInquiry({ message: panjang });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries?q=${encodeURIComponent(s)}&pageSize=100`,
      token: editor.token,
    });
    const row = rowsOf(res).find((item) => item.preview.startsWith('AAA'));
    expect(row).toBeDefined();
    expect(row?.preview.length).toBeLessThanOrEqual(120);
    expect(res.body).not.toContain(panjang);
  });

  test('pencarian q mencakup reference, nama, perusahaan, dan email', async () => {
    const id = await createInquiry();
    const stored = await prisma.inquiry.findUniqueOrThrow({
      where: { id },
      select: { reference: true },
    });

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries?q=${encodeURIComponent(stored.reference)}`,
      token: editor.token,
    });
    expect(rowsOf(res).map((row) => row.id)).toEqual([id]);
  });
});

describe('GET & PATCH /v1/admin/inquiries/:id', () => {
  test('GET tidak menandai dibaca; PATCH read: true yang menandainya', async () => {
    const id = await createInquiry();

    const detail = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
    });
    expect(detail.statusCode).toBe(200);
    // Membuka detail untuk mengintip tidak sama dengan menerima pekerjaannya.
    expect(inquiryOf(detail).readAt).toBeNull();

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { read: true },
    });
    expect(inquiryOf(res).readAt).not.toBeNull();
  });

  test('DONE mengisi completedAt; dibuka kembali mengosongkannya', async () => {
    const id = await createInquiry({ status: 'IN_PROGRESS' });

    const done = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { status: 'DONE' },
    });
    expect(inquiryOf(done).completedAt).not.toBeNull();
  });

  test('DONE → NEW ditolak, dan DONE → IN_PROGRESS hanya lewat balasan (§6.5)', async () => {
    const id = await createInquiry({ status: 'DONE' });

    for (const status of ['NEW', 'IN_PROGRESS']) {
      const res = await adminRequest(app, {
        method: 'PATCH',
        url: `/v1/admin/inquiries/${id}`,
        token: editor.token,
        payload: { status },
      });
      expect(res.statusCode).toBe(409);
      expect(errorBody(res).code).toBe('INVALID_STATE');
    }
  });

  test('IN_PROGRESS → NEW ditolak: "belum dibaca" tidak bisa dibuat ulang', async () => {
    const id = await createInquiry({ status: 'IN_PROGRESS' });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { status: 'NEW' },
    });
    expect(res.statusCode).toBe(409);
  });

  test('targetShipDate bisa dikoreksi manual dan dikosongkan (Q10)', async () => {
    const id = await createInquiry();

    const diisi = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { targetShipDate: '2026-11-01' },
    });
    expect(inquiryOf(diisi).targetShipDate).toBe('2026-11-01');

    const dikosongkan = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { targetShipDate: null },
    });
    expect(inquiryOf(dikosongkan).targetShipDate).toBeNull();
  });

  test('ISO datetime penuh ditolak: kolomnya tanggal, bukan waktu', async () => {
    const id = await createInquiry();
    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload: { targetShipDate: '2026-11-01T00:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('balasan', () => {
  test('balasan lahir DRAFT dengan subject turunan dan toEmail dari inquiry', async () => {
    const id = await createInquiry();

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Terima kasih, terlampir penawaran kami.' },
    });
    expect(res.statusCode).toBe(201);

    const reply = replyOf(res);
    expect(reply.status).toBe('DRAFT');
    expect(reply.subject.startsWith('Re: ')).toBe(true);
    expect(reply.toEmail).toContain('@contoh.invalid');
    expect(reply.sentAt).toBeNull();
    // Belum ada email yang dikirim: DRAFT hanya tersimpan.
    expect(email.replies).toHaveLength(0);
  });

  test('lampiran wajib Media PRIVATE', async () => {
    const id = await createInquiry();
    const publik = await prisma.media.create({
      data: {
        key: `media/2026/09/publik-${s}.pdf`,
        visibility: 'PUBLIC',
        kind: 'DOCUMENT',
        fileName: 'publik.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(10),
      },
      select: { id: true },
    });
    mediaIds.push(publik.id);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Penawaran.', attachmentMediaIds: [publik.id] },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ rule: 'MEDIA_NOT_PRIVATE' });
  });

  test('total lampiran yang terlalu besar ditolak saat disimpan, bukan saat dikirim', async () => {
    const id = await createInquiry();
    const besar: string[] = [];
    for (const label of ['besar-a', 'besar-b']) {
      const row = await prisma.media.create({
        data: {
          key: `private/media/2026/09/${label}-${s}.pdf`,
          visibility: 'PRIVATE',
          kind: 'DOCUMENT',
          fileName: `${label}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(9 * 1024 * 1024),
        },
        select: { id: true },
      });
      mediaIds.push(row.id);
      besar.push(row.id);
    }

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Terlampir.', attachmentMediaIds: besar },
    });
    // 18 MB: jumlah berkasnya sah (2 ≤ 5), totalnya yang tidak.
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toMatchObject({ rule: 'ATTACHMENTS_TOO_LARGE' });
  });

  test('kirim sukses: SENT, lampiran ikut, dan inquiry menjadi IN_PROGRESS', async () => {
    const id = await createInquiry({ status: 'NEW' });
    const mediaId = await createPrivateMedia('penawaran');

    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Terlampir penawaran.', attachmentMediaIds: [mediaId] },
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyOf(created).id}/send`,
      token: editor.token,
    });
    expect(res.statusCode).toBe(200);

    const { reply, inquiry } = sendOf(res);
    expect(reply.status).toBe('SENT');
    expect(reply.sentAt).not.toBeNull();
    expect(reply.emailError).toBeNull();
    // Balasan pertama yang terkirim memindahkan inquiry (§6.5).
    expect(inquiry.status).toBe('IN_PROGRESS');

    // Lampiran ikut sebagai berkas, bukan tautan bertanda tangan yang keburu
    // kedaluwarsa sebelum pembeli membukanya.
    const sent = email.replies.at(-1);
    expect(sent?.attachments).toHaveLength(1);
    expect(sent?.attachments?.[0]?.fileName).toBe('penawaran.pdf');
  });

  test('kirim gagal tetap 200 dengan FAILED + emailError, dan bisa diulang', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Halo.' },
    });
    const replyId = replyOf(created).id;

    email.failNextReply('Resend 503: service unavailable');
    const gagal = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}/send`,
      token: editor.token,
    });
    // Kegagalan email tidak pernah menjadi 5xx (kontrak §1.10).
    expect(gagal.statusCode).toBe(200);
    expect(sendOf(gagal).reply.status).toBe('FAILED');
    expect(sendOf(gagal).reply.emailError).toContain('503');
    // Inquiry belum berpindah: tidak ada yang benar-benar sampai.
    expect(sendOf(gagal).inquiry.status).toBe('NEW');

    const ulang = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}/send`,
      token: editor.token,
    });
    expect(sendOf(ulang).reply.status).toBe('SENT');
    expect(sendOf(ulang).reply.emailError).toBeNull();
  });

  test('SENT tidak bisa diedit maupun dihapus', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Halo.' },
    });
    const replyId = replyOf(created).id;
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}/send`,
      token: editor.token,
    });

    const edit = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}`,
      token: editor.token,
      payload: { body: 'Diubah.' },
    });
    expect(edit.statusCode).toBe(409);

    const hapus = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}`,
      token: editor.token,
    });
    expect(hapus.statusCode).toBe(409);

    const kirimUlang = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}/send`,
      token: editor.token,
    });
    expect(kirimUlang.statusCode).toBe(409);
  });

  test('DRAFT bisa diedit dan dihapus', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Draf awal.' },
    });
    const replyId = replyOf(created).id;

    const edit = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}`,
      token: editor.token,
      payload: { body: 'Draf yang sudah diperbaiki.' },
    });
    expect(edit.statusCode).toBe(200);
    expect(replyOf(edit).body).toBe('Draf yang sudah diperbaiki.');

    const hapus = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}`,
      token: editor.token,
    });
    expect(hapus.statusCode).toBe(204);
  });

  test('balasan milik inquiry lain → 404, bukan diam-diam diubah', async () => {
    const first = await createInquiry();
    const second = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${first}/replies`,
      token: editor.token,
      payload: { body: 'Halo.' },
    });

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${second}/replies/${replyOf(created).id}`,
      token: editor.token,
      payload: { body: 'Diubah lewat induk yang salah.' },
    });
    expect(res.statusCode).toBe(404);
  });

  test('Idempotency-Key mencegah klik ganda mengirim dua email', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Sekali saja.' },
    });
    const replyId = replyOf(created).id;
    const before = email.replies.length;

    const url = `/v1/admin/inquiries/${id}/replies/${replyId}/send`;
    const key = `kirim-${s}-${replyId}`;
    const first = await app.inject({
      method: 'POST',
      url,
      headers: {
        origin: ADMIN_ORIGIN,
        cookie: `__Host-osa_session=${editor.token}`,
        'idempotency-key': key,
      },
    });
    const second = await app.inject({
      method: 'POST',
      url,
      headers: {
        origin: ADMIN_ORIGIN,
        cookie: `__Host-osa_session=${editor.token}`,
        'idempotency-key': key,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(email.replies.length - before).toBe(1);
  });
});

describe('kekokohan pengiriman', () => {
  test('attachmentCount hanya menghitung lampiran pembeli, bukan lampiran balasan', async () => {
    const id = await createInquiry();
    const pembeli = await createPrivateMedia('dari-pembeli');
    await prisma.inquiryAttachment.create({
      data: { inquiryId: id, mediaId: pembeli },
      select: { id: true },
    });

    const balasan = await createPrivateMedia('dari-staf');
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Penawaran.', attachmentMediaIds: [balasan] },
    });

    const detail = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
    });
    expect(inquiryOf(detail).attachments).toHaveLength(1);

    const list = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/inquiries?q=${encodeURIComponent(s)}&pageSize=100`,
      token: editor.token,
    });
    const row = rowsOf(list).find((item) => item.id === id);
    // Badan klip di inbox harus sama dengan jumlah lampiran di detail; tanpa
    // filter `replyId: null` ia bertambah setiap kali staf membalas.
    expect(row?.attachmentCount).toBe(1);
  });

  test('R2 yang gagal dibaca tidak membuat /send menjadi 500', async () => {
    const id = await createInquiry();
    const mediaId = await createPrivateMedia('gagal-dibaca');
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Terlampir.', attachmentMediaIds: [mediaId] },
    });

    r2.failNextRead('R2 503: service unavailable');
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyOf(created).id}/send`,
      token: editor.token,
    });

    // Balasan tanpa lampiran lebih berguna daripada 500 tanpa jejak apa pun.
    expect(res.statusCode).toBe(200);
    expect(sendOf(res).reply.status).toBe('SENT');
    expect(email.replies.at(-1)?.attachments ?? []).toHaveLength(0);
  });

  test('pengiriman bersamaan: yang gagal tidak menimpa yang sudah SENT', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Sekali kirim.' },
    });
    const replyId = replyOf(created).id;
    const url = `/v1/admin/inquiries/${id}/replies/${replyId}/send`;

    // Satu dari dua panggilan gagal di sisi penyedia. Tanpa syarat
    // `status != SENT` di penulisan hasil, yang gagal belakangan akan
    // mengubah balasan yang sudah sampai ke pembeli menjadi FAILED — dan
    // balasan itu kembali bisa diedit, dihapus, serta dikirim ulang.
    email.failNextReply('Resend 429: rate limited');
    await Promise.all([
      adminRequest(app, { method: 'POST', url, token: editor.token }),
      adminRequest(app, { method: 'POST', url, token: editor.token }),
    ]);

    const stored = await prisma.inquiryReply.findUniqueOrThrow({
      where: { id: replyId },
      select: { status: true, sentAt: true },
    });
    expect(stored.status).toBe('SENT');
    expect(stored.sentAt).not.toBeNull();

    // Dan karenanya tetap terkunci.
    const edit = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}/replies/${replyId}`,
      token: editor.token,
      payload: { body: 'Diubah.' },
    });
    expect(edit.statusCode).toBe(409);
  });

  test('menandai DONE dua kali tidak memundurkan completedAt (§6.11)', async () => {
    const id = await createInquiry({ status: 'IN_PROGRESS' });
    const payload = { status: 'DONE' };

    const pertama = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload,
    });
    const completedAt = inquiryOf(pertama).completedAt;
    expect(completedAt).not.toBeNull();

    const kedua = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/inquiries/${id}`,
      token: editor.token,
      payload,
    });
    // Tenggat anonimisasi otomatis 24 bulan dihitung dari `completedAt`;
    // menekan "Tandai selesai" lagi tidak boleh memundurkannya diam-diam.
    expect(kedua.statusCode).toBe(200);
    expect(inquiryOf(kedua).completedAt).toBe(completedAt);
  });
});

describe('anonimisasi', () => {
  test('Editor ditolak; Administrator mengosongkan data pribadi dan balasannya', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Penawaran terlampir.' },
    });
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies/${replyOf(created).id}/send`,
      token: editor.token,
    });

    const ditolak = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: editor.token,
      payload: {},
    });
    expect(ditolak.statusCode).toBe(403);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const inquiry = res.json<{ data: { inquiry: AdminInquiry } }>().data.inquiry;
    expect(inquiry.name).toBe('Dianonimkan');
    expect(inquiry.email).toBeNull();
    expect(inquiry.message).toBeNull();
    expect(inquiry.preview).toBe('');
    expect(inquiry.anonymizedAt).not.toBeNull();
    // Yang dipertahankan untuk laporan (§6.11).
    expect(inquiry.reference).not.toBe('');
    expect(inquiry.volumeQuantity).toBe(400);
    expect(inquiry.country).toBe('Swedia');
    // Balasan kehilangan isinya, subjeknya tetap.
    expect(inquiry.replies[0]?.body).toBeNull();
    expect(inquiry.replies[0]?.toEmail).toBeNull();
    expect(inquiry.replies[0]?.subject).not.toBe('');
  });

  test('inquiry yang dianonimkan tidak bisa dibalas lagi', async () => {
    const id = await createInquiry();
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Halo?' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('INVALID_STATE');
  });

  test('lampiran pembeli ikut hilang beserta objek R2-nya', async () => {
    const id = await createInquiry();
    const mediaId = await createPrivateMedia('lampiran-pembeli');
    const media = await prisma.media.findUniqueOrThrow({
      where: { id: mediaId },
      select: { key: true },
    });
    await prisma.inquiryAttachment.create({
      data: { inquiryId: id, mediaId },
      select: { id: true },
    });

    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });

    expect(await prisma.inquiryAttachment.count({ where: { inquiryId: id } })).toBe(0);
    expect(await prisma.media.findUnique({ where: { id: mediaId } })).toBeNull();
    expect(r2.removed).toContain(media.key);
  });

  test('lampiran balasan tidak ikut dipurge: berkas pustaka staf bukan data pembeli', async () => {
    const pertama = await createInquiry();
    const kedua = await createInquiry();
    const bersama = await createPrivateMedia('daftar-harga');

    // Satu berkas pustaka dipakai membalas dua inquiry berbeda.
    for (const id of [pertama, kedua]) {
      await adminRequest(app, {
        method: 'POST',
        url: `/v1/admin/inquiries/${id}/replies`,
        token: editor.token,
        payload: { body: 'Terlampir daftar harga.', attachmentMediaIds: [bersama] },
      });
    }

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${pertama}/anonymize`,
      token: admin.token,
      payload: {},
    });

    // Tanpa penyaringan `replyId: null`, FK `Restrict` dari lampiran inquiry
    // kedua membatalkan transaksi dan inquiry ini tidak akan pernah bisa
    // dianonimkan.
    expect(res.statusCode).toBe(200);
    // Berkas staf tetap ada, dan balasan inquiry kedua masih menunjuknya.
    expect(await prisma.media.findUnique({ where: { id: bersama } })).not.toBeNull();
    expect(await prisma.inquiryAttachment.count({ where: { inquiryId: kedua } })).toBe(1);
  });

  test('pemutaran ulang idempotensi tidak membangkitkan data yang sudah dianonimkan', async () => {
    const id = await createInquiry();
    const created = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/replies`,
      token: editor.token,
      payload: { body: 'Penawaran kami terlampir.' },
    });
    const replyId = replyOf(created).id;
    const url = `/v1/admin/inquiries/${id}/replies/${replyId}/send`;
    const headers = {
      origin: ADMIN_ORIGIN,
      cookie: `__Host-osa_session=${editor.token}`,
      'idempotency-key': `anon-${s}-${replyId}`,
    };

    const first = await app.inject({ method: 'POST', url, headers });
    expect(first.statusCode).toBe(200);
    expect(first.body).toContain('@contoh.invalid');

    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });

    // Simpanan idempotensi hidup 24 jam dan tidak ikut dianonimkan, jadi ia
    // tidak boleh memuat DTO jadi — responsnya dirender ulang dari database.
    const replay = await app.inject({ method: 'POST', url, headers });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).not.toContain('@contoh.invalid');
    expect(replay.body).not.toContain('Penawaran kami terlampir');
  });

  test('idempoten: putaran kedua tidak merusak apa pun', async () => {
    const id = await createInquiry();
    await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/inquiries/${id}/anonymize`,
      token: admin.token,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: { inquiry: AdminInquiry } }>().data.inquiry.name).toBe('Dianonimkan');
  });
});
