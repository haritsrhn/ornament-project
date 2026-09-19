/**
 * DTO pengrajin publik (kontrak §5.2) dan `select` Prisma yang menghasilkannya.
 *
 * **Whitelist, bukan `omit`** (kontrak §4, model §6.7): `contactName`, `phone`,
 * `address`, `internalNotes`, relasi `documents` (`ArtisanDocument`, termasuk
 * dokumen identitas dan rekening), serta `archivedAt` (Q14) tidak pernah
 * disebut di `select` maupun di fungsi `to…()` — jadi tidak ada jalur yang bisa
 * membawanya ke respons publik.
 */

import type { PublicArtisanCard, PublicArtisanDetail, PublicArtisanStatus } from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import {
  publicMediaSelect,
  toPublicGalleryWithCaption,
  toPublicMedia,
  type PublicMediaRow,
} from '../media.js';
import type { ProductCardRow } from '../products/dto.js';
import { toPublicProductCard } from '../products/dto.js';

/** Lihat catatan urutan relasi di `products/dto.ts`. */
const ARTISAN_IMAGE_ORDER: Prisma.ArtisanImageOrderByWithRelationInput[] = [
  { position: 'asc' },
  { mediaId: 'asc' },
];

export const publicArtisanCardSelect = {
  slug: true,
  name: true,
  village: true,
  regency: true,
  province: true,
  skills: true,
  summary: true,
  status: true,
  partnerSinceYear: true,
  photo: { select: publicMediaSelect },
} as const;

export interface ArtisanCardRow {
  slug: string;
  name: string;
  village: string | null;
  regency: string;
  province: string;
  skills: string[];
  summary: string | null;
  status: string;
  partnerSinceYear: number | null;
  photo: PublicMediaRow | null;
}

/**
 * Daftar publik hanya memuat `ACTIVE`/`FULL_CAPACITY` (§6.7), jadi nilai lain
 * tidak pernah sampai ke sini; `??` hanya menjaga bentuk respons tetap sah bila
 * pemanggil baru lupa memakai `publicArtisanWhere`.
 */
function toPublicStatus(status: string): PublicArtisanStatus {
  return status === 'FULL_CAPACITY' ? 'FULL_CAPACITY' : 'ACTIVE';
}

export function toPublicArtisanCard(
  row: ArtisanCardRow,
  publishedProductCount: number,
  mediaPublicUrl: string | undefined,
): PublicArtisanCard {
  return {
    slug: row.slug,
    name: row.name,
    village: row.village,
    regency: row.regency,
    province: row.province,
    skills: [...row.skills],
    summary: row.summary,
    status: toPublicStatus(row.status),
    partnerSinceYear: row.partnerSinceYear,
    photo: toPublicMedia(row.photo, mediaPublicUrl),
    publishedProductCount,
  };
}

export const publicArtisanDetailSelect = {
  ...publicArtisanCardSelect,
  story: true,
  craftsmenCount: true,
  monthlyCapacity: true,
  capacityUnit: true,
  avgLeadTimeDays: true,
  images: {
    orderBy: ARTISAN_IMAGE_ORDER,
    select: { caption: true, media: { select: publicMediaSelect } },
  },
} as const;

export interface ArtisanDetailRow extends ArtisanCardRow {
  story: unknown;
  craftsmenCount: number | null;
  monthlyCapacity: number | null;
  capacityUnit: string;
  avgLeadTimeDays: number | null;
  images: { caption: string | null; media: PublicMediaRow }[];
}

export function toPublicArtisanDetail(
  row: ArtisanDetailRow,
  products: ProductCardRow[],
  publishedProductCount: number,
  mediaPublicUrl: string | undefined,
): PublicArtisanDetail {
  return {
    ...toPublicArtisanCard(row, publishedProductCount, mediaPublicUrl),
    story: (row.story ?? null) as PublicArtisanDetail['story'],
    craftsmenCount: row.craftsmenCount,
    monthlyCapacity: row.monthlyCapacity,
    capacityUnit: row.capacityUnit,
    avgLeadTimeDays: row.avgLeadTimeDays,
    images: toPublicGalleryWithCaption(row.images, mediaPublicUrl),
    products: products.map((product) => toPublicProductCard(product, mediaPublicUrl)),
  };
}
