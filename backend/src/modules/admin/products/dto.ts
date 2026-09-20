/**
 * DTO admin produk (kontrak §5.6) dan `select` Prisma yang menghasilkannya.
 *
 * **Whitelist, bukan `omit`** (model domain D9): setiap field ditulis dua kali
 * — sekali di `select` (apa yang diambil dari DB) dan sekali di `to…()` (apa
 * yang masuk respons). Kolom baru di Prisma karena itu tidak pernah ikut
 * terkirim hanya karena ada.
 *
 * Berbeda dengan DTO publik (`modules/public/products/dto.ts`), DTO di sini
 * **boleh** memuat field 🔒 (`stockNote`, `stockStatusOverride`,
 * `lowStockThreshold`, `qcChecks[].notes`) — itulah satu-satunya alasan kedua
 * berkas tidak digabung.
 */

import {
  deriveStockStatus,
  PRODUCT_PUBLISH_REQUIREMENT_PATHS,
  PUBLISH_REQUIREMENT_CODES,
  type AdminProduct,
  type AdminProductRow,
  type AdminQcCheck,
  type MediaRef,
  type PublishReadiness,
  type QcStage,
  type QcStatus,
  type StockStatus,
  type UserRef,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import { toMediaRef } from '../../auth/me.js';

/** Ambang Low Stock bila baris singleton `SiteSetting` belum ada (Prisma default). */
export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/**
 * Urutan relasi bersarang sebagai konstanta bertipe (bukan literal di dalam
 * `as const`) supaya array-nya tetap mutable seperti yang diminta `orderBy`.
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
const TAG_ORDER: Prisma.ProductTagOrderByWithRelationInput[] = [{ tagId: 'asc' }];

/**
 * Minimal `Prisma.Decimal` yang dipakai DTO: kontrak hanya butuh dua konversi
 * — `number` untuk ukuran, string desimal untuk uang (kontrak §1.3).
 */
export interface DecimalLike {
  toNumber: () => number;
  toFixed: (digits: number) => string;
}

const toSize = (value: DecimalLike | null): number | null => value?.toNumber() ?? null;
/** `Decimal(10,2)` → `"42.00"` agar presisi tidak hilang lewat float. */
const toMoney = (value: DecimalLike | null): string | null => value?.toFixed(2) ?? null;

/** Baris media seperti yang dipilih `mediaRefSelect`. */
export interface MediaRefRow {
  id: string;
  key: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export const mediaRefSelect = {
  id: true,
  key: true,
  alt: true,
  width: true,
  height: true,
} as const;

// ── Baris tabel (kontrak §5.6) ───────────────────────────────────────────────

export const adminProductRowSelect = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  publishStatus: true,
  stockStatus: true,
  stockQuantity: true,
  moqUnit: true,
  leadTimeDays: true,
  revision: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true } },
  artisan: { select: { id: true, name: true, regency: true } },
  primaryImage: { select: mediaRefSelect },
  // Kolom "Material" tabel admin menampilkan material primer saja.
  materials: {
    where: { isPrimary: true },
    take: 1,
    select: { material: { select: { id: true, name: true } } },
  },
} as const;

export interface AdminProductRowData {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  publishStatus: 'DRAFT' | 'PUBLISHED';
  stockStatus: StockStatus;
  stockQuantity: number | null;
  moqUnit: string;
  leadTimeDays: number | null;
  revision: number;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { id: string; name: string };
  artisan: { id: string; name: string; regency: string } | null;
  primaryImage: MediaRefRow | null;
  materials: { material: { id: string; name: string } }[];
}

export function toAdminProductRow(
  row: AdminProductRowData,
  mediaPublicUrl: string | undefined,
): AdminProductRow {
  const primaryMaterial = row.materials[0]?.material ?? null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    primaryImage: row.primaryImage === null ? null : toMediaRef(row.primaryImage, mediaPublicUrl),
    category: { id: row.category.id, name: row.category.name },
    primaryMaterial:
      primaryMaterial === null ? null : { id: primaryMaterial.id, name: primaryMaterial.name },
    artisan:
      row.artisan === null
        ? null
        : { id: row.artisan.id, name: row.artisan.name, regency: row.artisan.regency },
    publishStatus: row.publishStatus,
    stockStatus: row.stockStatus,
    stockQuantity: row.stockQuantity,
    moqUnit: row.moqUnit,
    leadTimeDays: row.leadTimeDays,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

// ── Detail (kontrak §5.6) ────────────────────────────────────────────────────

export const adminProductSelect = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  description: true,
  excerpt: true,
  categoryId: true,
  artisanId: true,
  moqQuantity: true,
  moqUnit: true,
  leadTimeDays: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  weightKg: true,
  fobPriceUsd: true,
  fobPort: true,
  publishStatus: true,
  publishedAt: true,
  revision: true,
  stockStatus: true,
  stockQuantity: true,
  // 🔒 Boleh di admin, tidak pernah di `/v1/public/*` (kontrak §4).
  stockStatusOverride: true,
  lowStockThreshold: true,
  stockNote: true,
  primaryImageId: true,
  duplicatedFromId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  artisan: { select: { id: true, name: true, regency: true, archivedAt: true } },
  primaryImage: { select: mediaRefSelect },
  images: { orderBy: IMAGE_ORDER, select: { media: { select: mediaRefSelect } } },
  materials: {
    orderBy: MATERIAL_ORDER,
    select: { isPrimary: true, material: { select: { id: true, name: true, slug: true } } },
  },
  tags: { orderBy: TAG_ORDER, select: { tag: { select: { id: true, name: true, slug: true } } } },
  specs: { orderBy: SPEC_ORDER, select: { id: true, label: true, value: true, position: true } },
  // Urutan enum `QcStage` di PostgreSQL = urutan deklarasi: MATERIAL → PACKAGING.
  qcChecks: {
    orderBy: { stage: 'asc' },
    select: {
      stage: true,
      status: true,
      criteria: true,
      notes: true,
      checkedAt: true,
      checkedBy: { select: { id: true, name: true } },
    },
  },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} as const;

export interface AdminProductData {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  description: unknown;
  excerpt: string | null;
  categoryId: string;
  artisanId: string | null;
  moqQuantity: number;
  moqUnit: string;
  leadTimeDays: number | null;
  lengthCm: DecimalLike | null;
  widthCm: DecimalLike | null;
  heightCm: DecimalLike | null;
  weightKg: DecimalLike | null;
  fobPriceUsd: DecimalLike | null;
  fobPort: string | null;
  publishStatus: 'DRAFT' | 'PUBLISHED';
  publishedAt: Date | null;
  revision: number;
  stockStatus: StockStatus;
  stockQuantity: number | null;
  stockStatusOverride: StockStatus | null;
  lowStockThreshold: number | null;
  stockNote: string | null;
  primaryImageId: string | null;
  duplicatedFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { id: string; name: string; slug: string };
  artisan: { id: string; name: string; regency: string; archivedAt: Date | null } | null;
  primaryImage: MediaRefRow | null;
  images: { media: MediaRefRow }[];
  materials: { isPrimary: boolean; material: { id: string; name: string; slug: string } }[];
  tags: { tag: { id: string; name: string; slug: string } }[];
  specs: { id: string; label: string; value: string; position: number }[];
  qcChecks: {
    stage: QcStage;
    status: QcStatus;
    criteria: string | null;
    notes: string | null;
    checkedAt: Date | null;
    checkedBy: { id: string; name: string } | null;
  }[];
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
}

const toUserRef = (user: { id: string; name: string } | null): UserRef | null =>
  user === null ? null : { id: user.id, name: user.name };

export function toAdminQcCheck(check: AdminProductData['qcChecks'][number]): AdminQcCheck {
  return {
    stage: check.stage,
    status: check.status,
    criteria: check.criteria,
    notes: check.notes,
    checkedBy: toUserRef(check.checkedBy),
    checkedAt: check.checkedAt?.toISOString() ?? null,
  };
}

/**
 * Syarat publish model §6.3: `name`, `sku`, `categoryId`, `artisanId`,
 * `primaryImageId`, material primer, `moqQuantity`, dan artisan tidak
 * diarsipkan.
 *
 * Satu fungsi dipakai dua kali — untuk `publishReadiness` di setiap respons
 * (tombol "Terbitkan" di UI) dan untuk `details` pada `422
 * PUBLISH_REQUIREMENTS_NOT_MET` — sehingga tombol dan penolakan server tidak
 * pernah bisa berbeda pendapat.
 */
export interface PublishRequirementIssue {
  path: string;
  code: string;
}

export function publishRequirementIssues(row: {
  name: string;
  sku: string | null;
  categoryId: string;
  artisanId: string | null;
  primaryImageId: string | null;
  moqQuantity: number;
  materials: { isPrimary: boolean }[];
  artisan: { archivedAt: Date | null } | null;
}): PublishRequirementIssue[] {
  const issues: PublishRequirementIssue[] = [];
  const required = (
    path: (typeof PRODUCT_PUBLISH_REQUIREMENT_PATHS)[number],
    ok: boolean,
  ): void => {
    if (!ok) issues.push({ path, code: PUBLISH_REQUIREMENT_CODES.REQUIRED });
  };

  required('name', row.name.trim() !== '');
  required('sku', row.sku !== null && row.sku !== '');
  required('categoryId', row.categoryId !== '');
  required('artisanId', row.artisanId !== null);
  required('primaryImageId', row.primaryImageId !== null);
  required('materials', row.materials.filter((material) => material.isPrimary).length === 1);
  required('moqQuantity', row.moqQuantity >= 1);

  // Pengrajin yang diarsipkan bukan "kosong", jadi kodenya berbeda: UI perlu
  // menyarankan mengganti pengrajin, bukan mengisinya.
  if (row.artisan !== null && row.artisan.archivedAt !== null) {
    issues.push({ path: 'artisanId', code: PUBLISH_REQUIREMENT_CODES.ARTISAN_ARCHIVED });
  }
  return issues;
}

export function toPublishReadiness(issues: PublishRequirementIssue[]): PublishReadiness {
  return { ready: issues.length === 0, missing: issues.map((issue) => issue.path) };
}

export function toAdminProduct(
  row: AdminProductData,
  siteLowStockThreshold: number,
  mediaPublicUrl: string | undefined,
): AdminProduct {
  const effectiveLowStockThreshold = row.lowStockThreshold ?? siteLowStockThreshold;
  const gallery: MediaRef[] = row.images.map((image) => toMediaRef(image.media, mediaPublicUrl));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    description: (row.description ?? null) as AdminProduct['description'],
    excerpt: row.excerpt,
    category: { id: row.category.id, name: row.category.name, slug: row.category.slug },
    artisan:
      row.artisan === null
        ? null
        : {
            id: row.artisan.id,
            name: row.artisan.name,
            regency: row.artisan.regency,
            archivedAt: row.artisan.archivedAt?.toISOString() ?? null,
          },
    materials: row.materials.map(({ isPrimary, material }) => ({
      id: material.id,
      name: material.name,
      slug: material.slug,
      isPrimary,
    })),
    tags: row.tags.map(({ tag }) => ({ id: tag.id, name: tag.name, slug: tag.slug })),
    moqQuantity: row.moqQuantity,
    moqUnit: row.moqUnit,
    leadTimeDays: row.leadTimeDays,
    lengthCm: toSize(row.lengthCm),
    widthCm: toSize(row.widthCm),
    heightCm: toSize(row.heightCm),
    weightKg: toSize(row.weightKg),
    fobPriceUsd: toMoney(row.fobPriceUsd),
    fobPort: row.fobPort,
    publishStatus: row.publishStatus,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    revision: row.revision,
    // Nilai tersimpan dan nilai turunan harus sama; dihitung ulang di sini
    // supaya baris lama (mis. hasil seed) tetap konsisten di respons.
    stockStatus: deriveStockStatus({
      stockStatusOverride: row.stockStatusOverride,
      stockQuantity: row.stockQuantity,
      effectiveLowStockThreshold,
    }),
    stockQuantity: row.stockQuantity,
    stockStatusOverride: row.stockStatusOverride,
    lowStockThreshold: row.lowStockThreshold,
    effectiveLowStockThreshold,
    stockNote: row.stockNote,
    primaryImage: row.primaryImage === null ? null : toMediaRef(row.primaryImage, mediaPublicUrl),
    images: gallery,
    specs: row.specs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      value: spec.value,
      position: spec.position,
    })),
    qcChecks: row.qcChecks.map(toAdminQcCheck),
    duplicatedFromId: row.duplicatedFromId,
    createdBy: toUserRef(row.createdBy),
    updatedBy: toUserRef(row.updatedBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    publishReadiness: toPublishReadiness(publishRequirementIssues(row)),
  };
}
