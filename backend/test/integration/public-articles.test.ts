import type {
  CursorMetaWithTotal,
  PublicArticleCard,
  PublicArticleCategory,
  PublicArticleDetail,
  PublicComment,
} from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PUBLIC_GET_CACHE_CONTROL } from '../../src/modules/public/guard.js';
import { createTestUser, errorBody } from '../helpers/auth.js';
import { randomSuffix } from '../helpers/catalog.js';
import { createTestPrisma } from '../helpers/database.js';
import {
  COMMENT_EMAIL_MARKER,
  COMMENT_IP_HASH_MARKER,
  COMMENT_USER_AGENT_MARKER,
  createArticle,
  createArticleCategory,
  createArticleTag,
  createComment,
  createMedia,
  deleteJournalFixture,
  emptyJournalIds,
  paragraph,
  type JournalFixtureIds,
} from '../helpers/journal.js';

/**
 * Journal publik (#19) terhadap database tes. Fokusnya tiga hal yang tidak
 * boleh salah: **aturan "terbit"** termasuk artikel terjadwal (ADR K8),
 * **komentar hanya `APPROVED`**, dan **tidak ada field privat** (kontrak §4).
 */

let prisma: PrismaClient;
let app: FastifyInstance;
const ids: JournalFixtureIds = emptyJournalIds();

const s = randomSuffix();
const slugs = {
  categoryA: `proses-${s}`,
  categoryB: `material-${s}`,
  categoryKosong: `kosong-${s}`,
  tag: `bantul-${s}`,
  lama: `artikel-lama-${s}`,
  tengah: `artikel-tengah-${s}`,
  baru: `artikel-baru-${s}`,
  terjadwalLewat: `terjadwal-lewat-${s}`,
  terjadwalDepan: `terjadwal-depan-${s}`,
  draf: `artikel-draf-${s}`,
  trash: `artikel-trash-${s}`,
  tanpaExcerpt: `artikel-tanpa-excerpt-${s}`,
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.now();

/** Urutan efektif terbaru → terlama: terjadwalLewat, baru, tengah, lama. */
const dates = {
  lama: new Date(now - 4 * DAY),
  tengah: new Date(now - 3 * DAY),
  baru: new Date(now - 2 * DAY),
  terjadwalLewat: new Date(now - 1 * HOUR),
  terjadwalDepan: new Date(now + 7 * DAY),
};

let tengahId = '';
const commentDates = {
  pertama: new Date(now - 3 * HOUR),
  kedua: new Date(now - 2 * HOUR),
  balasan: new Date(now - 1 * HOUR),
};

function listOf(res: LightMyRequestResponse): {
  data: PublicArticleCard[];
  meta: CursorMetaWithTotal;
} {
  return res.json<{ data: PublicArticleCard[]; meta: CursorMetaWithTotal }>();
}

const detailOf = (res: LightMyRequestResponse): PublicArticleDetail =>
  res.json<{ data: PublicArticleDetail }>().data;

function commentsOf(res: LightMyRequestResponse): {
  data: PublicComment[];
  meta: CursorMetaWithTotal;
} {
  return res.json<{ data: PublicComment[]; meta: CursorMetaWithTotal }>();
}

const slugsOf = (res: LightMyRequestResponse): string[] =>
  listOf(res).data.map((article) => article.slug);

beforeAll(async () => {
  prisma = createTestPrisma();
  app = buildApp({ prisma, logger: false, internalApiKey: 'kunci-tes' });

  const author = await createTestUser(prisma, { name: `Penulis ${s}`, localPart: `penulis-${s}` });
  ids.userIds.push(author.id);
  const staff = await createTestUser(prisma, { name: `Admin ${s}`, localPart: `admin-${s}` });
  ids.userIds.push(staff.id);

  const categoryA = await createArticleCategory(prisma, ids, {
    slug: slugs.categoryA,
    name: `Proses ${s}`,
    position: 0,
    description: 'Kategori proses.',
  });
  const categoryB = await createArticleCategory(prisma, ids, {
    slug: slugs.categoryB,
    name: `Material ${s}`,
    position: 1,
  });
  await createArticleCategory(prisma, ids, {
    slug: slugs.categoryKosong,
    name: `Kosong ${s}`,
    position: 2,
  });

  const tagId = await createArticleTag(prisma, ids, slugs.tag);
  const publicMediaId = await createMedia(prisma, ids, { key: `media/${s}-publik.jpg` });
  const privateMediaId = await createMedia(prisma, ids, {
    key: `private/${s}-rahasia.jpg`,
    visibility: 'PRIVATE',
  });

  await createArticle(prisma, ids, {
    slug: slugs.lama,
    authorId: author.id,
    categoryId: categoryA,
    publishedAt: dates.lama,
    tagIds: [tagId],
  });
  tengahId = await createArticle(prisma, ids, {
    slug: slugs.tengah,
    authorId: author.id,
    categoryId: categoryA,
    publishedAt: dates.tengah,
    featuredImageId: publicMediaId,
    content: [
      paragraph('p1', 'Paragraf pertama.'),
      { id: 'h1', type: 'heading2', text: 'Sub judul' },
      { id: 'q1', type: 'quote', text: 'Kutipan.', cite: 'Narasumber' },
      { id: 'img-publik', type: 'image', mediaId: publicMediaId, caption: 'Foto publik' },
      { id: 'img-privat', type: 'image', mediaId: privateMediaId },
      { id: 'rusak', type: 'tipe-tak-dikenal', text: 'harus dibuang' },
    ],
  });
  await createArticle(prisma, ids, {
    slug: slugs.baru,
    authorId: author.id,
    categoryId: categoryB,
    publishedAt: dates.baru,
    tagIds: [tagId],
  });
  await createArticle(prisma, ids, {
    slug: slugs.terjadwalLewat,
    authorId: author.id,
    categoryId: categoryA,
    status: 'SCHEDULED',
    publishAt: dates.terjadwalLewat,
  });
  await createArticle(prisma, ids, {
    slug: slugs.terjadwalDepan,
    authorId: author.id,
    categoryId: categoryA,
    status: 'SCHEDULED',
    publishAt: dates.terjadwalDepan,
  });
  await createArticle(prisma, ids, {
    slug: slugs.draf,
    authorId: author.id,
    categoryId: categoryA,
    status: 'DRAFT',
  });
  await createArticle(prisma, ids, {
    slug: slugs.trash,
    authorId: author.id,
    categoryId: categoryA,
    publishedAt: dates.lama,
    trashed: true,
  });
  await createArticle(prisma, ids, {
    slug: slugs.tanpaExcerpt,
    authorId: author.id,
    categoryId: categoryB,
    publishedAt: new Date(now - 5 * DAY),
    excerpt: null,
    content: [paragraph('p1', 'Kalimat pembuka yang menjadi excerpt turunan.')],
  });

  // Komentar artikel `tengah`: dua akar `APPROVED` + satu balasan staf, dan
  // tiga komentar yang tidak boleh pernah tampil.
  const rootId = await createComment(prisma, {
    articleId: tengahId,
    authorName: 'Komentator Pertama',
    createdAt: commentDates.pertama,
  });
  await createComment(prisma, {
    articleId: tengahId,
    authorName: 'Komentator Kedua',
    createdAt: commentDates.kedua,
  });
  await createComment(prisma, {
    articleId: tengahId,
    authorName: 'Tim Ornament',
    parentId: rootId,
    authorUserId: staff.id,
    createdAt: commentDates.balasan,
  });
  for (const status of ['PENDING', 'SPAM', 'DELETED'] as const) {
    await createComment(prisma, {
      articleId: tengahId,
      authorName: `Komentar ${status}`,
      status,
      createdAt: commentDates.kedua,
    });
    await createComment(prisma, {
      articleId: tengahId,
      authorName: `Balasan ${status}`,
      parentId: rootId,
      status,
      createdAt: commentDates.balasan,
    });
  }

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deleteJournalFixture(prisma, ids);
  await prisma.$disconnect();
});

describe('GET /v1/public/articles', () => {
  test('hanya artikel terbit; SCHEDULED yang sudah jatuh tempo ikut, yang belum tidak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?category=${slugs.categoryA}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(PUBLIC_GET_CACHE_CONTROL);
    // Urut `-publishedAt`; untuk terjadwal memakai `publishAt` (kontrak §5.3).
    expect(slugsOf(res)).toEqual([slugs.terjadwalLewat, slugs.tengah, slugs.lama]);
    expect(listOf(res).meta.total).toBe(3);
  });

  test('draf, Trash, dan terjadwal yang belum jatuh tempo tidak pernah muncul', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/articles?limit=48' });
    const visible = slugsOf(res);

    expect(visible).not.toContain(slugs.draf);
    expect(visible).not.toContain(slugs.trash);
    expect(visible).not.toContain(slugs.terjadwalDepan);
    expect(visible).toContain(slugs.terjadwalLewat);
  });

  test('filter tag, dan slug filter tak dikenal menjawab data kosong', async () => {
    const byTag = await app.inject({ method: 'GET', url: `/v1/public/articles?tag=${slugs.tag}` });
    expect(slugsOf(byTag)).toEqual([slugs.baru, slugs.lama]);

    for (const url of [
      `/v1/public/articles?category=tidak-ada-${s}`,
      `/v1/public/articles?tag=tidak-ada-${s}`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(listOf(res)).toEqual({ data: [], meta: { limit: 12, nextCursor: null, total: 0 } });
    }
  });

  test('pagination keyset: halaman kedua menyambung tanpa duplikat', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?category=${slugs.categoryA}&limit=2`,
    });
    const firstBody = listOf(first);
    expect(firstBody.data).toHaveLength(2);
    expect(firstBody.meta.total).toBe(3);
    expect(firstBody.meta.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?category=${slugs.categoryA}&limit=2&cursor=${encodeURIComponent(
        firstBody.meta.nextCursor ?? '',
      )}`,
    });
    const secondBody = listOf(second);
    expect(secondBody.meta.nextCursor).toBeNull();
    expect([...slugsOf(first), ...slugsOf(second)]).toEqual([
      slugs.terjadwalLewat,
      slugs.tengah,
      slugs.lama,
    ]);
  });

  test('kursor mengikat filter: dipakai dengan filter lain → 400 INVALID_CURSOR', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?category=${slugs.categoryA}&limit=1`,
    });
    const cursor = listOf(first).meta.nextCursor ?? '';

    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?limit=1&cursor=${encodeURIComponent(cursor)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('INVALID_CURSOR');
  });

  test('kartu memuat excerpt turunan dan tidak memuat field privat', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles?category=${slugs.categoryB}&limit=48`,
    });
    const card = listOf(res).data.find((item) => item.slug === slugs.tanpaExcerpt);

    expect(card?.excerpt).toBe('Kalimat pembuka yang menjadi excerpt turunan.');
    expect(card?.author).toEqual({ name: `Penulis ${s}` });
    expect(res.body).not.toContain('@ornament.id');
    expect(res.body).not.toContain('authorId');
    expect(res.body).not.toContain('publishAt');
    expect(res.body).not.toContain('wordCount');
  });
});

describe('GET /v1/public/articles/:slug', () => {
  test('detail memuat blok, tag, dan gambar unggulan', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/public/articles/${slugs.tengah}` });
    expect(res.statusCode).toBe(200);

    const detail = detailOf(res);
    expect(detail.slug).toBe(slugs.tengah);
    expect(detail.category.slug).toBe(slugs.categoryA);
    expect(detail.author).toEqual({ name: `Penulis ${s}` });
    expect(detail.commentCount).toBe(3);
    // Blok rusak dan blok bergambar `PRIVATE` dibuang; sisanya urut apa adanya.
    expect(detail.content.map((block) => block.type)).toEqual(['paragraph', 'heading2', 'quote']);
  });

  test('slug tak dikenal, draf, Trash, dan terjadwal belum jatuh tempo → 404', async () => {
    for (const slug of [`tidak-ada-${s}`, slugs.draf, slugs.trash, slugs.terjadwalDepan]) {
      const res = await app.inject({ method: 'GET', url: `/v1/public/articles/${slug}` });
      expect(res.statusCode).toBe(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
    }
  });

  test('artikel terjadwal yang sudah jatuh tempo bisa dibuka', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.terjadwalLewat}`,
    });
    expect(res.statusCode).toBe(200);
    expect(detailOf(res).publishedAt).toBe(dates.terjadwalLewat.toISOString());
  });
});

describe('GET /v1/public/articles/:slug/comments', () => {
  test('hanya APPROVED, urut naik, balasan bersarang satu tingkat', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.tengah}/comments`,
    });
    expect(res.statusCode).toBe(200);

    const body = commentsOf(res);
    expect(body.data.map((comment) => comment.authorName)).toEqual([
      'Komentator Pertama',
      'Komentator Kedua',
    ]);
    expect(body.meta).toEqual({ limit: 20, nextCursor: null, total: 2 });

    const [first, second] = body.data;
    expect(first?.replies.map((reply) => reply.authorName)).toEqual(['Tim Ornament']);
    expect(first?.replies[0]?.isStaffReply).toBe(true);
    expect(first?.isStaffReply).toBe(false);
    expect(second?.replies).toEqual([]);
  });

  test('PENDING/SPAM/DELETED dan kolom privat tidak pernah muncul', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.tengah}/comments?limit=48`,
    });

    for (const marker of [
      COMMENT_EMAIL_MARKER,
      COMMENT_IP_HASH_MARKER,
      COMMENT_USER_AGENT_MARKER,
    ]) {
      expect(res.body).not.toContain(marker);
    }
    for (const key of [
      'authorEmail',
      'ipHash',
      'userAgent',
      'authorUserId',
      'moderated',
      'status',
    ]) {
      expect(res.body).not.toContain(key);
    }
    for (const status of ['PENDING', 'SPAM', 'DELETED']) {
      expect(res.body).not.toContain(status);
    }
  });

  test('pagination keyset komentar', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.tengah}/comments?limit=1`,
    });
    const firstBody = commentsOf(first);
    expect(firstBody.data.map((c) => c.authorName)).toEqual(['Komentator Pertama']);
    expect(firstBody.meta.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/v1/public/articles/${slugs.tengah}/comments?limit=1&cursor=${encodeURIComponent(
        firstBody.meta.nextCursor ?? '',
      )}`,
    });
    const secondBody = commentsOf(second);
    expect(secondBody.data.map((c) => c.authorName)).toEqual(['Komentator Kedua']);
    expect(secondBody.meta.nextCursor).toBeNull();
  });

  test('komentar artikel yang tidak terbit → 404', async () => {
    for (const slug of [slugs.draf, slugs.terjadwalDepan, `tidak-ada-${s}`]) {
      const res = await app.inject({ method: 'GET', url: `/v1/public/articles/${slug}/comments` });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('GET /v1/public/article-categories', () => {
  test('hitungan hanya artikel terbit; kategori kosong disembunyikan', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/public/article-categories' });
    expect(res.statusCode).toBe(200);

    const data = res.json<{ data: PublicArticleCategory[] }>().data;
    const bySlug = new Map(data.map((category) => [category.slug, category]));
    // Kategori A: lama + tengah + terjadwalLewat (draf, Trash, terjadwal depan
    // tidak dihitung).
    expect(bySlug.get(slugs.categoryA)?.articleCount).toBe(3);
    expect(bySlug.get(slugs.categoryB)?.articleCount).toBe(2);
    expect(bySlug.has(slugs.categoryKosong)).toBe(false);
  });

  test('withEmpty=true menampilkan kategori tanpa artikel terbit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/public/article-categories?withEmpty=true',
    });
    const data = res.json<{ data: PublicArticleCategory[] }>().data;
    const kosong = data.find((category) => category.slug === slugs.categoryKosong);

    expect(kosong?.articleCount).toBe(0);
    expect(kosong?.position).toBe(2);
  });
});
