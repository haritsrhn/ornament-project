/**
 * DTO katalog publik (kontrak §5.1) dan `select` Prisma yang menghasilkannya.
 *
 * **Whitelist, bukan `omit`** (kontrak §4, model domain D9): setiap field yang
 * dikirim ditulis dua kali — sekali di `select` (apa yang diambil dari DB) dan
 * sekali di fungsi `to…()` (apa yang masuk respons). Kolom 🔒 seperti
 * `stockNote`, `stockStatusOverride`, `lowStockThreshold`, `ProductQcCheck.notes`,
 * `revision`, `publishStatus`, `deletedAt`, dan `createdById`/`updatedById`
 * karena itu tidak bisa ikut terkirim, bahkan bila kolom baru ditambahkan ke
 * skema Prisma nanti.
 */

import type {
  PublicProductArtisan,
  PublicProductCard,
  PublicProductDetail,
  QcStage,
  QcStatus,
  StockStatus,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import {
  publicMediaSelect,
  toPublicGallery,
  toPublicMedia,
  type PublicMediaRow,
} from '../media.js';

/**
 * Urutan relasi bersarang ditulis sebagai konstanta bertipe (bukan literal di
 * dalam `as const`) supaya array-nya tetap mutable seperti yang diminta tipe
 * `orderBy` Prisma.
 */
const IMAGE_ORDER: Prisma.ProductImageOrderByWithRelationInput[] = [
  { position: 'asc' },
  { mediaId: 'asc' },
];
const MATERIAL_ORDER: Prisma.ProductMaterialOrderByWithRelationInput[] = [
  { isPrimary: 'desc' },
  { materialId: 'asc' },
];
const SPEC_ORDER: Prisma.ProductSpecOrderByWithRelationInput[] = [
  { position: 'asc' },
  { id: 'asc' },
];

/**
 * Minimal `Prisma.Decimal` yang dipakai DTO. Sengaja bukan tipe Prisma: kontrak
 * hanya butuh dua konversi — `number` untuk ukuran, string desimal untuk uang
 * (kontrak §1.3).
 */
export interface DecimalLike {
  toNumber: () => number;
  toFixed: (digits: number) => string;
}

const toSize = (value: DecimalLike | null): number | null => value?.toNumber() ?? null;
/** `Decimal(10,2)` → `"42.00"` agar presisi tidak hilang lewat float (kontrak §1.3). */
const toMoney = (value: DecimalLike | null): string | null => value?.toFixed(2) ?? null;

/**
 * `origin` tidak disimpan; ia turunan `artisan.village`/`regency` (model §3.5),
 * mis. `"Bangunjiwo, Bantul"`.
 */
export function originOf(
  artisan: { village: string | null; regency: string } | null,
): string | null {
  if (artisan === null) return null;
  return artisan.village === null || artisan.village === ''
    ? artisan.regency
    : `${artisan.village}, ${artisan.regency}`;
}

/**
 * Profil pengrajin tayang publik hanya bila `ACTIVE`/`FULL_CAPACITY` **dan**
 * tidak diarsipkan (model §6.7). Selain itu produknya tetap tayang, tetapi
 * pengrajinnya tampil tanpa tautan (`slug: null`, A10).
 */
export function artisanProfileIsPublic(artisan: {
  status: string;
  archivedAt: Date | null;
}): boolean {
  return (
    (artisan.status === 'ACTIVE' || artisan.status === 'FULL_CAPACITY') &&
    artisan.archivedAt === null
  );
}

// ── Kartu produk ─────────────────────────────────────────────────────────────

export const publicProductCardSelect = {
  id: true,
  slug: true,
  name: true,
  sku: true,
  excerpt: true,
  moqQuantity: true,
  moqUnit: true,
  // Nilai **efektif** yang sudah dihitung server saat simpan (§6.3 Q13);
  // `stockStatusOverride` 🔒 tidak pernah ikut.
  stockStatus: true,
  publishedAt: true,
  category: { select: { slug: true, name: true } },
  primaryImage: { select: publicMediaSelect },
  artisan: { select: { village: true, regency: true } },
  // Satu baris: material primer saja (kartu hanya menampilkan yang utama).
  materials: {
    where: { isPrimary: true },
    take: 1,
    select: { material: { select: { slug: true, name: true } } },
  },
} as const;

export interface ProductCardRow {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  excerpt: string | null;
  moqQuantity: number;
  moqUnit: string;
  stockStatus: StockStatus;
  publishedAt: Date | null;
  category: { slug: string; name: string };
  primaryImage: PublicMediaRow | null;
  artisan: { village: string | null; regency: string } | null;
  materials: { material: { slug: string; name: string } }[];
}

export function toPublicProductCard(
  row: ProductCardRow,
  mediaPublicUrl: string | undefined,
): PublicProductCard {
  const primaryMaterial = row.materials[0]?.material ?? null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // `sku` wajib saat publish (§6.3) dan daftar publik hanya memuat produk
    // terbit, jadi cabang `??` ini hanya menjaga bentuk respons tetap sah.
    sku: row.sku ?? '',
    excerpt: row.excerpt,
    primaryImage: toPublicMedia(row.primaryImage, mediaPublicUrl),
    category: { slug: row.category.slug, name: row.category.name },
    primaryMaterial:
      primaryMaterial === null ? null : { slug: primaryMaterial.slug, name: primaryMaterial.name },
    origin: originOf(row.artisan),
    stockStatus: row.stockStatus,
    moqQuantity: row.moqQuantity,
    moqUnit: row.moqUnit,
    // Produk terbit selalu punya `publishedAt` (lihat `publishedProductWhere`).
    publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
  };
}

// ── Detail produk ────────────────────────────────────────────────────────────

export const publicProductDetailSelect = {
  ...publicProductCardSelect,
  // Tidak masuk DTO; dipakai untuk mencari produk terkait (kategori sama).
  categoryId: true,
  description: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  leadTimeDays: true,
  stockQuantity: true,
  fobPriceUsd: true,
  fobPort: true,
  images: { orderBy: IMAGE_ORDER, select: { media: { select: publicMediaSelect } } },
  tags: { select: { tag: { select: { slug: true, name: true } } } },
  // Detail memakai seluruh material (bukan hanya yang primer), jadi `where`
  // kartu ditimpa di sini.
  materials: {
    orderBy: MATERIAL_ORDER,
    select: { isPrimary: true, material: { select: { slug: true, name: true } } },
  },
  specs: { orderBy: SPEC_ORDER, select: { label: true, value: true } },
  // `notes` 🔒, `checkedById`, dan `checkedAt` sengaja tidak dipilih (kontrak §4).
  // Urutan enum `QcStage` di PostgreSQL = urutan deklarasi: MATERIAL → PACKAGING.
  qcChecks: { orderBy: { stage: 'asc' }, select: { stage: true, status: true, criteria: true } },
  artisan: {
    select: {
      slug: true,
      name: true,
      village: true,
      regency: true,
      province: true,
      skills: true,
      status: true,
      archivedAt: true,
      photo: { select: publicMediaSelect },
    },
  },
} as const;

export interface ProductArtisanRow {
  slug: string;
  name: string;
  village: string | null;
  regency: string;
  province: string;
  skills: string[];
  status: string;
  archivedAt: Date | null;
  photo: PublicMediaRow | null;
}

export interface ProductDetailRow extends Omit<ProductCardRow, 'artisan' | 'materials'> {
  categoryId: string;
  description: unknown;
  lengthCm: DecimalLike | null;
  widthCm: DecimalLike | null;
  heightCm: DecimalLike | null;
  weightKg: DecimalLike | null;
  leadTimeDays: number | null;
  stockQuantity: number | null;
  fobPriceUsd: DecimalLike | null;
  fobPort: string | null;
  images: { media: PublicMediaRow }[];
  tags: { tag: { slug: string; name: string } }[];
  materials: { isPrimary: boolean; material: { slug: string; name: string } }[];
  specs: { label: string; value: string }[];
  qcChecks: { stage: QcStage; status: QcStatus; criteria: string | null }[];
  artisan: ProductArtisanRow | null;
}

export function toPublicProductArtisan(
  artisan: ProductArtisanRow,
  mediaPublicUrl: string | undefined,
): PublicProductArtisan {
  return {
    // `slug: null` → UI menampilkan pengrajin tanpa tautan (A10, §6.7).
    slug: artisanProfileIsPublic(artisan) ? artisan.slug : null,
    name: artisan.name,
    village: artisan.village,
    regency: artisan.regency,
    province: artisan.province,
    skills: [...artisan.skills],
    photo: toPublicMedia(artisan.photo, mediaPublicUrl),
  };
}

export function toPublicProductDetail(
  row: ProductDetailRow,
  related: ProductCardRow[],
  mediaPublicUrl: string | undefined,
): PublicProductDetail {
  const card = toPublicProductCard(
    {
      ...row,
      artisan:
        row.artisan === null
          ? null
          : { village: row.artisan.village, regency: row.artisan.regency },
      materials: row.materials.filter((m) => m.isPrimary),
    },
    mediaPublicUrl,
  );

  return {
    ...card,
    description: (row.description ?? null) as PublicProductDetail['description'],
    images: toPublicGallery(row.images, mediaPublicUrl),
    tags: row.tags.map(({ tag }) => ({ slug: tag.slug, name: tag.name })),
    materials: row.materials.map(({ isPrimary, material }) => ({
      slug: material.slug,
      name: material.name,
      isPrimary,
    })),
    dimensions: {
      lengthCm: toSize(row.lengthCm),
      widthCm: toSize(row.widthCm),
      heightCm: toSize(row.heightCm),
    },
    weightKg: toSize(row.weightKg),
    leadTimeDays: row.leadTimeDays,
    stockQuantity: row.stockQuantity,
    fobPriceUsd: toMoney(row.fobPriceUsd),
    fobPort: row.fobPort,
    specs: row.specs.map(({ label, value }) => ({ label, value })),
    qcChecks: row.qcChecks.map(({ stage, status, criteria }) => ({ stage, status, criteria })),
    artisan: row.artisan === null ? null : toPublicProductArtisan(row.artisan, mediaPublicUrl),
    related: related.map((item) => toPublicProductCard(item, mediaPublicUrl)),
  };
}
