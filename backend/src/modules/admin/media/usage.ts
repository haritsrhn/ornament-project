/**
 * "Media ini dipakai di mana?" (kontrak §5.12).
 *
 * Dipakai dua kali dengan arti berbeda: sebagai `usages` di detail, supaya
 * admin bisa melepas rujukannya lebih dulu; dan sebagai penjaga `409 IN_USE`
 * saat menghapus. Keduanya harus melihat daftar yang sama persis — kalau
 * detail melewatkan satu pemakai, admin akan menghapus berkas yang masih
 * tampil di situs.
 *
 * `isPublished` memisahkan dua tingkat larangan (model §5): rujukan dari
 * konten **terbit** menghalangi pemindahan ke Trash, sedangkan rujukan apa pun
 * — termasuk dari draf — menghalangi hapus permanen, karena FK `Restrict` di
 * tabel join akan menolaknya.
 */

import { PUBLIC_ARTISAN_STATUSES, type MediaUsage } from '@ornament/shared';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';

/** Transaksi maupun klien penuh sama-sama diterima. */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

const publicArtisanStatuses: readonly string[] = PUBLIC_ARTISAN_STATUSES;

/**
 * Semua pemakaian untuk sekumpulan media sekaligus.
 *
 * Satu query per sumber, bukan satu per media: daftar Media Library memuat 40
 * baris per halaman, dan sepuluh query ber-`IN` jauh lebih murah daripada
 * 400 query berurutan.
 */
export async function collectMediaUsages(
  prisma: PrismaLike,
  mediaIds: readonly string[],
): Promise<Map<string, MediaUsage[]>> {
  const result = new Map<string, MediaUsage[]>();
  if (mediaIds.length === 0) return result;

  const ids = [...mediaIds];
  const wanted = new Set(ids);
  const push = (mediaId: string, usage: MediaUsage): void => {
    const list = result.get(mediaId);
    if (list === undefined) result.set(mediaId, [usage]);
    else list.push(usage);
  };

  const [
    productPrimary,
    productImages,
    artisanPhotos,
    artisanImages,
    artisanDocuments,
    articleFeatured,
    articleBlocks,
    pageBlocks,
    siteSettings,
    inquiryAttachments,
  ] = await Promise.all([
    prisma.product.findMany({
      where: { primaryImageId: { in: ids } },
      select: { id: true, name: true, primaryImageId: true, publishStatus: true, deletedAt: true },
    }),
    prisma.productImage.findMany({
      where: { mediaId: { in: ids } },
      select: {
        mediaId: true,
        product: { select: { id: true, name: true, publishStatus: true, deletedAt: true } },
      },
    }),
    prisma.artisan.findMany({
      where: { photoId: { in: ids } },
      select: { id: true, name: true, photoId: true, status: true, archivedAt: true },
    }),
    prisma.artisanImage.findMany({
      where: { mediaId: { in: ids } },
      select: {
        mediaId: true,
        artisan: { select: { id: true, name: true, status: true, archivedAt: true } },
      },
    }),
    prisma.artisanDocument.findMany({
      where: { mediaId: { in: ids } },
      select: { id: true, title: true, mediaId: true },
    }),
    prisma.article.findMany({
      where: { featuredImageId: { in: ids } },
      select: {
        id: true,
        title: true,
        featuredImageId: true,
        status: true,
        publishAt: true,
        deletedAt: true,
      },
    }),
    findArticlesUsingMediaInContent(prisma, ids),
    prisma.pageBlock.findMany({
      where: { imageId: { in: ids } },
      select: {
        id: true,
        name: true,
        imageId: true,
        page: { select: { status: true, deletedAt: true } },
      },
    }),
    prisma.siteSetting.findMany({
      where: { OR: [{ logoId: { in: ids } }, { iconId: { in: ids } }] },
      select: { id: true, logoId: true, iconId: true },
    }),
    prisma.inquiryAttachment.findMany({
      where: { mediaId: { in: ids } },
      select: { id: true, mediaId: true, inquiry: { select: { reference: true } } },
    }),
  ]);

  const now = new Date();

  for (const row of productPrimary) {
    if (row.primaryImageId === null) continue;
    push(row.primaryImageId, {
      entityType: 'Product',
      entityId: row.id,
      label: row.name,
      field: 'primaryImageId',
      isPublished: row.deletedAt === null && row.publishStatus === 'PUBLISHED',
    });
  }

  for (const row of productImages) {
    push(row.mediaId, {
      entityType: 'ProductImage',
      entityId: row.product.id,
      label: row.product.name,
      field: 'images',
      isPublished: row.product.deletedAt === null && row.product.publishStatus === 'PUBLISHED',
    });
  }

  for (const row of artisanPhotos) {
    if (row.photoId === null) continue;
    push(row.photoId, {
      entityType: 'Artisan',
      entityId: row.id,
      label: row.name,
      field: 'photoId',
      isPublished: isArtisanPublic(row),
    });
  }

  for (const row of artisanImages) {
    push(row.mediaId, {
      entityType: 'ArtisanImage',
      entityId: row.artisan.id,
      label: row.artisan.name,
      field: 'images',
      isPublished: isArtisanPublic(row.artisan),
    });
  }

  for (const row of artisanDocuments) {
    // Dokumen 🔒 tidak pernah tampil publik, tapi rujukannya tetap mengunci
    // media (FK `Restrict`), jadi ia muncul dengan `isPublished` false.
    push(row.mediaId, {
      entityType: 'ArtisanDocument',
      entityId: row.id,
      label: row.title,
      field: 'mediaId',
      isPublished: false,
    });
  }

  for (const row of articleFeatured) {
    if (row.featuredImageId === null) continue;
    push(row.featuredImageId, {
      entityType: 'Article',
      entityId: row.id,
      label: row.title,
      field: 'featuredImageId',
      isPublished: isArticleLive(row, now),
    });
  }

  for (const row of articleBlocks) {
    push(row.mediaId, {
      entityType: 'Article',
      entityId: row.id,
      label: row.title,
      field: 'content',
      isPublished: isArticleLive(row, now),
    });
  }

  for (const row of pageBlocks) {
    if (row.imageId === null) continue;
    push(row.imageId, {
      entityType: 'PageBlock',
      entityId: row.id,
      label: row.name,
      field: 'imageId',
      // Blok global (`pageId` null) selalu ikut dirender, jadi ia terbit
      // selama tidak menempel di halaman yang masih draf atau di Trash.
      isPublished:
        row.page === null || (row.page.deletedAt === null && row.page.status === 'PUBLISHED'),
    });
  }

  for (const row of siteSettings) {
    // Pengaturan situs selalu tayang: tidak ada status draf untuk logo.
    if (row.logoId !== null && wanted.has(row.logoId)) {
      push(row.logoId, {
        entityType: 'SiteSetting',
        entityId: String(row.id),
        label: 'Pengaturan situs',
        field: 'logoId',
        isPublished: true,
      });
    }
    if (row.iconId !== null && wanted.has(row.iconId)) {
      push(row.iconId, {
        entityType: 'SiteSetting',
        entityId: String(row.id),
        label: 'Pengaturan situs',
        field: 'iconId',
        isPublished: true,
      });
    }
  }

  for (const row of inquiryAttachments) {
    push(row.mediaId, {
      entityType: 'InquiryAttachment',
      entityId: row.id,
      label: row.inquiry.reference,
      field: 'mediaId',
      isPublished: false,
    });
  }

  return result;
}

function isArtisanPublic(row: { status: string; archivedAt: Date | null }): boolean {
  return row.archivedAt === null && publicArtisanStatuses.includes(row.status);
}

/** ADR K8: `SCHEDULED` yang jadwalnya sudah lewat sudah tayang, sama seperti query publik. */
function isArticleLive(
  row: { status: string; publishAt: Date | null; deletedAt: Date | null },
  now: Date,
): boolean {
  if (row.deletedAt !== null) return false;
  if (row.status === 'PUBLISHED') return true;
  return row.status === 'SCHEDULED' && row.publishAt !== null && row.publishAt <= now;
}

interface ArticleContentUsageRow {
  id: string;
  title: string;
  status: string;
  publishAt: Date | null;
  deletedAt: Date | null;
  mediaId: string;
}

/**
 * Blok gambar di dalam `Article.content` (model §3.6). Rujukan ini tidak punya
 * kolom FK, jadi ia dicari lewat containment `jsonb`: `content @> [{"mediaId": …}]`
 * benar bila **ada** elemen array yang memuat pasangan itu. Tanpa query ini,
 * menghapus media yang dipakai di tengah artikel terbit akan lolos diam-diam.
 */
async function findArticlesUsingMediaInContent(
  prisma: PrismaLike,
  ids: readonly string[],
): Promise<ArticleContentUsageRow[]> {
  const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
  return prisma.$queryRaw<ArticleContentUsageRow[]>(Prisma.sql`
    SELECT a."id", a."title", a."status"::text AS "status", a."publish_at" AS "publishAt",
           a."deleted_at" AS "deletedAt", m."id"::text AS "mediaId"
    FROM "media" m
    JOIN "article" a
      ON a."content" @> jsonb_build_array(jsonb_build_object('mediaId', m."id"::text))
    WHERE m."id" IN (${idList})
  `);
}
