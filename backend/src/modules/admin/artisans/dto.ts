/**
 * DTO admin pengrajin (kontrak §5.8) dan `select` Prisma yang menghasilkannya.
 *
 * **Whitelist, bukan `omit`** (model domain D9): setiap field ditulis dua kali
 * — sekali di `select` dan sekali di `to…()`.
 *
 * Yang membuat berkas ini berbeda dari DTO admin lain: ia menghasilkan **dua**
 * bentuk dari satu baris. `toAdminArtisan()` untuk Editor+ memuat empat field
 * 🔒 (`contactName`, `phone`, `address`, `internalNotes`); `toArtisanRedacted()`
 * untuk Contributor **tidak memuatnya sama sekali** — bukan `null`, melainkan
 * tidak ada (kontrak §5.8). Keduanya dibangun dari `toArtisanRedacted()` yang
 * sama, jadi menambah field publik baru tidak bisa membuat kedua DTO menyimpang;
 * satu-satunya jalan field 🔒 masuk respons adalah lewat `toAdminArtisan()`.
 */

import type {
  AdminArtisan,
  AdminArtisanImage,
  AdminArtisanRow,
  ArtisanDocumentDto,
  ArtisanDocumentKind,
  ArtisanRedacted,
  ArtisanStatus,
  UserRef,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import { toMediaRef } from '../../auth/me.js';
import { mediaRefSelect, type MediaRefRow } from '../products/dto.js';

/** Lihat catatan urutan relasi di `products/dto.ts`. */
const IMAGE_ORDER: Prisma.ArtisanImageOrderByWithRelationInput[] = [
  { position: 'asc' },
  { mediaId: 'asc' },
];
const DOCUMENT_ORDER: Prisma.ArtisanDocumentOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** Produk pengrajin yang dihitung di kolom "Produk": semua status, di luar Trash. */
const productCountSelect = {
  _count: { select: { products: { where: { deletedAt: null } } } },
} as const;

// ── Baris tabel (kontrak §5.8) ───────────────────────────────────────────────

export const adminArtisanRowSelect = {
  id: true,
  name: true,
  slug: true,
  village: true,
  regency: true,
  province: true,
  skills: true,
  status: true,
  monthlyCapacity: true,
  capacityUnit: true,
  archivedAt: true,
  updatedAt: true,
  photo: { select: mediaRefSelect },
  ...productCountSelect,
} as const;

export interface AdminArtisanRowData {
  id: string;
  name: string;
  slug: string;
  village: string | null;
  regency: string;
  province: string;
  skills: string[];
  status: ArtisanStatus;
  monthlyCapacity: number | null;
  capacityUnit: string;
  archivedAt: Date | null;
  updatedAt: Date;
  photo: MediaRefRow | null;
  _count: { products: number };
}

export function toAdminArtisanRow(
  row: AdminArtisanRowData,
  mediaPublicUrl: string | undefined,
): AdminArtisanRow {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    village: row.village,
    regency: row.regency,
    province: row.province,
    skills: [...row.skills],
    status: row.status,
    monthlyCapacity: row.monthlyCapacity,
    capacityUnit: row.capacityUnit,
    photo: row.photo === null ? null : toMediaRef(row.photo, mediaPublicUrl),
    productCount: row._count.products,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── Detail (kontrak §5.8) ────────────────────────────────────────────────────

/**
 * `select` detail. Empat kolom 🔒 ikut diambil karena Editor+ berhak
 * melihatnya; yang memutuskan apakah ia sampai ke respons adalah `to…()` di
 * bawah, bukan query — sehingga hanya ada **satu** query untuk kedua peran.
 */
export const adminArtisanSelect = {
  id: true,
  name: true,
  slug: true,
  contactName: true,
  phone: true,
  address: true,
  internalNotes: true,
  partnerSinceYear: true,
  village: true,
  regency: true,
  province: true,
  craftsmenCount: true,
  monthlyCapacity: true,
  capacityUnit: true,
  avgLeadTimeDays: true,
  skills: true,
  summary: true,
  story: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  photo: { select: mediaRefSelect },
  images: {
    orderBy: IMAGE_ORDER,
    select: { caption: true, media: { select: mediaRefSelect } },
  },
  ...productCountSelect,
} as const;

export interface AdminArtisanData {
  id: string;
  name: string;
  slug: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  internalNotes: string | null;
  partnerSinceYear: number | null;
  village: string | null;
  regency: string;
  province: string;
  craftsmenCount: number | null;
  monthlyCapacity: number | null;
  capacityUnit: string;
  avgLeadTimeDays: number | null;
  skills: string[];
  summary: string | null;
  story: unknown;
  status: ArtisanStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  photo: MediaRefRow | null;
  images: { caption: string | null; media: MediaRefRow }[];
  _count: { products: number };
}

/**
 * Bentuk yang **boleh dilihat semua peran**. Tidak satu pun dari empat kolom
 * 🔒 disebut di sini; itulah jaminannya (kontrak §3.1: Contributor "Lihat").
 */
export function toArtisanRedacted(
  row: AdminArtisanData,
  publishedProductCount: number,
  mediaPublicUrl: string | undefined,
): ArtisanRedacted {
  const images: AdminArtisanImage[] = row.images.map((image) => ({
    ...toMediaRef(image.media, mediaPublicUrl),
    caption: image.caption,
  }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    partnerSinceYear: row.partnerSinceYear,
    village: row.village,
    regency: row.regency,
    province: row.province,
    craftsmenCount: row.craftsmenCount,
    monthlyCapacity: row.monthlyCapacity,
    capacityUnit: row.capacityUnit,
    avgLeadTimeDays: row.avgLeadTimeDays,
    skills: [...row.skills],
    summary: row.summary,
    story: (row.story ?? null) as ArtisanRedacted['story'],
    status: row.status,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    photo: row.photo === null ? null : toMediaRef(row.photo, mediaPublicUrl),
    images,
    productCount: row._count.products,
    publishedProductCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Editor+ saja (kontrak §3.1 `artisan.read_private`). */
export function toAdminArtisan(
  row: AdminArtisanData,
  publishedProductCount: number,
  mediaPublicUrl: string | undefined,
): AdminArtisan {
  return {
    ...toArtisanRedacted(row, publishedProductCount, mediaPublicUrl),
    contactName: row.contactName,
    phone: row.phone,
    address: row.address,
    internalNotes: row.internalNotes,
  };
}

// ── Dokumen 🔒 (kontrak §5.8) ────────────────────────────────────────────────

export const artisanDocumentSelect = {
  id: true,
  kind: true,
  title: true,
  createdAt: true,
  media: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  uploadedBy: { select: { id: true, name: true } },
} as const;

export const artisanDocumentOrder = DOCUMENT_ORDER;

export interface ArtisanDocumentData {
  id: string;
  kind: ArtisanDocumentKind;
  title: string;
  createdAt: Date;
  media: { id: string; fileName: string; mimeType: string; sizeBytes: bigint };
  uploadedBy: { id: string; name: string } | null;
}

export function toArtisanDocument(row: ArtisanDocumentData): ArtisanDocumentDto {
  const uploadedBy: UserRef | null =
    row.uploadedBy === null ? null : { id: row.uploadedBy.id, name: row.uploadedBy.name };
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    media: {
      id: row.media.id,
      fileName: row.media.fileName,
      mimeType: row.media.mimeType,
      // `BigInt` → `number` (kontrak §1.3: aman di bawah 2^53).
      sizeBytes: Number(row.media.sizeBytes),
    },
    uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}
