/**
 * DTO `AdminMedia` (kontrak §5.12).
 *
 * Berbeda dengan `PublicMedia`, DTO admin memang memuat `fileName`,
 * `sizeBytes`, dan pengunggah — Media Library adalah tempat staf mengurus
 * berkas, bukan halaman publik. Yang tetap tidak pernah keluar adalah `key`:
 * ia hanya berarti di dalam bucket, dan membocorkannya mengundang tebakan URL
 * atas berkas privat.
 */

import type { AdminMedia, AdminMediaDetail, MediaUsage } from '@ornament/shared';

/** `select` Prisma yang menghasilkan `AdminMediaRow` — satu sumber untuk semua query. */
export const adminMediaSelect = {
  id: true,
  key: true,
  kind: true,
  visibility: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  alt: true,
  createdAt: true,
  deletedAt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

export interface AdminMediaRow {
  id: string;
  key: string;
  kind: 'IMAGE' | 'DOCUMENT';
  visibility: 'PUBLIC' | 'PRIVATE';
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  width: number | null;
  height: number | null;
  alt: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  uploadedBy: { id: string; name: string } | null;
}

/**
 * URL permanen hanya untuk berkas `PUBLIC`. Berkas `PRIVATE` selalu `null`:
 * satu-satunya cara membukanya adalah `GET /:id/url` yang menandatangani URL
 * berumur 5 menit, sehingga DTO yang tersimpan di cache frontend tidak pernah
 * menjadi tautan permanen ke KTP seseorang.
 */
export function mediaUrl(
  row: Pick<AdminMediaRow, 'key' | 'visibility'>,
  publicBaseUrl: string | undefined,
): string | null {
  if (row.visibility !== 'PUBLIC' || publicBaseUrl === undefined) return null;
  return `${publicBaseUrl.replace(/\/$/, '')}/${row.key}`;
}

export function toAdminMedia(
  row: AdminMediaRow,
  usageCount: number,
  publicBaseUrl: string | undefined,
): AdminMedia {
  return {
    id: row.id,
    kind: row.kind,
    visibility: row.visibility,
    url: mediaUrl(row, publicBaseUrl),
    fileName: row.fileName,
    mimeType: row.mimeType,
    // `sizeBytes` adalah BigInt di DB (model §3.2) agar tidak ada plafon 2 GB;
    // JSON tidak punya BigInt, dan 20 MB jauh di bawah `Number.MAX_SAFE_INTEGER`.
    sizeBytes: Number(row.sizeBytes),
    width: row.width,
    height: row.height,
    alt: row.alt,
    uploadedBy: row.uploadedBy,
    usageCount,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export function toAdminMediaDetail(
  row: AdminMediaRow,
  usages: MediaUsage[],
  publicBaseUrl: string | undefined,
): AdminMediaDetail {
  return { ...toAdminMedia(row, usages.length, publicBaseUrl), usages };
}
