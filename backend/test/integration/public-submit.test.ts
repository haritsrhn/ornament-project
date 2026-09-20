import { randomUUID } from 'node:crypto';

import type { ErrorBody, ValidationDetail } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { EMAIL_NOT_CONFIGURED } from '../../src/modules/email/sender.js';
import { hashClientIp } from '../../src/modules/public/client-identity.js';
import { createPublicSubmitThrottles } from '../../src/modules/public/submit-throttle.js';
import { createTestUser, errorBody } from '../helpers/auth.js';
import {
  createCategory,
  createMaterial,
  deleteCatalogFixture,
  emptyFixtureIds,
  randomSuffix,
  type CatalogFixtureIds,
} from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import {
  createArticle,
  createArticleCategory,
  deleteJournalFixture,
  emptyJournalIds,
  type JournalFixtureIds,
} from '../helpers/journal.js';

/**
 * Tulis publik (#21 submit inquiry, #22 submit komentar, #23 anti-spam)
 * terhadap database tes.
 *
 * Yang dibuktikan di sini adalah hal-hal yang tidak bisa dibuktikan unit test:
 * nomor referensi yang benar-benar unik & berurutan dari sequence, baris yang
 * benar-benar tidak muncul (honeypot, `PENDING`), dan `Idempotency-Key` yang
 * benar-benar menahan baris kedua.
 *
 * Setiap tes memakai **IP pengunjung sendiri** supaya batas per `ipHash`
 * (§2.3) tidak bocor antar tes, dan fixture-nya dibersihkan sendiri.
 */

const INTERNAL_KEY = 'kunci-internal-tes-yang-cukup-panjang';

let prisma: PrismaClient;
let app: FastifyInstance;

const catalogIds: CatalogFixtureIds = emptyFixtureIds();
const journalIds: JournalFixtureIds = emptyJournalIds();

const s = randomSuffix();
const slugs = {
  category: `lighting-${s}`,
  material: `rotan-${s}`,
  articleCategory: `proses-${s}`,
  published: `artikel-terbit-${s}`,
  draft: `artikel-draf-${s}`,
};

let categoryId = '';
let materialId = '';

/** Semua inquiry & komentar yang dibuat tes ini, untuk dibersihkan di akhir. */
const createdInquiryIds: string[] = [];

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({
    prisma,
    logger: false,
    internalApiKey: INTERNAL_KEY,
    // Limit besar: tes ini menguji *fungsi*, bukan batasnya. Batasnya sendiri
    // diuji di `test/unit/submit-throttle.test.ts` dan di `describe` terakhir
    // berkas ini dengan app-nya sendiri.
    publicSubmitThrottles: createPublicSubmitThrottles({
      inquiryBurst: { limit: 500, windowMs: 60_000 },
      inquiryDaily: { limit: 500, windowMs: 60_000 },
      commentBurst: { limit: 500, windowMs: 60_000 },
      commentDaily: { limit: 500, windowMs: 60_000 },
    }),
  });
  await app.ready();

  categoryId = await createCategory(prisma, catalogIds, {
    slug: slugs.category,
    name: `Lighting ${s}`,
  });
  materialId = await createMaterial(prisma, catalogIds, slugs.material, `Rotan alami ${s}`);

  const author = await createTestUser(prisma, {
    name: `Penulis ${s}`,
    localPart: `penulis-submit-${s}`,
  });
  journalIds.userIds.push(author.id);
  const articleCategoryId = await createArticleCategory(prisma, journalIds, {
    slug: slugs.articleCategory,
  });
  await createArticle(prisma, journalIds, {
    slug: slugs.published,
    authorId: author.id,
    categoryId: articleCategoryId,
  });
  await createArticle(prisma, journalIds, {
    slug: slugs.draft,
    authorId: author.id,
    categoryId: articleCategoryId,
    status: 'DRAFT',
  });
});

afterAll(async () => {
  if (createdInquiryIds.length > 0) {
    await prisma.activityLog.deleteMany({ where: { entityId: { in: createdInquiryIds } } });
    await prisma.inquiry.deleteMany({ where: { id: { in: createdInquiryIds } } });
  }
  await prisma.idempotencyRecord.deleteMany({
    where: { scope: { startsWith: 'POST /v1/public' } },
  });
  await deleteJournalFixture(prisma, journalIds);
  await deleteCatalogFixture(prisma, catalogIds);
  await app.close();
});

// ── Helper request ───────────────────────────────────────────────────────────

interface SubmitOptions {
  ip: string;
  key?: string;
  internalKey?: string | null;
  userAgent?: string;
}

function headersFor(options: SubmitOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-client-ip': options.ip,
    'x-client-user-agent': options.userAgent ?? 'PengunjungTes/1.0',
    ...(options.internalKey === null
      ? {}
      : { 'x-internal-key': options.internalKey ?? INTERNAL_KEY }),
    'idempotency-key': options.key ?? randomUUID(),
  };
}

const validInquiry = (extra: Record<string, unknown> = {}) => ({
  name: 'Erik Lindqvist',
  email: 'erik@nordhem.se',
  volumeQuantity: 400,
  ...extra,
});

function postInquiry(
  options: SubmitOptions,
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/v1/public/inquiries',
    headers: headersFor(options),
    payload: body,
  });
}

function postComment(
  slug: string,
  options: SubmitOptions,
  body: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/v1/public/articles/${slug}/comments`,
    headers: headersFor(options),
    payload: body,
  });
}

function referenceOf(res: LightMyRequestResponse): string {
  return (JSON.parse(res.body) as { data: { reference: string } }).data.reference;
}

/** Mengambil inquiry tersimpan **dan** mendaftarkannya untuk dibersihkan. */
async function storedInquiry(reference: string) {
  const inquiry = await prisma.inquiry.findUnique({ where: { reference } });
  if (inquiry !== null) createdInquiryIds.push(inquiry.id);
  return inquiry;
}

function detailsOf(body: ErrorBody): ValidationDetail[] {
  return body.details as ValidationDetail[];
}

// ── #21 Submit inquiry ───────────────────────────────────────────────────────

describe('POST /v1/public/inquiries', () => {
  test('menyimpan inquiry dan hanya mengembalikan reference (§4)', async () => {
    const res = await postInquiry(
      { ip: '198.51.100.11' },
      validInquiry({
        company: 'Nordhem AB',
        country: 'Swedia',
        categoryId,
        materialId,
        targetShipText: 'Nov 2026',
        destinationPort: 'Göteborg',
        budgetPerUnitUsd: '38.00',
        message: 'Butuh finishing natural.',
        website: '',
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');

    const body = JSON.parse(res.body) as { data: Record<string, unknown> };
    // Respons submit **hanya** `{ reference }` (kontrak §4 baris Inquiry).
    expect(Object.keys(body.data)).toEqual(['reference']);
    expect(body.data.reference).toMatch(/^INQ-\d{4,}$/);
    // Tidak ada satu pun isi inquiry yang ikut keluar.
    expect(res.body).not.toContain('erik@nordhem.se');
    expect(res.body).not.toContain('Nordhem');

    const inquiry = await storedInquiry(body.data.reference as string);
    expect(inquiry).not.toBeNull();
    expect(inquiry?.name).toBe('Erik Lindqvist');
    expect(inquiry?.email).toBe('erik@nordhem.se');
    expect(inquiry?.status).toBe('NEW');
    expect(inquiry?.volumeQuantity).toBe(400);
    expect(inquiry?.budgetPerUnitUsd?.toFixed(2)).toBe('38.00');
    // Label kategori/material disalin (§3.7).
    expect(inquiry?.categoryLabel).toBe(`Lighting ${s}`);
    expect(inquiry?.materialLabel).toBe(`Rotan alami ${s}`);
    // Subjek turunan, keduanya terisi (§6.5).
    expect(inquiry?.subject).toBe(`Lighting ${s} Rotan alami ${s} — 400 pcs`);
    // `reference` = `INQ-` + `number` ber-pad (§6.5).
    expect(inquiry?.reference).toBe(`INQ-${String(inquiry?.number).padStart(4, '0')}`);
  });

  test('menulis ActivityLog tanpa aktor dan tanpa data pribadi (§3.8/§4)', async () => {
    const res = await postInquiry({ ip: '198.51.100.12' }, validInquiry({ name: 'Nama Rahasia' }));
    const inquiry = await storedInquiry(referenceOf(res));

    const log = await prisma.activityLog.findFirst({
      where: { entityType: 'Inquiry', entityId: inquiry?.id ?? null },
    });
    expect(log?.kind).toBe('INQUIRY');
    expect(log?.action).toBe('inquiry.created');
    expect(log?.actorId).toBeNull();
    expect(log?.message).toContain(inquiry?.reference);
    expect(log?.message).not.toContain('Nama Rahasia');
  });

  test('referensi unik dan berurutan untuk submit berturut-turut', async () => {
    const first = await postInquiry({ ip: '198.51.100.13' }, validInquiry());
    const second = await postInquiry({ ip: '198.51.100.13' }, validInquiry());

    const a = await storedInquiry(referenceOf(first));
    const b = await storedInquiry(referenceOf(second));

    expect(a?.reference).not.toBe(b?.reference);
    expect(b?.number).toBe((a?.number ?? 0) + 1);
    expect(b?.reference).toBe(`INQ-${String((a?.number ?? 0) + 1).padStart(4, '0')}`);
  });

  test('subjek memakai material saja bila kategori kosong (§6.5)', async () => {
    const res = await postInquiry(
      { ip: '198.51.100.14' },
      validInquiry({ materialId, volumeQuantity: 12 }),
    );
    const inquiry = await storedInquiry(referenceOf(res));
    expect(inquiry?.subject).toBe(`Rotan alami ${s} — 12 pcs`);
  });

  test('subjek memakai teks cadangan bila kategori & material kosong (§6.5)', async () => {
    const res = await postInquiry({ ip: '198.51.100.15' }, validInquiry({ volumeQuantity: 7 }));
    const inquiry = await storedInquiry(referenceOf(res));
    expect(inquiry?.subject).toBe('Permintaan produk — 7 pcs');
  });

  test.each([
    ['Nov 2026', '2026-11-01'],
    ['November 2026', '2026-11-01'],
    ['2026-11', '2026-11-01'],
    ['2026-11-17', '2026-11-17'],
    ['Q3 2026', '2026-07-01'],
  ])('targetShipDate dari "%s" → %s (Q10)', async (text, expected) => {
    const res = await postInquiry({ ip: '198.51.100.16' }, validInquiry({ targetShipText: text }));
    const inquiry = await storedInquiry(referenceOf(res));
    expect(inquiry?.targetShipText).toBe(text);
    expect(inquiry?.targetShipDate?.toISOString().slice(0, 10)).toBe(expected);
  });

  test.each(['ASAP', 'Flexible / ASAP', 'Early next month'])(
    'targetShipDate null untuk teks relatif "%s"',
    async (text) => {
      const res = await postInquiry(
        { ip: '198.51.100.17' },
        validInquiry({ targetShipText: text }),
      );
      const inquiry = await storedInquiry(referenceOf(res));
      expect(inquiry?.targetShipText).toBe(text);
      expect(inquiry?.targetShipDate).toBeNull();
    },
  );

  test('ipHash tersimpan sebagai hash, bukan IP mentah (§6.11)', async () => {
    const ip = '198.51.100.18';
    const res = await postInquiry({ ip }, validInquiry());
    const inquiry = await storedInquiry(referenceOf(res));

    expect(inquiry?.ipHash).toBe(hashClientIp(ip, INTERNAL_KEY));
    expect(inquiry?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inquiry?.ipHash).not.toContain(ip);
    expect(inquiry?.userAgent).toBe('PengunjungTes/1.0');
  });

  test('hasil notifikasi email dicatat tanpa menggagalkan request (ADR K4)', async () => {
    const res = await postInquiry({ ip: '198.51.100.19' }, validInquiry());
    expect(res.statusCode).toBe(201);

    const inquiry = await storedInquiry(referenceOf(res));
    // `NoopEmailSender`: inquiry tersimpan, tetapi tidak berpura-pura terkirim.
    expect(inquiry?.notificationMessageId).toBeNull();
    expect([EMAIL_NOT_CONFIGURED, 'CONTACT_EMAIL_NOT_SET']).toContain(inquiry?.notificationError);
  });

  test.each(['name', 'email', 'volumeQuantity'])(
    'field wajib "%s" → VALIDATION_FAILED dengan path field itu',
    async (field) => {
      // Tanpa `delete` pada kunci dinamis: bentuk body disusun dari entri.
      const body = Object.fromEntries(
        Object.entries(validInquiry()).filter(([key]) => key !== field),
      );

      const res = await postInquiry({ ip: '198.51.100.20' }, body);
      expect(res.statusCode).toBe(400);
      const error = errorBody(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(detailsOf(error).map((d) => d.path)).toContain(field);
    },
  );

  test('field tak dikenal ditolak (strictObject, §1.3)', async () => {
    const res = await postInquiry({ ip: '198.51.100.21' }, validInquiry({ status: 'DONE' }));
    expect(res.statusCode).toBe(400);
    const detail = detailsOf(errorBody(res))[0];
    expect(detail?.code).toBe('unrecognized_keys');
    expect(detail?.path).toBe('status');
  });

  test('categoryId tak dikenal → VALIDATION_FAILED (code not_found)', async () => {
    const res = await postInquiry(
      { ip: '198.51.100.22' },
      validInquiry({ categoryId: randomUUID() }),
    );
    expect(res.statusCode).toBe(400);
    const detail = detailsOf(errorBody(res))[0];
    expect(detail).toEqual({
      path: 'categoryId',
      code: 'not_found',
      message: 'Kategori tidak dikenal.',
    });
  });

  test('lampiran yang tidak pernah diterbitkan → 422 UPLOAD_INVALID', async () => {
    const res = await postInquiry(
      { ip: '198.51.100.23' },
      validInquiry({ attachmentUploadIds: ['upl_tidak_ada'] }),
    );
    expect(res.statusCode).toBe(422);
    const error = errorBody(res);
    expect(error.code).toBe('UPLOAD_INVALID');
    expect(error.details).toEqual({ reason: 'NOT_FOUND', uploadId: 'upl_tidak_ada' });
  });
});

// ── #22 Submit komentar ──────────────────────────────────────────────────────

describe('POST /v1/public/articles/:slug/comments', () => {
  test('masuk antrean PENDING dan responsnya tidak membocorkan apa pun (§4)', async () => {
    const res = await postComment(
      slugs.published,
      { ip: '198.51.100.31' },
      {
        authorName: 'Sofia L.',
        authorEmail: 'sofia@studio.se',
        body: 'Berapa lama rotan dikeringkan?',
        website: '',
      },
    );

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ data: { status: 'PENDING' } });
    // Email komentator tidak pernah keluar, termasuk sebagai hash (Q9).
    expect(res.body).not.toContain('sofia@studio.se');
    expect(res.body).not.toContain('Sofia');

    const comment = await prisma.comment.findFirst({
      where: { authorEmail: 'sofia@studio.se' },
    });
    expect(comment?.status).toBe('PENDING');
    expect(comment?.parentId).toBeNull();
    expect(comment?.authorUserId).toBeNull();
    expect(comment?.ipHash).toBe(hashClientIp('198.51.100.31', INTERNAL_KEY));
    expect(comment?.userAgent).toBe('PengunjungTes/1.0');
  });

  test('komentar baru TIDAK muncul di GET .../comments sampai disetujui (§6.8)', async () => {
    const marker = `Komentar menunggu ${randomUUID()}`;
    await postComment(
      slugs.published,
      { ip: '198.51.100.32' },
      { authorName: 'Bot Bukan', authorEmail: `pending-${s}@contoh.invalid`, body: marker },
    );

    const before = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.published}/comments`,
    });
    expect(before.statusCode).toBe(200);
    expect(before.body).not.toContain(marker);
    expect(before.body).not.toContain(`pending-${s}@contoh.invalid`);

    // Setelah moderasi, komentar yang sama muncul — jadi absennya di atas
    // memang karena status, bukan karena komentarnya tidak tersimpan.
    await prisma.comment.updateMany({ where: { body: marker }, data: { status: 'APPROVED' } });
    const after = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.published}/comments`,
    });
    expect(after.body).toContain(marker);
    // Bahkan setelah tampil, emailnya tetap tidak pernah ikut (§4).
    expect(after.body).not.toContain(`pending-${s}@contoh.invalid`);
  });

  test('artikel draf → 404, tanpa menyimpan komentar', async () => {
    const res = await postComment(
      slugs.draft,
      { ip: '198.51.100.33' },
      { authorName: 'X', authorEmail: `draf-${s}@contoh.invalid`, body: 'Halo' },
    );
    expect(res.statusCode).toBe(404);
    expect(errorBody(res).code).toBe('NOT_FOUND');
    expect(await prisma.comment.count({ where: { authorEmail: `draf-${s}@contoh.invalid` } })).toBe(
      0,
    );
  });

  test('artikel tidak ada → 404 yang sama', async () => {
    const res = await postComment(
      `tidak-ada-${s}`,
      { ip: '198.51.100.34' },
      { authorName: 'X', authorEmail: 'x@contoh.invalid', body: 'Halo' },
    );
    expect(res.statusCode).toBe(404);
    expect(errorBody(res).code).toBe('NOT_FOUND');
  });

  test('parentId ditolak: komentar publik selalu akar (nesting maks 1 tingkat, §3.6)', async () => {
    const res = await postComment(
      slugs.published,
      { ip: '198.51.100.35' },
      {
        authorName: 'X',
        authorEmail: 'x@contoh.invalid',
        body: 'Balasan',
        parentId: randomUUID(),
      },
    );
    expect(res.statusCode).toBe(400);
    const detail = detailsOf(errorBody(res))[0];
    expect(detail?.code).toBe('unrecognized_keys');
    expect(detail?.path).toBe('parentId');
  });

  test.each(['authorName', 'authorEmail', 'body'])(
    'field wajib "%s" → VALIDATION_FAILED',
    async (field) => {
      const body = Object.fromEntries(
        Object.entries({
          authorName: 'X',
          authorEmail: 'x@contoh.invalid',
          body: 'Halo',
        }).filter(([key]) => key !== field),
      );

      const res = await postComment(slugs.published, { ip: '198.51.100.36' }, body);
      expect(res.statusCode).toBe(400);
      expect(detailsOf(errorBody(res)).map((d) => d.path)).toContain(field);
    },
  );
});

// ── #23 Anti-spam ────────────────────────────────────────────────────────────

describe('proteksi anti-spam', () => {
  test('inquiry: honeypot terisi → 201 palsu, tanpa baris baru (A6)', async () => {
    const before = await prisma.inquiry.count();
    const res = await postInquiry(
      { ip: '198.51.100.41' },
      validInquiry({ name: 'Bot Spam', website: 'http://spam.example' }),
    );

    expect(res.statusCode).toBe(201);
    const reference = referenceOf(res);
    // Bentuknya sama persis dengan referensi asli…
    expect(reference).toMatch(/^INQ-\d{4,}$/);
    // …tetapi tidak pernah tersimpan.
    expect(await prisma.inquiry.findUnique({ where: { reference } })).toBeNull();
    expect(await prisma.inquiry.count()).toBe(before);
    expect(await prisma.inquiry.count({ where: { name: 'Bot Spam' } })).toBe(0);
  });

  test('komentar: honeypot terisi → 202 palsu, tanpa baris baru (A6)', async () => {
    const email = `honeypot-${s}@contoh.invalid`;
    const before = await prisma.comment.count();

    const res = await postComment(
      slugs.published,
      { ip: '198.51.100.42' },
      { authorName: 'Bot', authorEmail: email, body: 'Beli murah', website: 'http://spam' },
    );

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ data: { status: 'PENDING' } });
    expect(await prisma.comment.count()).toBe(before);
    expect(await prisma.comment.count({ where: { authorEmail: email } })).toBe(0);
  });

  test('honeypot tidak memakai kunci idempotensi (bot tidak mendapat sinyal apa pun)', async () => {
    const key = randomUUID();
    const spam = await postInquiry(
      { ip: '198.51.100.43', key },
      validInquiry({ website: 'http://spam' }),
    );
    expect(spam.statusCode).toBe(201);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
  });

  test.each([
    ['tanpa X-Internal-Key', null],
    ['dengan key salah', 'kunci-salah'],
  ])('inquiry %s → 401 INVALID_INTERNAL_KEY (A9)', async (_label, key) => {
    const res = await postInquiry(
      { ip: '198.51.100.44', internalKey: key },
      validInquiry({ name: 'Tanpa Kunci' }),
    );
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('INVALID_INTERNAL_KEY');
    expect(await prisma.inquiry.count({ where: { name: 'Tanpa Kunci' } })).toBe(0);
  });

  test('komentar tanpa X-Internal-Key → 401, ditolak sebelum validasi body', async () => {
    const res = await postComment(
      slugs.published,
      { ip: '198.51.100.45', internalKey: null },
      // Body sengaja tidak valid: `401` harus menang atas `400` (§1.10).
      { tidak: 'valid' },
    );
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('INVALID_INTERNAL_KEY');
  });

  test('X-Client-Ip hanya dipercaya dengan key valid: key salah tidak pernah tersimpan', async () => {
    const res = await postInquiry(
      { ip: '203.0.113.99', internalKey: 'kunci-salah' },
      validInquiry(),
    );
    expect(res.statusCode).toBe(401);
    // Tidak ada baris dengan hash IP yang diklaim header itu.
    expect(
      await prisma.inquiry.count({ where: { ipHash: hashClientIp('203.0.113.99', INTERNAL_KEY) } }),
    ).toBe(0);
  });

  test('Idempotency-Key wajib (§1.8)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/public/inquiries',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': INTERNAL_KEY,
        'x-client-ip': '198.51.100.46',
      },
      payload: validInquiry(),
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    expect(detailsOf(errorBody(res)).map((d) => d.path)).toContain('idempotency-key');
  });

  test('Idempotency-Key terlalu pendek ditolak', async () => {
    const res = await postInquiry({ ip: '198.51.100.47', key: 'pendek' }, validInquiry());
    expect(res.statusCode).toBe(400);
    expect(detailsOf(errorBody(res)).map((d) => d.path)).toContain('idempotency-key');
  });

  test('inquiry: kunci sama dua kali → satu baris, respons identik (§1.8)', async () => {
    const key = randomUUID();
    const body = validInquiry({ name: `Idempoten ${s}` });

    const first = await postInquiry({ ip: '198.51.100.48', key }, body);
    const second = await postInquiry({ ip: '198.51.100.48', key }, body);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    await storedInquiry(referenceOf(first));
    expect(await prisma.inquiry.count({ where: { name: `Idempoten ${s}` } })).toBe(1);
  });

  test('komentar: kunci sama dua kali → satu baris, respons identik', async () => {
    const key = randomUUID();
    const email = `idem-komentar-${s}@contoh.invalid`;
    const body = { authorName: 'Sekali', authorEmail: email, body: 'Sekali saja' };

    const first = await postComment(slugs.published, { ip: '198.51.100.49', key }, body);
    const second = await postComment(slugs.published, { ip: '198.51.100.49', key }, body);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.body).toBe(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.comment.count({ where: { authorEmail: email } })).toBe(1);
  });

  test('kunci sama + body berbeda → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = randomUUID();
    const first = await postInquiry({ ip: '198.51.100.50', key }, validInquiry());
    expect(first.statusCode).toBe(201);
    await storedInquiry(referenceOf(first));

    const second = await postInquiry(
      { ip: '198.51.100.50', key },
      validInquiry({ volumeQuantity: 999 }),
    );
    expect(second.statusCode).toBe(422);
    expect(errorBody(second).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.inquiry.count({ where: { volumeQuantity: 999 } })).toBe(0);
  });

  test('kunci sama dari IP berbeda tidak membaca respons milik orang lain', async () => {
    const key = randomUUID();
    const body = validInquiry({ name: `Berbagi Kunci ${s}` });

    const first = await postInquiry({ ip: '198.51.100.51', key }, body);
    const second = await postInquiry({ ip: '198.51.100.52', key }, body);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // Dua pemanggil berbeda → dua inquiry berbeda, bukan replay.
    expect(referenceOf(second)).not.toBe(referenceOf(first));
    await storedInquiry(referenceOf(first));
    await storedInquiry(referenceOf(second));
    expect(await prisma.inquiry.count({ where: { name: `Berbagi Kunci ${s}` } })).toBe(2);
  });

  test('kegagalan tidak mengunci kunci: kunci yang sama bisa dipakai lagi', async () => {
    const key = randomUUID();
    // Artikel draf → 404 di dalam `run`; barisnya harus dihapus lagi.
    const failed = await postComment(
      slugs.draft,
      { ip: '198.51.100.53', key },
      { authorName: 'X', authorEmail: `retry-${s}@contoh.invalid`, body: 'Halo' },
    );
    expect(failed.statusCode).toBe(404);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);

    const retried = await postComment(
      slugs.published,
      { ip: '198.51.100.53', key },
      { authorName: 'X', authorEmail: `retry-${s}@contoh.invalid`, body: 'Halo' },
    );
    expect(retried.statusCode).toBe(202);
  });
});

describe('rate limit per ipHash (§2.3)', () => {
  test('inquiry: submit ke-(n+1) dari ipHash sama → 429 dengan Retry-After', async () => {
    const limited = buildApp({
      prisma,
      logger: false,
      internalApiKey: INTERNAL_KEY,
      publicSubmitThrottles: createPublicSubmitThrottles({
        inquiryBurst: { limit: 2, windowMs: 60_000 },
      }),
    });
    await limited.ready();

    const send = (ip: string) =>
      limited.inject({
        method: 'POST',
        url: '/v1/public/inquiries',
        headers: headersFor({ ip }),
        payload: validInquiry({ name: `Batas ${s}` }),
      });

    for (let i = 0; i < 2; i += 1) {
      const res = await send('198.51.100.60');
      expect(res.statusCode).toBe(201);
      await storedInquiry(referenceOf(res));
    }

    const blocked = await send('198.51.100.60');
    expect(blocked.statusCode).toBe(429);
    expect(errorBody(blocked).code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // Batasnya per `ipHash`, jadi pengunjung lain tidak ikut terkunci —
    // padahal keduanya datang dari koneksi (server Next) yang sama.
    const other = await send('198.51.100.61');
    expect(other.statusCode).toBe(201);
    await storedInquiry(referenceOf(other));

    await limited.close();
  });

  test('presign lampiran: kontraknya berlaku, penandatanganan ditunda (503)', async () => {
    const base = { ip: '198.51.100.62' };

    const unsupported = await app.inject({
      method: 'POST',
      url: '/v1/public/inquiry-uploads',
      headers: headersFor(base),
      payload: { fileName: 'gambar.gif', mimeType: 'image/gif', sizeBytes: 1024 },
    });
    expect(unsupported.statusCode).toBe(415);
    expect(errorBody(unsupported).code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const tooLarge = await app.inject({
      method: 'POST',
      url: '/v1/public/inquiry-uploads',
      headers: headersFor(base),
      payload: { fileName: 'besar.pdf', mimeType: 'application/pdf', sizeBytes: 11 * 1024 * 1024 },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(errorBody(tooLarge).code).toBe('PAYLOAD_TOO_LARGE');

    const valid = await app.inject({
      method: 'POST',
      url: '/v1/public/inquiry-uploads',
      headers: headersFor(base),
      payload: { fileName: 'teknis.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    });
    // Bukan 500, dan bukan 201 dengan URL yang tidak bisa dipakai.
    expect(valid.statusCode).toBe(503);
    expect(errorBody(valid).code).toBe('SERVICE_UNAVAILABLE');

    const noKey = await app.inject({
      method: 'POST',
      url: '/v1/public/inquiry-uploads',
      headers: headersFor({ ...base, internalKey: null }),
      payload: { fileName: 'teknis.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    });
    expect(noKey.statusCode).toBe(401);
  });
});
