import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Fixture katalog untuk tes `/v1/public/*`.
 *
 * Semua slug diberi sufiks acak supaya berkas tes tidak pernah bentrok satu
 * sama lain maupun dengan data seed, dan `deleteCatalogFixture()` hanya
 * menghapus baris yang dibuatnya sendiri. Tidak ada satu pun assertion yang
 * boleh bergantung pada isi seed dev.
 */

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface CatalogFixtureIds {
  categoryIds: string[];
  materialIds: string[];
  tagIds: string[];
  artisanIds: string[];
  productIds: string[];
}

export function emptyFixtureIds(): CatalogFixtureIds {
  return { categoryIds: [], materialIds: [], tagIds: [], artisanIds: [], productIds: [] };
}

export interface CreateCategoryInput {
  slug: string;
  name?: string;
  parentId?: string | null;
  position?: number;
  description?: string | null;
}

export async function createCategory(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
  input: CreateCategoryInput,
): Promise<string> {
  const category = await prisma.category.create({
    data: {
      slug: input.slug,
      name: input.name ?? input.slug,
      parentId: input.parentId ?? null,
      position: input.position ?? 0,
      description: input.description ?? null,
    },
    select: { id: true },
  });
  ids.categoryIds.push(category.id);
  return category.id;
}

export async function createMaterial(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
  slug: string,
  name = slug,
): Promise<string> {
  const material = await prisma.material.create({ data: { slug, name }, select: { id: true } });
  ids.materialIds.push(material.id);
  return material.id;
}

export async function createTag(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
  slug: string,
): Promise<string> {
  const tag = await prisma.tag.create({ data: { slug, name: slug }, select: { id: true } });
  ids.tagIds.push(tag.id);
  return tag.id;
}

export interface CreateArtisanInput {
  slug: string;
  name?: string;
  status?: 'VERIFICATION' | 'ACTIVE' | 'FULL_CAPACITY';
  archived?: boolean;
  regency?: string;
  province?: string;
  village?: string | null;
  skills?: string[];
  /** Field 🔒 yang harus dibuktikan tidak pernah bocor ke `/public` (kontrak §4). */
  phone?: string;
  address?: string;
  contactName?: string;
  internalNotes?: string;
}

export async function createArtisan(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
  input: CreateArtisanInput,
): Promise<string> {
  const artisan = await prisma.artisan.create({
    data: {
      slug: input.slug,
      name: input.name ?? input.slug,
      status: input.status ?? 'ACTIVE',
      archivedAt: input.archived === true ? new Date() : null,
      regency: input.regency ?? 'Bantul',
      province: input.province ?? 'DI Yogyakarta',
      village: input.village === undefined ? 'Bangunjiwo' : input.village,
      skills: input.skills ?? ['anyaman rotan'],
      summary: 'Ringkasan publik.',
      story: [{ id: 'p1', type: 'paragraph', text: [{ text: 'Cerita publik.' }] }],
      contactName: input.contactName ?? 'Pak Rahasia',
      phone: input.phone ?? '+628123456789',
      address: input.address ?? 'Jl. Rahasia No. 1, RT 03',
      internalNotes: input.internalNotes ?? 'Catatan negosiasi internal.',
      craftsmenCount: 8,
      monthlyCapacity: 600,
      capacityUnit: 'pcs',
      avgLeadTimeDays: 45,
      partnerSinceYear: 2018,
    },
    select: { id: true },
  });
  ids.artisanIds.push(artisan.id);
  return artisan.id;
}

export interface CreateProductInput {
  slug: string;
  name?: string;
  sku?: string;
  categoryId: string;
  artisanId?: string | null;
  /** Material; elemen pertama menjadi material primer. */
  materialIds?: string[];
  tagIds?: string[];
  published?: boolean;
  trashed?: boolean;
  publishedAt?: Date;
  withQcChecks?: boolean;
  withSpecs?: boolean;
  /** Field 🔒 yang harus dibuktikan tidak pernah bocor ke `/public`. */
  stockNote?: string;
  stockQuantity?: number | null;
}

const QC_STAGES = ['MATERIAL', 'FRAME', 'FINISHING', 'PACKAGING'] as const;

export async function createProduct(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
  input: CreateProductInput,
): Promise<string> {
  const published = input.published ?? true;
  const product = await prisma.product.create({
    data: {
      slug: input.slug,
      name: input.name ?? input.slug,
      sku: input.sku ?? `SKU-${input.slug.toUpperCase()}`,
      excerpt: 'Ringkasan kartu.',
      description: [{ id: 'p1', type: 'paragraph', text: [{ text: 'Deskripsi produk.' }] }],
      categoryId: input.categoryId,
      artisanId: input.artisanId ?? null,
      moqQuantity: 50,
      moqUnit: 'pcs',
      leadTimeDays: 45,
      lengthCm: '45.0',
      widthCm: '45.0',
      heightCm: '38.0',
      weightKg: '3.20',
      fobPriceUsd: '42.00',
      fobPort: 'Semarang',
      stockStatus: 'IN_STOCK',
      // 🔒 diisi justru supaya tes bisa membuktikan ia tidak pernah muncul.
      stockStatusOverride: 'IN_STOCK',
      lowStockThreshold: 5,
      stockNote: input.stockNote ?? 'Catatan stok internal.',
      stockQuantity: input.stockQuantity === undefined ? 84 : input.stockQuantity,
      publishStatus: published ? 'PUBLISHED' : 'DRAFT',
      publishedAt: published ? (input.publishedAt ?? new Date()) : null,
      deletedAt: input.trashed === true ? new Date() : null,
      revision: 3,
      materials: {
        create: (input.materialIds ?? []).map((materialId, index) => ({
          materialId,
          isPrimary: index === 0,
        })),
      },
      tags: { create: (input.tagIds ?? []).map((tagId) => ({ tagId })) },
      ...(input.withSpecs === false
        ? {}
        : {
            specs: {
              create: [
                { label: 'Finishing', value: 'Natural clear coat', position: 0 },
                { label: 'Material', value: 'Rotan alami', position: 1 },
              ],
            },
          }),
      ...(input.withQcChecks === false
        ? {}
        : {
            qcChecks: {
              create: QC_STAGES.map((stage) => ({
                stage,
                status: 'PASSED' as const,
                criteria: `Kriteria ${stage}`,
                // 🔒 catatan QC; tidak boleh pernah tampil publik.
                notes: `Catatan QC internal ${stage}`,
              })),
            },
          }),
    },
    select: { id: true },
  });
  ids.productIds.push(product.id);
  return product.id;
}

/** Menghapus fixture; relasi anak ikut lewat `onDelete: Cascade`. */
export async function deleteCatalogFixture(
  prisma: PrismaClient,
  ids: CatalogFixtureIds,
): Promise<void> {
  if (ids.productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
  }
  if (ids.artisanIds.length > 0) {
    await prisma.artisan.deleteMany({ where: { id: { in: ids.artisanIds } } });
  }
  if (ids.tagIds.length > 0) {
    await prisma.tag.deleteMany({ where: { id: { in: ids.tagIds } } });
  }
  if (ids.materialIds.length > 0) {
    await prisma.material.deleteMany({ where: { id: { in: ids.materialIds } } });
  }
  // Kategori anak lebih dulu (FK `Restrict` ke induk).
  for (const id of [...ids.categoryIds].reverse()) {
    await prisma.category.deleteMany({ where: { id } });
  }
}
