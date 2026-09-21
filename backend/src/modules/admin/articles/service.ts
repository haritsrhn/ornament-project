/**
 * Aturan tulis artikel admin — model domain §6.1 (slug), §6.4 (Trash), §6.6
 * (publikasi terjadwal & syarat publish), §6.10 (redirect slug); kontrak §5.9.
 *
 * Semua yang menyentuh lebih dari satu tabel berjalan dalam **satu transaksi**:
 * artikel + tag + `SlugRedirect` + `ActivityLog`. Artikel tidak punya snapshot
 * revisi seperti produk (model §3.6 tidak memodelkannya), jadi penjaga edit
 * bersamaannya adalah `expectedUpdatedAt` (§1.9), bukan nomor revisi.
 */

import {
  countArticleWords,
  ARTICLE_BUSINESS_RULES,
  PUBLISH_REQUIREMENT_CODES,
  type ArticleBlock,
  type ArticleInput,
  type UpdateArticleBody,
} from '@ornament/shared';

import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, businessRuleViolation, conflict, notFound } from '../../../lib/errors.js';
import { assertUpdatedAtMatches } from '../../../lib/edit-conflict.js';
import { isUniqueViolation, uniqueConflictFields } from '../../../lib/prisma-error.js';
import { slugify, uniqueSlug } from '../../../lib/slug.js';
import { parseArticleBlocks } from '../../public/articles/dto.js';
import { recordSlugRedirect, releaseSlugRedirect } from '../slug-redirect.js';
import { resolveTagIds } from '../tags.js';

export type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  name: string;
}

// ── Validasi referensi (kontrak §5.9: `422 BUSINESS_RULE_VIOLATION`) ─────────

async function assertCategoryExists(tx: Tx, categoryId: string): Promise<void> {
  const category = await tx.articleCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (category === null) {
    throw businessRuleViolation(
      ARTICLE_BUSINESS_RULES.CATEGORY_NOT_FOUND,
      'Kategori artikel yang dipilih tidak ditemukan.',
    );
  }
}

async function assertAuthorExists(tx: Tx, authorId: string): Promise<void> {
  const author = await tx.user.findUnique({ where: { id: authorId }, select: { id: true } });
  if (author === null) throw notFound('Penulis tidak ditemukan.');
}

/**
 * Gambar unggulan dan blok gambar tampil di journal publik, jadi medianya wajib
 * `PUBLIC` dan hidup — lapisan yang sama dengan produk & pengrajin, supaya
 * dokumen 🔒 tidak pernah bisa dipasang sebagai ilustrasi artikel.
 */
async function assertUsableMedia(tx: Tx, mediaIds: readonly string[]): Promise<void> {
  const unique = [...new Set(mediaIds)];
  if (unique.length === 0) return;

  const rows = await tx.media.findMany({
    where: { id: { in: unique } },
    select: { id: true, visibility: true, deletedAt: true },
  });
  if (rows.length !== unique.length) {
    throw businessRuleViolation(
      ARTICLE_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih tidak ditemukan.',
    );
  }
  if (rows.some((row) => row.visibility !== 'PUBLIC')) {
    throw businessRuleViolation(
      ARTICLE_BUSINESS_RULES.PRIVATE_MEDIA_NOT_ALLOWED,
      'Media privat tidak boleh dipakai pada artikel publik.',
    );
  }
  if (rows.some((row) => row.deletedAt !== null)) {
    throw businessRuleViolation(
      ARTICLE_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih sudah berada di Trash.',
    );
  }
}

/** `mediaId` yang dirujuk blok gambar (model §3.6). */
function contentMediaIds(blocks: readonly ArticleBlock[]): string[] {
  return blocks.filter((block) => block.type === 'image').map((block) => block.mediaId);
}

// ── Slug (model §6.1, §6.10) ─────────────────────────────────────────────────

async function slugTaken(tx: Tx, slug: string, exceptId?: string): Promise<boolean> {
  const row = await tx.article.findUnique({ where: { slug }, select: { id: true } });
  return row !== null && row.id !== exceptId;
}

async function resolveArticleSlug(
  tx: Tx,
  input: { requested?: string | undefined; title: string },
  exceptId?: string,
): Promise<string> {
  if (input.requested !== undefined) {
    if (await slugTaken(tx, input.requested, exceptId)) throw conflict(['slug']);
    return input.requested;
  }
  return uniqueSlug(slugify(input.title), (candidate) => slugTaken(tx, candidate, exceptId));
}

function asConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict(uniqueConflictFields(error, ['slug']));
  throw error;
}

// ── ActivityLog (model §6.9: transaksi yang sama) ────────────────────────────

export async function logArticleActivity(
  tx: Tx,
  actorId: string | null,
  action: string,
  message: string,
  articleId: string,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      kind: 'ARTICLE',
      action,
      message,
      actorId,
      entityType: 'Article',
      entityId: articleId,
    },
    select: { id: true },
  });
}

// ── Syarat publish (model §6.6) ──────────────────────────────────────────────

export interface PublishIssue {
  path: string;
  code: string;
}

export const publishRequirementsNotMet = (issues: PublishIssue[]): AppError =>
  new AppError(
    'PUBLISH_REQUIREMENTS_NOT_MET',
    'Artikel belum memenuhi syarat terbit. Lengkapi bagian yang kurang.',
    { details: issues },
  );

/**
 * Syarat jadwal/publish §6.6: `title`, `categoryId`, `content` tidak kosong,
 * dan **alt pada gambar**.
 *
 * Alt dicek pada gambar unggulan *dan* setiap blok gambar, karena keduanya
 * dirender di halaman publik. Path blok ditulis per indeks
 * (`content[2].mediaId`) supaya editor admin bisa menyorot blok yang salah,
 * bukan hanya memberi tahu "ada gambar tanpa alt".
 */
export async function articlePublishIssues(tx: Tx, articleId: string): Promise<PublishIssue[]> {
  const row = await tx.article.findUniqueOrThrow({
    where: { id: articleId },
    select: {
      title: true,
      categoryId: true,
      content: true,
      featuredImageId: true,
      featuredImage: { select: { alt: true } },
    },
  });

  const issues: PublishIssue[] = [];
  if (row.title.trim() === '') {
    issues.push({ path: 'title', code: PUBLISH_REQUIREMENT_CODES.REQUIRED });
  }
  if (row.categoryId === null) {
    issues.push({ path: 'categoryId', code: PUBLISH_REQUIREMENT_CODES.REQUIRED });
  }

  const { blocks } = parseArticleBlocks(row.content);
  if (blocks.length === 0) {
    issues.push({ path: 'content', code: PUBLISH_REQUIREMENT_CODES.REQUIRED });
  }
  if (row.featuredImage !== null && (row.featuredImage.alt ?? '').trim() === '') {
    issues.push({ path: 'featuredImageId', code: PUBLISH_REQUIREMENT_CODES.ALT_REQUIRED });
  }

  const mediaIds = contentMediaIds(blocks);
  if (mediaIds.length > 0) {
    const media = await tx.media.findMany({
      where: { id: { in: [...new Set(mediaIds)] } },
      select: { id: true, alt: true },
    });
    const altById = new Map(media.map((item) => [item.id, item.alt]));
    blocks.forEach((block, index) => {
      if (block.type !== 'image') return;
      const alt = altById.has(block.mediaId) ? (altById.get(block.mediaId) ?? '') : undefined;
      if (alt === undefined) {
        issues.push({
          path: `content[${String(index)}].mediaId`,
          code: PUBLISH_REQUIREMENT_CODES.REQUIRED,
        });
        return;
      }
      if (alt.trim() === '') {
        issues.push({
          path: `content[${String(index)}].mediaId`,
          code: PUBLISH_REQUIREMENT_CODES.ALT_REQUIRED,
        });
      }
    });
  }
  return issues;
}

export async function assertPublishable(tx: Tx, articleId: string): Promise<void> {
  const issues = await articlePublishIssues(tx, articleId);
  if (issues.length > 0) throw publishRequirementsNotMet(issues);
}

export const invalidState = (message: string, current: string, allowed: string[]): AppError =>
  new AppError('INVALID_STATE', message, { details: { current, allowed } });

// ── Menyusun data tulis ──────────────────────────────────────────────────────

/** Isi yang dikirim klien; `undefined` = tidak diubah (kontrak §1.3). */
function contentData(content: ArticleBlock[] | undefined): {
  content?: Prisma.InputJsonValue;
  wordCount?: number;
} {
  if (content === undefined) return {};
  return {
    content,
    // `wordCount` diturunkan saat simpan (model §3.6); klien tidak pernah
    // boleh mengirimnya (kontrak §1.3 "field turunan read-only").
    wordCount: countArticleWords(content),
  };
}

async function syncTags(tx: Tx, articleId: string, tags: string[] | undefined): Promise<void> {
  if (tags === undefined) return;
  const tagIds = await resolveTagIds(tx, tags);
  await tx.articleTag.deleteMany({ where: { articleId } });
  if (tagIds.length === 0) return;
  await tx.articleTag.createMany({ data: tagIds.map((tagId) => ({ articleId, tagId })) });
}

/** Referensi media yang ikut request (gambar unggulan + blok gambar). */
async function assertInputMediaUsable(
  tx: Tx,
  input: { featuredImageId?: string | null | undefined; content?: ArticleBlock[] | undefined },
): Promise<void> {
  const ids: string[] = [];
  if (input.featuredImageId !== undefined && input.featuredImageId !== null) {
    ids.push(input.featuredImageId);
  }
  if (input.content !== undefined) ids.push(...contentMediaIds(input.content));
  await assertUsableMedia(tx, ids);
}

// ── Create (kontrak §5.9; juga "Draf cepat" Q1) ──────────────────────────────

export async function createArticle(
  prisma: PrismaClient,
  options: { actor: Actor; input: ArticleInput },
): Promise<string> {
  const { actor, input } = options;
  return prisma
    .$transaction(async (tx) => {
      if (input.categoryId !== undefined && input.categoryId !== null) {
        await assertCategoryExists(tx, input.categoryId);
      }
      if (input.authorId !== undefined) await assertAuthorExists(tx, input.authorId);
      await assertInputMediaUsable(tx, input);

      const slug = await resolveArticleSlug(tx, { requested: input.slug, title: input.title });
      const content = input.content ?? [];

      const created = await tx.article.create({
        data: {
          title: input.title,
          slug,
          excerpt: input.excerpt ?? null,
          content,
          wordCount: countArticleWords(content),
          categoryId: input.categoryId ?? null,
          // Penulis default = diri sendiri (kontrak §5.9); Editor+ boleh
          // menulis atas nama orang lain lewat `authorId`.
          authorId: input.authorId ?? actor.id,
          featuredImageId: input.featuredImageId ?? null,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      await syncTags(tx, created.id, input.tags);
      // Slug baru mungkin tercatat sebagai redirect lama milik artikel lain:
      // slug aktif selalu menang (§6.10).
      await releaseSlugRedirect(tx, 'ARTICLE', slug);
      await logArticleActivity(
        tx,
        actor.id,
        'article.created',
        `Artikel "${input.title}" dibuat sebagai draf`,
        created.id,
      );
      return created.id;
    })
    .catch(asConflict);
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string; body: UpdateArticleBody },
): Promise<void> {
  const { actor, articleId, body } = options;
  const { expectedUpdatedAt, slug: requestedSlug, ...input } = body;

  await prisma
    .$transaction(async (tx) => {
      const current = await tx.article.findUniqueOrThrow({
        where: { id: articleId },
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          updatedAt: true,
          deletedAt: true,
          author: { select: { id: true, name: true } },
        },
      });

      if (current.deletedAt !== null) {
        throw invalidState('Artikel di Trash tidak dapat diubah.', 'TRASHED', [
          'DRAFT',
          'SCHEDULED',
          'PUBLISHED',
        ]);
      }
      assertUpdatedAtMatches(
        { updatedAt: current.updatedAt, updatedBy: current.author },
        expectedUpdatedAt,
        'Artikel sudah diubah orang lain. Muat ulang sebelum menyimpan.',
      );

      if (input.categoryId !== undefined && input.categoryId !== null) {
        await assertCategoryExists(tx, input.categoryId);
      }
      if (input.authorId !== undefined) await assertAuthorExists(tx, input.authorId);
      await assertInputMediaUsable(tx, input);

      const nextSlug =
        requestedSlug === undefined
          ? current.slug
          : await resolveArticleSlug(
              tx,
              { requested: requestedSlug, title: current.title },
              articleId,
            );

      await tx.article.update({
        where: { id: articleId },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          slug: nextSlug,
          ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
          ...contentData(input.content),
          ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
          ...(input.authorId === undefined ? {} : { authorId: input.authorId }),
          ...(input.featuredImageId === undefined
            ? {}
            : { featuredImageId: input.featuredImageId }),
        },
        select: { id: true },
      });
      if (nextSlug !== current.slug) {
        await recordSlugRedirect(tx, 'ARTICLE', articleId, current.slug, nextSlug);
      }
      await syncTags(tx, articleId, input.tags);

      // Artikel yang sedang tayang (atau sudah dijadwalkan) tidak boleh
      // diturunkan menjadi tidak layak tayang lewat pintu belakang `PATCH`
      // (kontrak §5.9, mis. `categoryId: null`).
      if (current.status !== 'DRAFT') await assertPublishable(tx, articleId);

      await logArticleActivity(
        tx,
        actor.id,
        'article.updated',
        `Artikel "${input.title ?? current.title}" disimpan`,
        articleId,
      );
    })
    .catch(asConflict);
}

// ── Publikasi & jadwal (model §6.6, ADR K8) ──────────────────────────────────

export async function publishArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string; publishAt: string | null | undefined },
): Promise<void> {
  const { actor, articleId, publishAt } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { title: true, status: true, publishedAt: true, deletedAt: true },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Artikel di Trash tidak dapat diterbitkan.', 'TRASHED', ['DRAFT']);
    }
    await assertPublishable(tx, articleId);

    const now = new Date();
    const requested = publishAt === undefined || publishAt === null ? null : new Date(publishAt);
    if (requested !== null && requested.getTime() <= now.getTime()) {
      throw businessRuleViolation(
        ARTICLE_BUSINESS_RULES.PUBLISH_AT_IN_PAST,
        'Waktu tayang harus di masa depan. Kosongkan untuk terbit sekarang.',
      );
    }

    if (requested === null) {
      await tx.article.update({
        where: { id: articleId },
        data: {
          status: 'PUBLISHED',
          publishAt: null,
          // Diisi saat **pertama kali** terbit; publikasi ulang tidak
          // memundurkan urutan journal publik (`-publishedAt`).
          ...(current.publishedAt === null ? { publishedAt: now } : {}),
        },
        select: { id: true },
      });
      await logArticleActivity(
        tx,
        actor.id,
        'article.published',
        `Artikel "${current.title}" diterbitkan`,
        articleId,
      );
      return;
    }

    await tx.article.update({
      where: { id: articleId },
      // `publishedAt` sengaja **tidak** diisi: sampai job §6.6 menjalankannya,
      // tanggal tayang artikel terjadwal hidup di `publishAt` (lihat
      // `effectivePublishedAt()` di query publik).
      data: { status: 'SCHEDULED', publishAt: requested },
      select: { id: true },
    });
    await logArticleActivity(
      tx,
      actor.id,
      'article.scheduled',
      `Artikel "${current.title}" dijadwalkan terbit ${requested.toISOString()}`,
      articleId,
    );
  });
}

export async function unpublishArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string },
): Promise<void> {
  const { actor, articleId } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { title: true, status: true, deletedAt: true },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Artikel di Trash tidak dapat diubah.', 'TRASHED', [
        'PUBLISHED',
        'SCHEDULED',
      ]);
    }
    if (current.status === 'DRAFT') {
      throw invalidState('Artikel ini sudah berstatus draf.', current.status, [
        'PUBLISHED',
        'SCHEDULED',
      ]);
    }

    await tx.article.update({
      where: { id: articleId },
      // `publishedAt` dipertahankan (§6.4): ia jejak kapan artikel pernah
      // tayang, bukan penanda status sekarang.
      data: { status: 'DRAFT', publishAt: null },
      select: { id: true },
    });
    await logArticleActivity(
      tx,
      actor.id,
      'article.unpublished',
      `Artikel "${current.title}" ditarik menjadi draf`,
      articleId,
    );
  });
}

// ── Trash, restore, purge (model §6.4) ───────────────────────────────────────

export async function trashArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string },
): Promise<{ id: string; deletedAt: Date }> {
  const { actor, articleId } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { title: true, status: true, deletedAt: true },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Artikel ini sudah berada di Trash.', 'TRASHED', [
        'DRAFT',
        'SCHEDULED',
        'PUBLISHED',
      ]);
    }

    const updated = await tx.article.update({
      where: { id: articleId },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true },
    });
    await logArticleActivity(
      tx,
      actor.id,
      'article.trashed',
      `Artikel "${current.title}" dipindahkan ke Trash`,
      articleId,
    );
    /* c8 ignore next */
    if (updated.deletedAt === null) throw new Error('deletedAt tidak terisi setelah trash');
    return { id: updated.id, deletedAt: updated.deletedAt };
  });
}

export async function restoreArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string },
): Promise<void> {
  const { actor, articleId } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { title: true, slug: true, status: true, deletedAt: true },
    });
    if (current.deletedAt === null) {
      throw invalidState('Artikel ini tidak berada di Trash.', current.status, ['TRASHED']);
    }

    await tx.article.update({
      where: { id: articleId },
      // **Selalu** kembali ke DRAFT dengan `publishAt` kosong (Q3/§6.4):
      // artikel terjadwal yang dipulihkan tidak boleh tiba-tiba tayang karena
      // jadwal lamanya sudah lewat. Inilah alasan Contributor boleh memulihkan
      // miliknya sendiri tanpa izin terbit.
      data: { deletedAt: null, status: 'DRAFT', publishAt: null },
      select: { id: true },
    });
    await releaseSlugRedirect(tx, 'ARTICLE', current.slug);
    await logArticleActivity(
      tx,
      actor.id,
      'article.restored',
      `Artikel "${current.title}" dipulihkan sebagai draf`,
      articleId,
    );
  });
}

export async function purgeArticle(
  prisma: PrismaClient,
  options: { actor: Actor; articleId: string },
): Promise<void> {
  const { actor, articleId } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.article.findUniqueOrThrow({
      where: { id: articleId },
      select: { title: true, status: true, deletedAt: true },
    });
    if (current.deletedAt === null) {
      throw invalidState('Hanya artikel di Trash yang bisa dihapus permanen.', current.status, [
        'TRASHED',
      ]);
    }

    // Log ditulis **sebelum** barisnya hilang (relasi polimorfik tanpa FK,
    // §3.8), supaya jejak penghapusan tidak ikut terhapus.
    await logArticleActivity(
      tx,
      actor.id,
      'article.purged',
      `Artikel "${current.title}" dihapus permanen`,
      articleId,
    );
    // Komentar dan `SlugRedirect` ikut terhapus (Cascade, §6.4).
    await tx.article.delete({ where: { id: articleId }, select: { id: true } });
  });
}
