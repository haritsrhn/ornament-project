/**
 * Aturan tulis pengrajin admin — model domain §6.1 (slug), §6.7 (arsip),
 * kontrak §5.8.
 *
 * Seperti modul produk, setiap aksi yang menyentuh lebih dari satu tabel
 * (pengrajin + galeri + `ActivityLog`) berjalan dalam **satu transaksi**.
 *
 * Dua hal yang sengaja **tidak** ada di sini:
 * - **`SlugRedirect`**: model §6.10 membatasinya pada `Product` dan `Article`;
 *   pengrajin belum termasuk, jadi mengubah slug pengrajin tidak menulis
 *   redirect apa pun. Menambahkannya diam-diam akan membuat `/public/redirects`
 *   mengembalikan tipe yang tidak dikenal kontrak.
 * - **Hapus pengrajin**: tidak tersedia (model D3) — yang ada hanya arsip.
 */

import {
  ARTISAN_BUSINESS_RULES,
  type ArtisanInput,
  type ArtisanStatus,
  type UpdateArtisanBody,
} from '@ornament/shared';

import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, businessRuleViolation, conflict, notFound } from '../../../lib/errors.js';
import { assertUpdatedAtMatches } from '../../../lib/edit-conflict.js';
import { isUniqueViolation, uniqueConflictFields } from '../../../lib/prisma-error.js';
import { slugify, uniqueSlug } from '../../../lib/slug.js';
import { publishedProductWhere } from '../../public/products/query.js';
import { adminArtisanSelect, type AdminArtisanData } from './dto.js';

export type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  name: string;
}

/** Baris yang diambil ulang setelah menulis; bentuknya sama dengan `GET /:id`. */
export interface ArtisanResult {
  row: AdminArtisanData;
  publishedProductCount: number;
}

export async function loadArtisanResult(
  client: Tx | PrismaClient,
  artisanId: string,
): Promise<ArtisanResult> {
  const [row, publishedProductCount] = await Promise.all([
    client.artisan.findUnique({ where: { id: artisanId }, select: adminArtisanSelect }),
    client.product.count({ where: { artisanId, ...publishedProductWhere } }),
  ]);
  if (row === null) throw notFound('Pengrajin tidak ditemukan.');
  return { row: row as unknown as AdminArtisanData, publishedProductCount };
}

// ── Validasi referensi ───────────────────────────────────────────────────────

/**
 * Foto utama & galeri pengrajin tampil di `/v1/public/*`, jadi medianya wajib
 * `PUBLIC` dan hidup. Dicek di sini — bukan hanya saat render — supaya dokumen
 * 🔒 tidak pernah bisa "dipasang" sebagai foto workshop.
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
      ARTISAN_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih tidak ditemukan.',
    );
  }
  if (rows.some((row) => row.visibility !== 'PUBLIC')) {
    throw businessRuleViolation(
      ARTISAN_BUSINESS_RULES.PRIVATE_MEDIA_NOT_ALLOWED,
      'Media privat tidak boleh dipakai pada profil publik pengrajin.',
    );
  }
  if (rows.some((row) => row.deletedAt !== null)) {
    throw businessRuleViolation(
      ARTISAN_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih sudah berada di Trash.',
    );
  }
}

// ── Slug (model §6.1) ────────────────────────────────────────────────────────

async function slugTaken(tx: Tx, slug: string, exceptId?: string): Promise<boolean> {
  const row = await tx.artisan.findUnique({ where: { slug }, select: { id: true } });
  return row !== null && row.id !== exceptId;
}

async function resolveArtisanSlug(
  tx: Tx,
  input: { requested?: string | undefined; name: string },
  exceptId?: string,
): Promise<string> {
  // Slug eksplisit tidak pernah diberi akhiran diam-diam: bentrok → `409`.
  if (input.requested !== undefined) {
    if (await slugTaken(tx, input.requested, exceptId)) throw conflict(['slug']);
    return input.requested;
  }
  return uniqueSlug(slugify(input.name), (candidate) => slugTaken(tx, candidate, exceptId));
}

function asConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict(uniqueConflictFields(error, ['slug']));
  throw error;
}

// ── ActivityLog (model §6.9: transaksi yang sama) ────────────────────────────

async function logArtisanActivity(
  tx: Tx,
  actorId: string | null,
  action: string,
  message: string,
  artisanId: string,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      kind: 'ARTISAN',
      action,
      message,
      actorId,
      entityType: 'Artisan',
      entityId: artisanId,
    },
    select: { id: true },
  });
}

// ── Menyusun data tulis ──────────────────────────────────────────────────────

type ArtisanWrite = Omit<ArtisanInput, 'slug' | 'images'>;
type PartialArtisanWrite = { [K in keyof ArtisanWrite]?: ArtisanWrite[K] | undefined };

function scalarData(input: PartialArtisanWrite): Prisma.ArtisanUncheckedUpdateInput {
  const data: Prisma.ArtisanUncheckedUpdateInput = {};
  const set = (key: keyof ArtisanWrite): void => {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  };
  set('name');
  set('contactName');
  set('phone');
  set('partnerSinceYear');
  set('village');
  set('regency');
  set('province');
  set('address');
  set('craftsmenCount');
  set('monthlyCapacity');
  set('capacityUnit');
  set('avgLeadTimeDays');
  set('skills');
  set('summary');
  set('internalNotes');
  set('photoId');
  // `story` bertipe Json: `null` berarti "dikosongkan" (kontrak §1.3).
  if (input.story !== undefined) {
    data.story = input.story ?? Prisma.DbNull;
  }
  return data;
}

/** Galeri **mengganti seluruh isi** bila dikirim (kontrak §1.3). */
async function syncImages(
  tx: Tx,
  artisanId: string,
  images: { mediaId: string; caption?: string | null | undefined }[] | undefined,
): Promise<void> {
  if (images === undefined) return;
  await assertUsableMedia(
    tx,
    images.map((image) => image.mediaId),
  );
  await tx.artisanImage.deleteMany({ where: { artisanId } });
  if (images.length === 0) return;
  await tx.artisanImage.createMany({
    data: images.map((image, position) => ({
      artisanId,
      mediaId: image.mediaId,
      position,
      caption: image.caption ?? null,
    })),
  });
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createArtisan(
  prisma: PrismaClient,
  options: { actor: Actor; input: ArtisanInput },
): Promise<ArtisanResult> {
  const { actor, input } = options;
  return prisma
    .$transaction(async (tx) => {
      if (input.photoId !== undefined && input.photoId !== null) {
        await assertUsableMedia(tx, [input.photoId]);
      }
      const slug = await resolveArtisanSlug(tx, { requested: input.slug, name: input.name });

      const created = await tx.artisan.create({
        data: {
          ...(scalarData(input) as Prisma.ArtisanUncheckedCreateInput),
          name: input.name,
          slug,
          regency: input.regency,
          province: input.province,
          skills: input.skills,
          // Selalu `VERIFICATION` (kontrak §5.8): profil baru tidak pernah
          // langsung tayang, berapa pun lengkap isinya.
          status: 'VERIFICATION',
        },
        select: { id: true },
      });
      await syncImages(tx, created.id, input.images);
      await logArtisanActivity(
        tx,
        actor.id,
        'artisan.created',
        `Pengrajin "${input.name}" dibuat`,
        created.id,
      );
      return loadArtisanResult(tx, created.id);
    })
    .catch(asConflict);
}

// ── Update ───────────────────────────────────────────────────────────────────

export const artisanInvalidState = (
  message: string,
  current: string,
  allowed: string[],
): AppError => new AppError('INVALID_STATE', message, { details: { current, allowed } });

export async function updateArtisan(
  prisma: PrismaClient,
  options: { actor: Actor; artisanId: string; body: UpdateArtisanBody },
): Promise<ArtisanResult> {
  const { actor, artisanId, body } = options;
  const { expectedUpdatedAt, slug: requestedSlug, status, ...input } = body;

  return prisma
    .$transaction(async (tx) => {
      const current = await tx.artisan.findUniqueOrThrow({
        where: { id: artisanId },
        select: { id: true, name: true, slug: true, updatedAt: true, archivedAt: true },
      });

      // Urutan §1.10: state dulu, baru konflik edit — pengrajin yang
      // diarsipkan tidak bisa diubah berapa pun segarnya versi klien.
      if (current.archivedAt !== null) {
        throw artisanInvalidState(
          'Pengrajin yang diarsipkan tidak dapat diubah. Pulihkan dari arsip terlebih dahulu.',
          'ARCHIVED',
          ['ACTIVE'],
        );
      }
      assertUpdatedAtMatches(
        current,
        expectedUpdatedAt,
        'Pengrajin sudah diubah orang lain. Muat ulang sebelum menyimpan.',
      );

      if (input.photoId !== undefined && input.photoId !== null) {
        await assertUsableMedia(tx, [input.photoId]);
      }
      const nextSlug =
        requestedSlug === undefined
          ? current.slug
          : await resolveArtisanSlug(
              tx,
              { requested: requestedSlug, name: current.name },
              artisanId,
            );

      await tx.artisan.update({
        where: { id: artisanId },
        data: {
          ...scalarData(input),
          slug: nextSlug,
          ...(status === undefined ? {} : { status }),
        },
        select: { id: true },
      });
      await syncImages(tx, artisanId, input.images);
      await logArtisanActivity(
        tx,
        actor.id,
        'artisan.updated',
        `Pengrajin "${input.name ?? current.name}" disimpan`,
        artisanId,
      );
      return loadArtisanResult(tx, artisanId);
    })
    .catch(asConflict);
}

// ── Arsip (model §6.7, A10) ──────────────────────────────────────────────────

export interface ArchiveResult extends ArtisanResult {
  /** Jumlah produk terbit saat diarsipkan; `0` = tanpa peringatan. */
  publishedProductCountAtArchive: number;
}

/**
 * Mengarsipkan **tidak ditolak** walau masih ada produk terbit (A10): produknya
 * tetap tayang, yang hilang hanya profil publiknya (§6.7), dan di detail produk
 * pengrajin muncul ringkas tanpa tautan. Karena itu jumlahnya dikembalikan
 * sebagai `warnings`, bukan sebagai error.
 */
export async function archiveArtisan(
  prisma: PrismaClient,
  options: { actor: Actor; artisanId: string },
): Promise<ArchiveResult> {
  const { actor, artisanId } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.artisan.findUniqueOrThrow({
      where: { id: artisanId },
      select: { name: true, status: true, archivedAt: true },
    });
    if (current.archivedAt !== null) {
      throw artisanInvalidState('Pengrajin ini sudah diarsipkan.', 'ARCHIVED', [current.status]);
    }

    const published = await tx.product.count({
      where: { artisanId, ...publishedProductWhere },
    });
    await tx.artisan.update({
      where: { id: artisanId },
      data: { archivedAt: new Date() },
      select: { id: true },
    });
    await logArtisanActivity(
      tx,
      actor.id,
      'artisan.archived',
      published === 0
        ? `Pengrajin "${current.name}" diarsipkan`
        : `Pengrajin "${current.name}" diarsipkan; ${String(published)} produk terbit tetap tayang`,
      artisanId,
    );
    const result = await loadArtisanResult(tx, artisanId);
    return { ...result, publishedProductCountAtArchive: published };
  });
}

export async function unarchiveArtisan(
  prisma: PrismaClient,
  options: { actor: Actor; artisanId: string },
): Promise<ArtisanResult> {
  const { actor, artisanId } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.artisan.findUniqueOrThrow({
      where: { id: artisanId },
      select: { name: true, status: true, archivedAt: true },
    });
    if (current.archivedAt === null) {
      throw artisanInvalidState('Pengrajin ini tidak berada di arsip.', current.status, [
        'ARCHIVED',
      ]);
    }

    await tx.artisan.update({
      where: { id: artisanId },
      // `status` dipertahankan apa adanya: arsip bukan status publikasi, jadi
      // memulihkan tidak boleh diam-diam menayangkan profil yang dulu `ACTIVE`
      // menjadi sesuatu yang lain — maupun sebaliknya.
      data: { archivedAt: null },
      select: { id: true },
    });
    await logArtisanActivity(
      tx,
      actor.id,
      'artisan.unarchived',
      `Pengrajin "${current.name}" dipulihkan dari arsip`,
      artisanId,
    );
    return loadArtisanResult(tx, artisanId);
  });
}

// ── Dokumen 🔒 (kontrak §5.8, model §3.4) ────────────────────────────────────

/**
 * Kebalikan dari `assertUsableMedia`: berkas dokumen **wajib** Media `PRIVATE`.
 * Media `PUBLIC` punya URL yang bisa ditebak siapa pun di domain publik R2,
 * jadi menautkannya sebagai scan KTP akan menjadi kebocoran permanen — bukan
 * sekadar kesalahan metadata.
 */
export async function assertPrivateMedia(tx: Tx, mediaId: string): Promise<void> {
  const media = await tx.media.findUnique({
    where: { id: mediaId },
    select: { visibility: true, deletedAt: true },
  });
  if (media === null) {
    throw businessRuleViolation(
      ARTISAN_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Berkas yang dipilih tidak ditemukan.',
    );
  }
  if (media.deletedAt !== null) {
    throw businessRuleViolation(
      ARTISAN_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Berkas yang dipilih sudah berada di Trash.',
    );
  }
  if (media.visibility !== 'PRIVATE') {
    throw businessRuleViolation(
      ARTISAN_BUSINESS_RULES.MEDIA_NOT_PRIVATE,
      'Dokumen pengrajin hanya boleh memakai berkas privat.',
    );
  }
}

export async function createArtisanDocument(
  prisma: PrismaClient,
  options: {
    actor: Actor;
    artisanId: string;
    input: { mediaId: string; kind: string; title: string };
  },
): Promise<string> {
  const { actor, artisanId, input } = options;
  const mediaAlreadyUsed = (): AppError =>
    businessRuleViolation(
      ARTISAN_BUSINESS_RULES.MEDIA_ALREADY_USED,
      'Berkas ini sudah terdaftar sebagai dokumen pengrajin.',
    );

  try {
    return await prisma.$transaction(async (tx) => {
      await assertPrivateMedia(tx, input.mediaId);
      // Pemeriksaan ini hanya untuk pesan yang enak dibaca pada kasus biasa.
      // Yang **menegakkan** aturannya adalah indeks unik di `media_id`: dua
      // request bersamaan sama-sama melihat `null` di sini, dan hanya satu
      // yang bisa lolos `create` (ditangkap di bawah).
      const existing = await tx.artisanDocument.findFirst({
        where: { mediaId: input.mediaId },
        select: { id: true },
      });
      if (existing !== null) throw mediaAlreadyUsed();

      const document = await tx.artisanDocument.create({
        data: {
          artisanId,
          mediaId: input.mediaId,
          kind: input.kind as Prisma.ArtisanDocumentCreateInput['kind'],
          title: input.title,
          uploadedById: actor.id,
        },
        select: { id: true },
      });
      await logArtisanActivity(
        tx,
        actor.id,
        'artisan.document_added',
        `Dokumen "${input.title}" ditambahkan`,
        artisanId,
      );
      return document.id;
    });
  } catch (error) {
    // Pihak yang kalah lomba mendapat jawaban yang sama persis dengan pihak
    // yang datang belakangan secara berurutan — bukan `500`.
    if (isUniqueViolation(error)) throw mediaAlreadyUsed();
    throw error;
  }
}

/**
 * Menghapus dokumen memindahkan **Media**-nya ke Trash (kontrak §5.8), bukan
 * menghapus objek R2: pemulihan 30 hari (model §6.4) juga berlaku untuk berkas
 * yang salah hapus, dan penghapusan objek adalah urusan job purge.
 */
export async function deleteArtisanDocument(
  prisma: PrismaClient,
  options: { actor: Actor; artisanId: string; documentId: string },
): Promise<void> {
  const { actor, artisanId, documentId } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.artisanDocument.findFirst({
      where: { id: documentId, artisanId },
      select: { id: true, title: true, mediaId: true },
    });
    if (current === null) throw notFound('Dokumen tidak ditemukan.');

    await tx.artisanDocument.delete({ where: { id: current.id }, select: { id: true } });
    await tx.media.update({
      where: { id: current.mediaId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
    await logArtisanActivity(
      tx,
      actor.id,
      'artisan.document_removed',
      `Dokumen "${current.title}" dihapus`,
      artisanId,
    );
  });
}

export type { ArtisanStatus };
