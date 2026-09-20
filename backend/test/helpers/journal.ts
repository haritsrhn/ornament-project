import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Fixture journal (artikel, komentar) dan situs (halaman, blok, menu, redirect)
 * untuk tes `/v1/public/*`.
 *
 * Seperti `helpers/catalog.ts`: semua slug/path diberi sufiks acak oleh
 * pemanggil, dan `deleteJournalFixture()` hanya menghapus baris yang dibuatnya
 * sendiri — tidak ada assertion yang boleh bergantung pada isi seed dev.
 *
 * Kolom privat (`comment.authorEmail`, `ipHash`, `userAgent`) sengaja **diisi
 * nilai penanda** supaya tes bisa membuktikan ia tidak pernah muncul di respons
 * publik (kontrak §4).
 */

export interface JournalFixtureIds {
  userIds: string[];
  mediaIds: string[];
  articleCategoryIds: string[];
  articleIds: string[];
  tagIds: string[];
  pageIds: string[];
  blockIds: string[];
  navItemIds: string[];
  redirectIds: string[];
}

export function emptyJournalIds(): JournalFixtureIds {
  return {
    userIds: [],
    mediaIds: [],
    articleCategoryIds: [],
    articleIds: [],
    tagIds: [],
    pageIds: [],
    blockIds: [],
    navItemIds: [],
    redirectIds: [],
  };
}

// ── Media ────────────────────────────────────────────────────────────────────

export async function createMedia(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: { key: string; visibility?: 'PUBLIC' | 'PRIVATE'; alt?: string | null },
): Promise<string> {
  const media = await prisma.media.create({
    data: {
      key: input.key,
      visibility: input.visibility ?? 'PUBLIC',
      kind: 'IMAGE',
      fileName: `${input.key}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 1024n,
      width: 1600,
      height: 900,
      alt: input.alt === undefined ? 'Alt gambar' : input.alt,
    },
    select: { id: true },
  });
  ids.mediaIds.push(media.id);
  return media.id;
}

// ── Artikel ──────────────────────────────────────────────────────────────────

export async function createArticleCategory(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: { slug: string; name?: string; position?: number; description?: string | null },
): Promise<string> {
  const category = await prisma.articleCategory.create({
    data: {
      slug: input.slug,
      name: input.name ?? input.slug,
      position: input.position ?? 0,
      description: input.description ?? null,
    },
    select: { id: true },
  });
  ids.articleCategoryIds.push(category.id);
  return category.id;
}

export async function createArticleTag(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  slug: string,
): Promise<string> {
  const tag = await prisma.tag.create({ data: { slug, name: slug }, select: { id: true } });
  ids.tagIds.push(tag.id);
  return tag.id;
}

export interface CreateArticleInput {
  slug: string;
  title?: string;
  authorId: string;
  categoryId?: string | null;
  status?: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED';
  publishedAt?: Date | null;
  publishAt?: Date | null;
  trashed?: boolean;
  excerpt?: string | null;
  content?: Prisma.InputJsonValue;
  tagIds?: string[];
  featuredImageId?: string | null;
}

/** Satu blok paragraf sederhana; cukup untuk menurunkan `excerpt`. */
export function paragraph(id: string, text: string): Prisma.InputJsonValue {
  return { id, type: 'paragraph', text: [{ text }] };
}

export async function createArticle(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: CreateArticleInput,
): Promise<string> {
  const status = input.status ?? 'PUBLISHED';
  const article = await prisma.article.create({
    data: {
      slug: input.slug,
      title: input.title ?? input.slug,
      excerpt: input.excerpt === undefined ? 'Ringkasan kartu artikel.' : input.excerpt,
      content: input.content ?? [paragraph('p1', 'Paragraf pertama artikel.')],
      wordCount: 4,
      categoryId: input.categoryId ?? null,
      authorId: input.authorId,
      featuredImageId: input.featuredImageId ?? null,
      status,
      publishAt: input.publishAt ?? null,
      publishedAt: input.publishedAt ?? (status === 'PUBLISHED' ? new Date() : null),
      deletedAt: input.trashed === true ? new Date() : null,
      tags: { create: (input.tagIds ?? []).map((tagId) => ({ tagId })) },
    },
    select: { id: true },
  });
  ids.articleIds.push(article.id);
  return article.id;
}

// ── Komentar ─────────────────────────────────────────────────────────────────

/** Nilai penanda kolom privat; tes memastikan tidak satu pun muncul di respons. */
export const COMMENT_EMAIL_MARKER = 'rahasia-email-komentar@contoh.invalid';
export const COMMENT_IP_HASH_MARKER = 'rahasia-ip-hash-komentar';
export const COMMENT_USER_AGENT_MARKER = 'RahasiaUserAgent/1.0';

export interface CreateCommentInput {
  articleId: string;
  authorName: string;
  body?: string;
  status?: 'PENDING' | 'APPROVED' | 'SPAM' | 'DELETED';
  createdAt?: Date;
  parentId?: string | null;
  /** Terisi = balasan admin (`isStaffReply: true`). */
  authorUserId?: string | null;
}

export async function createComment(
  prisma: PrismaClient,
  input: CreateCommentInput,
): Promise<string> {
  const comment = await prisma.comment.create({
    data: {
      articleId: input.articleId,
      parentId: input.parentId ?? null,
      authorName: input.authorName,
      authorEmail: COMMENT_EMAIL_MARKER,
      authorUserId: input.authorUserId ?? null,
      body: input.body ?? `Komentar dari ${input.authorName}.`,
      status: input.status ?? 'APPROVED',
      ipHash: COMMENT_IP_HASH_MARKER,
      userAgent: COMMENT_USER_AGENT_MARKER,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    },
    select: { id: true },
  });
  return comment.id;
}

// ── Halaman, blok, menu, redirect ────────────────────────────────────────────

export async function createPage(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: {
    path: string;
    title?: string;
    status?: 'DRAFT' | 'PUBLISHED';
    trashed?: boolean;
    metaTitle?: string | null;
    metaDescription?: string | null;
  },
): Promise<string> {
  const page = await prisma.page.create({
    data: {
      path: input.path,
      title: input.title ?? input.path,
      status: input.status ?? 'PUBLISHED',
      metaTitle: input.metaTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      deletedAt: input.trashed === true ? new Date() : null,
    },
    select: { id: true },
  });
  ids.pageIds.push(page.id);
  return page.id;
}

export interface CreateBlockInput {
  /** `null` ⇔ `visibility: 'GLOBAL'` (CHECK `page_block_global_check`). */
  pageId: string | null;
  visibility: 'ACTIVE' | 'GLOBAL' | 'HIDDEN';
  position: number;
  type?: 'HERO' | 'STORY' | 'PRODUCT_PREVIEW' | 'PROCESS' | 'TERMS' | 'FOOTER' | 'TESTIMONIAL';
  title?: string | null;
  body?: string | null;
  cta1?: { label: string; url: string } | null;
  imageId?: string | null;
  config?: Prisma.InputJsonValue;
}

export async function createBlock(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: CreateBlockInput,
): Promise<string> {
  const block = await prisma.pageBlock.create({
    data: {
      pageId: input.pageId,
      type: input.type ?? 'HERO',
      name: `Blok ${String(input.position)}`,
      visibility: input.visibility,
      position: input.position,
      layout: 'LEFT',
      title: input.title ?? null,
      body: input.body ?? null,
      cta1Label: input.cta1?.label ?? null,
      cta1Url: input.cta1?.url ?? null,
      imageId: input.imageId ?? null,
      config: input.config ?? Prisma.DbNull,
    },
    select: { id: true },
  });
  ids.blockIds.push(block.id);
  return block.id;
}

export async function createNavItem(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: {
    label: string;
    type: 'PAGE' | 'CATEGORY' | 'ARTICLE_ARCHIVE' | 'CUSTOM_LINK';
    position: number;
    pageId?: string | null;
    categoryId?: string | null;
    url?: string | null;
    style?: 'LINK' | 'BUTTON';
  },
): Promise<string> {
  const item = await prisma.navItem.create({
    data: {
      label: input.label,
      type: input.type,
      pageId: input.pageId ?? null,
      categoryId: input.categoryId ?? null,
      url: input.url ?? null,
      style: input.style ?? 'LINK',
      position: input.position,
    },
    select: { id: true },
  });
  ids.navItemIds.push(item.id);
  return item.id;
}

export async function createSlugRedirect(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
  input: {
    type: 'PRODUCT' | 'ARTICLE';
    fromSlug: string;
    productId?: string | null;
    articleId?: string | null;
  },
): Promise<string> {
  const redirect = await prisma.slugRedirect.create({
    data: {
      type: input.type,
      fromSlug: input.fromSlug,
      productId: input.productId ?? null,
      articleId: input.articleId ?? null,
    },
    select: { id: true },
  });
  ids.redirectIds.push(redirect.id);
  return redirect.id;
}

/** Menghapus fixture; komentar, tag artikel, dan blok ikut lewat `Cascade`. */
export async function deleteJournalFixture(
  prisma: PrismaClient,
  ids: JournalFixtureIds,
): Promise<void> {
  const del = async (
    list: string[],
    remove: (idList: string[]) => Promise<unknown>,
  ): Promise<void> => {
    if (list.length > 0) await remove(list);
  };

  await del(ids.redirectIds, (list) =>
    prisma.slugRedirect.deleteMany({ where: { id: { in: list } } }),
  );
  await del(ids.navItemIds, (list) => prisma.navItem.deleteMany({ where: { id: { in: list } } }));
  await del(ids.blockIds, (list) => prisma.pageBlock.deleteMany({ where: { id: { in: list } } }));
  await del(ids.pageIds, (list) => prisma.page.deleteMany({ where: { id: { in: list } } }));
  await del(ids.articleIds, (list) => prisma.article.deleteMany({ where: { id: { in: list } } }));
  await del(ids.articleCategoryIds, (list) =>
    prisma.articleCategory.deleteMany({ where: { id: { in: list } } }),
  );
  await del(ids.tagIds, (list) => prisma.tag.deleteMany({ where: { id: { in: list } } }));
  await del(ids.mediaIds, (list) => prisma.media.deleteMany({ where: { id: { in: list } } }));
  await del(ids.userIds, (list) => prisma.user.deleteMany({ where: { id: { in: list } } }));
}
