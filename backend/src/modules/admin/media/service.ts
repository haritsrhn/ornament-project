/**
 * Media Library — logika kontrak §5.12, model §3.2.
 *
 * Tiga hal yang membentuk modul ini:
 *
 * 1. **Berkas tidak lewat API** (ADR K3). Server hanya menandatangani izin
 *    unggah dan memverifikasi hasilnya lewat `HeadObject`, sehingga batas
 *    ukuran ditegakkan dua kali: R2 menolak `Content-Length` yang berbeda dari
 *    yang ditandatangani, dan konfirmasi menolak objek yang tetap tidak cocok.
 * 2. **Tidak ada tabel unggahan sementara.** Keputusan presign dibawa klien
 *    sebagai token HMAC (`lib/upload-token.ts`), jadi tab yang ditutup di
 *    tengah unggahan tidak meninggalkan baris yatim.
 * 3. **Dua tingkat "sedang dipakai"** (model §5): rujukan dari konten terbit
 *    menghalangi pemindahan ke Trash, rujukan apa pun menghalangi hapus
 *    permanen. Keduanya dihitung `usage.ts` agar detail dan penjaga hapus
 *    tidak pernah berbeda pendapat.
 */

import { randomUUID } from 'node:crypto';

import {
  mediaKindForMime,
  mediaSizeLimit,
  allowedMimeTypes,
  MEDIA_DOWNLOAD_TTL_SECONDS,
  MEDIA_UPLOAD_TTL_SECONDS,
  UPLOAD_INVALID_REASONS,
  type MediaConfirmInput,
  type MediaListQuery,
  type MediaPatchInput,
  type MediaUploadRequest,
  type MediaUploadTicket,
  type MediaUrl,
  type MediaUsage,
  type MediaVisibility,
} from '@ornament/shared';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, notFound } from '../../../lib/errors.js';
import { readImageSize } from '../../../lib/image-size.js';
import { escapeLike } from '../../../lib/like.js';
import { buildMediaKey, type R2 } from '../../../lib/r2.js';
import {
  isTicketExpired,
  signUploadTicket,
  verifyUploadTicket,
} from '../../../lib/upload-token.js';
import { adminMediaSelect, type AdminMediaRow } from './dto.js';
import { collectMediaUsages } from './usage.js';

export interface MediaActor {
  id: string;
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

export interface MediaDeps {
  prisma: PrismaClient;
  r2: R2 | null;
  uploadSecret: string | undefined;
}

/** Byte pertama yang dibaca untuk mencari dimensi; header gambar jauh lebih kecil dari ini. */
const IMAGE_HEADER_BYTES = 64 * 1024;

const serviceUnavailable = (): AppError =>
  new AppError(
    'SERVICE_UNAVAILABLE',
    'Penyimpanan berkas belum dikonfigurasi. Hubungi administrator.',
  );

const uploadInvalid = (reason: string, message: string): AppError =>
  new AppError('UPLOAD_INVALID', message, { details: { reason } });

/**
 * R2 dan kunci tanda tangan selalu diminta bersama: tiket yang ditandatangani
 * tanpa bucket tidak akan pernah bisa ditebus, jadi keduanya satu syarat.
 */
function requireStorage(deps: MediaDeps): { r2: R2; secret: string } {
  if (deps.r2 === null || deps.uploadSecret === undefined) throw serviceUnavailable();
  return { r2: deps.r2, secret: deps.uploadSecret };
}

// ── Unggah ───────────────────────────────────────────────────────────────────

export async function createUploadTicket(
  deps: MediaDeps,
  actor: MediaActor,
  input: MediaUploadRequest,
  now: Date = new Date(),
): Promise<MediaUploadTicket> {
  const { r2, secret } = requireStorage(deps);

  const limit = mediaSizeLimit(input.visibility, input.mimeType);
  if (limit === null) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Tipe berkas ${input.mimeType} tidak diizinkan.`, {
      details: { allowed: allowedMimeTypes(input.visibility) },
    });
  }
  if (input.sizeBytes > limit) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Ukuran berkas melebihi batas yang diizinkan.', {
      details: { maxBytes: limit, sizeBytes: input.sizeBytes },
    });
  }

  // `id` media ditentukan sekarang supaya key sudah final saat ditandatangani;
  // barisnya baru dibuat saat konfirmasi, dengan `id` yang sama.
  const id = randomUUID();
  const key = buildMediaKey({
    id,
    fileName: input.fileName,
    visibility: input.visibility,
    now,
  });
  const expiresAt = new Date(now.getTime() + MEDIA_UPLOAD_TTL_SECONDS * 1000);

  let uploadUrl: string;
  try {
    uploadUrl = await r2.presignPut({
      key,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      expiresInSeconds: MEDIA_UPLOAD_TTL_SECONDS,
    });
  } catch (error) {
    throw new AppError('UPSTREAM_FAILED', 'Gagal menyiapkan unggahan ke penyimpanan.', {
      cause: error,
    });
  }

  return {
    uploadId: signUploadTicket(
      {
        key,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        visibility: input.visibility,
        userId: actor.id,
        exp: Math.floor(expiresAt.getTime() / 1000),
      },
      secret,
    ),
    uploadUrl,
    method: 'PUT',
    headers: {
      'Content-Type': input.mimeType,
      'Content-Length': String(input.sizeBytes),
    },
    key,
    expiresAt: expiresAt.toISOString(),
  };
}

export interface ConfirmResult {
  row: AdminMediaRow;
  /** `true` bila tiket ini sudah pernah dikonfirmasi — pemanggil menjawab `200`, bukan `201`. */
  replayed: boolean;
}

export async function confirmUpload(
  deps: MediaDeps,
  actor: MediaActor,
  input: MediaConfirmInput,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const { r2, secret } = requireStorage(deps);

  const ticket = verifyUploadTicket(input.uploadId, secret);
  if (ticket === null) {
    throw uploadInvalid(UPLOAD_INVALID_REASONS.NOT_FOUND, 'Tiket unggah tidak dikenali.');
  }
  if (isTicketExpired(ticket, now)) {
    throw uploadInvalid(
      UPLOAD_INVALID_REASONS.EXPIRED,
      'Tiket unggah sudah kedaluwarsa. Ulangi unggahan.',
    );
  }
  // Tiket milik orang lain diperlakukan seolah tidak ada: pemakainya tidak
  // perlu tahu bahwa key itu memang pernah diterbitkan.
  if (ticket.userId !== actor.id) {
    throw uploadInvalid(UPLOAD_INVALID_REASONS.NOT_FOUND, 'Tiket unggah tidak dikenali.');
  }

  // Idempotensi (kontrak §5.12): tiket yang sama dari pemanggil yang sama
  // mengembalikan media yang sudah dibuat, bukan `409`.
  const existing = await deps.prisma.media.findUnique({
    where: { key: ticket.key },
    select: adminMediaSelect,
  });
  if (existing !== null) {
    if (existing.uploadedBy?.id === actor.id) return { row: existing, replayed: true };
    throw new AppError('CONFLICT', 'Berkas ini sudah terdaftar.');
  }

  const head = await r2.head(ticket.key);
  if (head === null) {
    throw uploadInvalid(UPLOAD_INVALID_REASONS.NOT_FOUND, 'Berkas belum terunggah ke penyimpanan.');
  }
  // Batas ukuran ditegakkan lagi di sini: `Content-Length` memang ikut
  // ditandatangani, tapi keputusan itu hanya berlaku bila objek yang ada
  // benar-benar objek yang disetujui.
  if (head.sizeBytes !== ticket.sizeBytes) {
    throw uploadInvalid(
      UPLOAD_INVALID_REASONS.MISMATCH,
      'Ukuran berkas tidak sama dengan yang didaftarkan.',
    );
  }
  if (head.mimeType !== undefined && head.mimeType !== ticket.mimeType) {
    throw uploadInvalid(
      UPLOAD_INVALID_REASONS.MISMATCH,
      'Tipe berkas tidak sama dengan yang didaftarkan.',
    );
  }

  const kind = mediaKindForMime(ticket.mimeType);
  const size = kind === 'IMAGE' ? await readDimensions(r2, ticket.key) : null;

  const row = await deps.prisma.$transaction(async (tx) => {
    const created = await tx.media.create({
      data: {
        id: idFromKey(ticket.key),
        key: ticket.key,
        visibility: ticket.visibility,
        kind,
        fileName: fileNameFromTicket(ticket.key),
        mimeType: ticket.mimeType,
        sizeBytes: BigInt(ticket.sizeBytes),
        width: size?.width ?? null,
        height: size?.height ?? null,
        alt: input.alt ?? null,
        uploadedById: actor.id,
      },
      select: adminMediaSelect,
    });
    await logMedia(
      tx,
      actor.id,
      'media.uploaded',
      `Berkas "${created.fileName}" diunggah`,
      created.id,
    );
    return created;
  });

  return { row, replayed: false };
}

/**
 * Dimensi bersifat pelengkap: gagal membacanya tidak boleh menggagalkan
 * unggahan yang berkasnya sudah ada di bucket, karena tidak ada jalan mundur
 * yang berguna bagi pengunggah.
 */
async function readDimensions(
  r2: R2,
  key: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const header = await r2.readHead(key, IMAGE_HEADER_BYTES);
    return header === null ? null : readImageSize(header);
  } catch {
    return null;
  }
}

/** `media/2026/09/<uuid>-nama.jpg` → `<uuid>`; key selalu dibentuk `buildMediaKey`. */
function idFromKey(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  return base.slice(0, 36);
}

/** Nama tampilan awal; pemilik berkas bisa menggantinya lewat `PATCH`. */
function fileNameFromTicket(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  return base.slice(37) || base;
}

// ── Daftar ───────────────────────────────────────────────────────────────────

export interface MediaListResult {
  rows: AdminMediaRow[];
  usageCounts: Map<string, number>;
  total: number;
  totalSizeBytes: number;
  months: string[];
}

export async function listMedia(
  deps: MediaDeps,
  actor: MediaActor,
  query: MediaListQuery,
): Promise<MediaListResult> {
  const where = await buildListWhere(deps.prisma, actor, query);

  const [rows, total, sum, months] = await Promise.all([
    deps.prisma.media.findMany({
      where,
      select: adminMediaSelect,
      orderBy: orderBy(query.sort),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    deps.prisma.media.count({ where }),
    // Total terpakai dihitung atas seluruh hasil filter, bukan halaman ini:
    // angka yang hanya menjumlahkan 40 baris pertama tidak berarti apa-apa.
    deps.prisma.media.aggregate({ where, _sum: { sizeBytes: true } }),
    listMonths(deps.prisma, actor),
  ]);

  const usages = await collectMediaUsages(
    deps.prisma,
    rows.map((row) => row.id),
  );
  const usageCounts = new Map<string, number>();
  for (const row of rows) usageCounts.set(row.id, usages.get(row.id)?.length ?? 0);

  return {
    rows,
    usageCounts,
    total,
    totalSizeBytes: Number(sum._sum.sizeBytes ?? 0n),
    months,
  };
}

function orderBy(sort: MediaListQuery['sort']): Prisma.MediaOrderByWithRelationInput[] {
  switch (sort) {
    case 'fileName':
      return [{ fileName: 'asc' }, { id: 'asc' }];
    case '-sizeBytes':
      return [{ sizeBytes: 'desc' }, { id: 'asc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

async function buildListWhere(
  prisma: PrismaClient,
  actor: MediaActor,
  query: MediaListQuery,
): Promise<Prisma.MediaWhereInput> {
  const q = query.q === undefined ? undefined : escapeLike(query.q);

  const where: Prisma.MediaWhereInput = {
    deletedAt: query.trashed === true ? { not: null } : null,
    ...visibilityFilter(actor, query.visibility),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.uploadedById === undefined ? {} : { uploadedById: query.uploadedById }),
    ...(query.month === undefined ? {} : { createdAt: monthRange(query.month) }),
    ...(q === undefined
      ? {}
      : {
          OR: [
            { fileName: { contains: q, mode: 'insensitive' } },
            { alt: { contains: q, mode: 'insensitive' } },
          ],
        }),
  };

  if (query.unused !== true) return where;

  // Sembilan dari sepuluh sumber pemakaian punya relasi, jadi bisa dinyatakan
  // sebagai `none`. Blok gambar di `Article.content` tidak punya FK, sehingga
  // id-nya dikumpulkan lebih dulu dan dikecualikan.
  const usedInContent = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT m."id"::text AS "id"
    FROM "media" m
    JOIN "article" a
      ON a."content" @> jsonb_build_array(jsonb_build_object('mediaId', m."id"::text))
  `);

  return {
    ...where,
    productPrimaryImages: { none: {} },
    productImages: { none: {} },
    artisanPhotos: { none: {} },
    artisanImages: { none: {} },
    artisanDocuments: { none: {} },
    articleFeaturedImages: { none: {} },
    pageBlockImages: { none: {} },
    siteSettingLogos: { none: {} },
    siteSettingIcons: { none: {} },
    inquiryAttachments: { none: {} },
    ...(usedInContent.length === 0 ? {} : { id: { notIn: usedInContent.map((row) => row.id) } }),
  };
}

/**
 * Contributor tidak punya `media.private`, jadi berkas privat tidak boleh
 * muncul sama sekali di daftarnya — filter `visibility` yang dikirimnya
 * diabaikan, bukan dihormati (kontrak §5.12).
 */
function visibilityFilter(
  actor: MediaActor,
  requested: MediaVisibility | undefined,
): Prisma.MediaWhereInput {
  if (actor.role === 'CONTRIBUTOR') return { visibility: 'PUBLIC' };
  return requested === undefined ? {} : { visibility: requested };
}

function monthRange(month: string): Prisma.DateTimeFilter {
  const [year, index] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year ?? 1970, (index ?? 1) - 1, 1));
  const end = new Date(Date.UTC(year ?? 1970, index ?? 1, 1));
  return { gte: start, lt: end };
}

/** Bulan yang punya media, untuk mengisi dropdown filter; terbaru lebih dulu. */
async function listMonths(prisma: PrismaClient, actor: MediaActor): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ month: string }[]>(Prisma.sql`
    SELECT DISTINCT to_char("created_at" AT TIME ZONE 'UTC', 'YYYY-MM') AS "month"
    FROM "media"
    WHERE "deleted_at" IS NULL
      ${actor.role === 'CONTRIBUTOR' ? Prisma.sql`AND "visibility" = 'PUBLIC'` : Prisma.empty}
    ORDER BY "month" DESC
  `);
  return rows.map((row) => row.month);
}

// ── Detail, ubah, buka ───────────────────────────────────────────────────────

export interface MediaWithUsages {
  row: AdminMediaRow;
  usages: MediaUsage[];
}

export async function loadMedia(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
): Promise<MediaWithUsages> {
  const row = await deps.prisma.media.findUnique({
    where: { id: mediaId },
    select: adminMediaSelect,
  });
  if (row === null) throw notFound('Media tidak ditemukan.');
  // Contributor tidak boleh tahu bahwa berkas privat itu ada (kontrak §5.12).
  if (row.visibility === 'PRIVATE' && actor.role === 'CONTRIBUTOR') {
    throw notFound('Media tidak ditemukan.');
  }

  const usages = (await collectMediaUsages(deps.prisma, [mediaId])).get(mediaId) ?? [];
  return { row, usages };
}

/** Contributor hanya boleh menyentuh berkas yang ia unggah sendiri (A1). */
function assertOwnWhenContributor(row: AdminMediaRow, actor: MediaActor): void {
  if (actor.role !== 'CONTRIBUTOR') return;
  if (row.uploadedBy?.id === actor.id) return;
  throw new AppError('FORBIDDEN', 'Anda hanya dapat mengubah berkas yang Anda unggah sendiri.', {
    details: { reason: 'NOT_OWNER' },
  });
}

export async function updateMedia(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
  input: MediaPatchInput,
): Promise<MediaWithUsages> {
  const current = await loadMedia(deps, actor, mediaId);
  assertOwnWhenContributor(current.row, actor);

  // Mengosongkan `alt` berkas yang sedang dipakai konten terbit akan membuat
  // halaman yang sudah tayang kehilangan teks alternatifnya (model §3.2).
  if (input.alt === null && current.usages.some((usage) => usage.isPublished)) {
    throw new AppError(
      'BUSINESS_RULE_VIOLATION',
      'Teks alternatif wajib diisi selama berkas dipakai konten yang terbit.',
      { details: { reason: 'ALT_REQUIRED', usages: current.usages.filter((u) => u.isPublished) } },
    );
  }

  const row = await deps.prisma.media.update({
    where: { id: mediaId },
    data: {
      ...(input.alt === undefined ? {} : { alt: input.alt }),
      ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    },
    select: adminMediaSelect,
  });
  return { row, usages: current.usages };
}

export async function buildMediaUrl(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
  options: { download: boolean; publicBaseUrl: string | undefined },
): Promise<MediaUrl> {
  const { row } = await loadMedia(deps, actor, mediaId);

  if (row.visibility === 'PUBLIC') {
    if (options.publicBaseUrl === undefined) throw serviceUnavailable();
    return {
      url: `${options.publicBaseUrl.replace(/\/$/, '')}/${row.key}`,
      expiresAt: null,
    };
  }

  const { r2 } = requireStorage(deps);
  const expiresAt = new Date(Date.now() + MEDIA_DOWNLOAD_TTL_SECONDS * 1000);
  const url = await r2.presignGet({
    key: row.key,
    expiresInSeconds: MEDIA_DOWNLOAD_TTL_SECONDS,
    ...(options.download ? { downloadAs: row.fileName } : {}),
  });
  return { url, expiresAt: expiresAt.toISOString() };
}

// ── Trash, pulihkan, hapus permanen ──────────────────────────────────────────

export async function trashMedia(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
): Promise<{ id: string; deletedAt: Date }> {
  const current = await loadMedia(deps, actor, mediaId);
  assertOwnWhenContributor(current.row, actor);
  if (current.row.deletedAt !== null) {
    throw new AppError('INVALID_STATE', 'Media sudah berada di Trash.');
  }

  const published = current.usages.filter((usage) => usage.isPublished);
  if (published.length > 0) {
    throw new AppError('IN_USE', 'Berkas masih dipakai konten yang terbit.', {
      details: { usages: published },
    });
  }

  return deps.prisma.$transaction(async (tx) => {
    const row = await tx.media.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true, fileName: true },
    });
    await logMedia(
      tx,
      actor.id,
      'media.trashed',
      `Berkas "${row.fileName}" dipindahkan ke Trash`,
      row.id,
    );
    // `deletedAt` baru saja diisi, jadi tidak mungkin null di sini.
    return { id: row.id, deletedAt: row.deletedAt ?? new Date() };
  });
}

export async function restoreMedia(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
): Promise<MediaWithUsages> {
  const current = await loadMedia(deps, actor, mediaId);
  assertOwnWhenContributor(current.row, actor);
  if (current.row.deletedAt === null) {
    throw new AppError('INVALID_STATE', 'Media tidak berada di Trash.');
  }

  const row = await deps.prisma.$transaction(async (tx) => {
    // Media tidak punya status terbit, jadi pemulihan hanya mengosongkan
    // `deletedAt` — tidak ada yang bisa tayang tanpa diperiksa (Q3).
    const restored = await tx.media.update({
      where: { id: mediaId },
      data: { deletedAt: null },
      select: adminMediaSelect,
    });
    await logMedia(
      tx,
      actor.id,
      'media.restored',
      `Berkas "${restored.fileName}" dipulihkan`,
      restored.id,
    );
    return restored;
  });
  return { row, usages: current.usages };
}

export async function purgeMedia(
  deps: MediaDeps,
  actor: MediaActor,
  mediaId: string,
): Promise<void> {
  const current = await loadMedia(deps, actor, mediaId);
  if (current.row.deletedAt === null) {
    throw new AppError('INVALID_STATE', 'Pindahkan media ke Trash lebih dulu.');
  }
  // Hapus permanen menuntut syarat lebih keras daripada Trash: rujukan dari
  // draf pun menghalangi, karena FK `Restrict` akan menolaknya (model §5).
  if (current.usages.length > 0) {
    throw new AppError('IN_USE', 'Berkas masih dirujuk konten lain.', {
      details: { usages: current.usages },
    });
  }

  const key = current.row.key;
  await deps.prisma.$transaction(async (tx) => {
    await tx.media.delete({ where: { id: mediaId }, select: { id: true } });
    await logMedia(
      tx,
      actor.id,
      'media.purged',
      `Berkas "${current.row.fileName}" dihapus permanen`,
      mediaId,
    );
  });

  // Baris DB lebih dulu, objek R2 sesudahnya (kontrak §5.12): objek yatim di
  // bucket hanya memakan ruang, sedangkan baris yang menunjuk objek yang sudah
  // hilang akan tampil rusak di setiap halaman yang memakainya.
  if (deps.r2 !== null) await deps.r2.remove(key);
}

async function logMedia(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  message: string,
  mediaId: string,
): Promise<void> {
  await tx.activityLog.create({
    data: { kind: 'MEDIA', action, message, actorId, entityType: 'Media', entityId: mediaId },
    select: { id: true },
  });
}
