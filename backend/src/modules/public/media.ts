/**
 * `PublicMedia` (kontrak §4/§5). Ditulis eksplisit: `id`, `key`, `fileName`,
 * `sizeBytes`, `uploadedById`, dan `visibility` tidak pernah ikut ke `/public`.
 */

import type { PublicMedia, PublicMediaWithCaption } from '@ornament/shared';

/** Bentuk baris media yang dibutuhkan DTO; sengaja bukan tipe Prisma penuh. */
export interface PublicMediaRow {
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  visibility: 'PUBLIC' | 'PRIVATE';
}

/** `select` Prisma yang menghasilkan `PublicMediaRow` — satu sumber untuk semua query. */
export const publicMediaSelect = {
  key: true,
  alt: true,
  width: true,
  height: true,
  visibility: true,
} as const;

/**
 * `null` bila media tidak layak tampil publik:
 *
 * - Media `PRIVATE` (dokumen pengrajin, lampiran inquiry) — lapis kedua setelah
 *   validasi saat simpan, sehingga salah rujuk tidak pernah menjadi kebocoran.
 * - Basis URL publik R2 belum dikonfigurasi (`R2_PUBLIC_URL`), jadi tidak ada
 *   URL yang bisa dibentuk. Kontrak §5 mewajibkan `PublicMedia.url` berupa
 *   string, jadi lebih baik field-nya `null` daripada URL karangan.
 */
export function toPublicMedia(
  media: PublicMediaRow | null | undefined,
  publicBaseUrl: string | undefined,
): PublicMedia | null {
  if (media?.visibility !== 'PUBLIC' || publicBaseUrl === undefined) return null;
  return {
    url: `${publicBaseUrl.replace(/\/$/, '')}/${media.key}`,
    alt: media.alt,
    width: media.width,
    height: media.height,
  };
}

/** Galeri: baris yang tidak bisa dijadikan URL publik dibuang, bukan dikirim `null`. */
export function toPublicGallery(
  rows: readonly { media: PublicMediaRow }[],
  publicBaseUrl: string | undefined,
): PublicMedia[] {
  const gallery: PublicMedia[] = [];
  for (const row of rows) {
    const media = toPublicMedia(row.media, publicBaseUrl);
    if (media !== null) gallery.push(media);
  }
  return gallery;
}

/** Galeri pengrajin (kontrak §5.2): sama, ditambah `caption`. */
export function toPublicGalleryWithCaption(
  rows: readonly { media: PublicMediaRow; caption: string | null }[],
  publicBaseUrl: string | undefined,
): PublicMediaWithCaption[] {
  const gallery: PublicMediaWithCaption[] = [];
  for (const row of rows) {
    const media = toPublicMedia(row.media, publicBaseUrl);
    if (media !== null) gallery.push({ ...media, caption: row.caption });
  }
  return gallery;
}
