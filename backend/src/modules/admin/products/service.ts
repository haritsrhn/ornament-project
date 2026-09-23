/**
 * Aturan tulis produk admin — model domain §6.1 (slug), §6.2 (SKU), §6.3
 * (publikasi, stok, revisi, duplikat), §6.4 (Trash), §6.10 (redirect slug).
 *
 * Semua yang mengubah lebih dari satu tabel berjalan dalam **satu transaksi**:
 * produk + relasinya + `ProductRevision` + `SlugRedirect` + `ActivityLog`.
 * Alasannya bukan sekadar kerapian — snapshot revisi yang tersimpan tanpa
 * perubahannya (atau sebaliknya) membuat riwayat berbohong, dan redirect slug
 * yang gagal tersimpan membuat URL lama mati diam-diam.
 */

import {
  deriveStockStatus,
  PRODUCT_BUSINESS_RULES,
  QC_STAGES,
  stockQuantityConflictsWithStatus,
  type AdminProduct,
  type ProductInput,
  type QcStage,
  type QcStatus,
  type StockStatus,
  type UpdateProductBody,
} from '@ornament/shared';

import { Prisma } from '../../../generated/prisma/client.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, badRequest, businessRuleViolation, conflict } from '../../../lib/errors.js';
import { isUniqueViolation, uniqueConflictFields } from '../../../lib/prisma-error.js';
import { slugify, uniqueCopySlug, uniqueSlug } from '../../../lib/slug.js';
import {
  recordSlugRedirect as recordRedirect,
  releaseSlugRedirect as releaseRedirect,
} from '../slug-redirect.js';
import { resolveTagIds } from '../tags.js';
import {
  adminProductSelect,
  publishRequirementIssues,
  toAdminProduct,
  DEFAULT_LOW_STOCK_THRESHOLD,
  type AdminProductData,
} from './dto.js';

/** Klien di dalam `$transaction`; sengaja bukan `PrismaClient` penuh. */
export type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  name: string;
}

// ── Ambang Low Stock global (model §6.3 Q13) ─────────────────────────────────

/**
 * `SiteSetting.lowStockThreshold`, atau default Prisma bila baris singleton
 * belum ada. Sengaja **tidak** mengarang baris `SiteSetting`: pembuatannya
 * milik modul settings, dan produk tetap harus bisa disimpan tanpanya.
 */
export async function siteLowStockThreshold(client: Tx | PrismaClient): Promise<number> {
  const setting = await client.siteSetting.findUnique({
    where: { id: 1 },
    select: { lowStockThreshold: true },
  });
  return setting?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
}

// ── Validasi referensi (kontrak §5.6: `422 BUSINESS_RULE_VIOLATION`) ─────────

/**
 * Media yang dirujuk konten publik wajib ada dan `PUBLIC` (kontrak §5.6).
 * Dicek di sini, bukan hanya saat render, supaya lampiran inquiry/dokumen
 * pengrajin 🔒 tidak pernah bisa "dipasang" sebagai foto produk.
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
      PRODUCT_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih tidak ditemukan.',
    );
  }
  if (rows.some((row) => row.visibility !== 'PUBLIC')) {
    throw businessRuleViolation(
      PRODUCT_BUSINESS_RULES.PRIVATE_MEDIA_NOT_ALLOWED,
      'Media privat tidak boleh dipakai pada konten publik.',
    );
  }
  if (rows.some((row) => row.deletedAt !== null)) {
    throw businessRuleViolation(
      PRODUCT_BUSINESS_RULES.MEDIA_NOT_FOUND,
      'Salah satu media yang dipilih sudah berada di Trash.',
    );
  }
}

async function assertCategoryExists(tx: Tx, categoryId: string): Promise<void> {
  const category = await tx.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (category === null) {
    throw businessRuleViolation(
      PRODUCT_BUSINESS_RULES.CATEGORY_NOT_FOUND,
      'Kategori yang dipilih tidak ditemukan.',
    );
  }
}

async function assertArtisanExists(tx: Tx, artisanId: string): Promise<void> {
  const artisan = await tx.artisan.findUnique({ where: { id: artisanId }, select: { id: true } });
  if (artisan === null) {
    throw businessRuleViolation(
      PRODUCT_BUSINESS_RULES.ARTISAN_NOT_FOUND,
      'Pengrajin yang dipilih tidak ditemukan.',
    );
  }
}

async function assertMaterialsExist(tx: Tx, materialIds: readonly string[]): Promise<void> {
  if (materialIds.length === 0) return;
  const found = await tx.material.count({ where: { id: { in: [...materialIds] } } });
  if (found !== new Set(materialIds).size) {
    throw businessRuleViolation(
      PRODUCT_BUSINESS_RULES.MATERIAL_NOT_FOUND,
      'Salah satu material yang dipilih tidak ditemukan.',
    );
  }
}

// ── Slug & SKU unik (model §6.1, §6.2) ───────────────────────────────────────

/** Unik **termasuk baris di Trash** (§6.1), jadi tanpa filter `deletedAt`. */
async function slugTaken(tx: Tx, slug: string, exceptId?: string): Promise<boolean> {
  const row = await tx.product.findUnique({ where: { slug }, select: { id: true } });
  return row !== null && row.id !== exceptId;
}

export async function resolveProductSlug(
  tx: Tx,
  input: { requested?: string | undefined; name: string },
  exceptId?: string,
): Promise<string> {
  // Slug eksplisit dari Editor+ tidak pernah diberi akhiran diam-diam: kalau
  // bentrok, yang benar adalah memberi tahu (`409 CONFLICT`), bukan menyimpan
  // URL lain daripada yang diketik.
  if (input.requested !== undefined) {
    if (await slugTaken(tx, input.requested, exceptId)) throw conflict(['slug']);
    return input.requested;
  }
  return uniqueSlug(slugify(input.name), (candidate) => slugTaken(tx, candidate, exceptId));
}

async function assertSkuFree(tx: Tx, sku: string, exceptId?: string): Promise<void> {
  const row = await tx.product.findUnique({ where: { sku }, select: { id: true } });
  if (row !== null && row.id !== exceptId) throw conflict(['sku']);
}

/**
 * Menerjemahkan pelanggaran unik yang lolos pemeriksaan di atas (dua request
 * bersamaan) menjadi `409 CONFLICT` sesuai kontrak, bukan `500`.
 */
export function asConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw conflict(uniqueConflictFields(error, ['slug']));
  throw error;
}

// ── Redirect slug lama (model §6.10, Q8) ─────────────────────────────────────

/** Aturannya sama untuk produk dan artikel; lihat `modules/admin/slug-redirect.ts`. */
export const recordSlugRedirect = (
  tx: Tx,
  productId: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> => recordRedirect(tx, 'PRODUCT', productId, oldSlug, newSlug);

const releaseRedirectFor = (tx: Tx, slug: string): Promise<void> =>
  releaseRedirect(tx, 'PRODUCT', slug);

// ── Stok (model §6.3 Q13, A11) ───────────────────────────────────────────────

export interface StockFields {
  stockStatusOverride: StockStatus | null;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
}

/**
 * Status stok turunan + validasi A11. `400 VALIDATION_FAILED` (bukan 422)
 * karena kontrak §5.6 menyebutnya sebagai kegagalan bentuk input.
 */
export function computeStockStatus(fields: StockFields, siteThreshold: number): StockStatus {
  const input = {
    stockStatusOverride: fields.stockStatusOverride,
    stockQuantity: fields.stockQuantity,
    effectiveLowStockThreshold: fields.lowStockThreshold ?? siteThreshold,
  };
  if (stockQuantityConflictsWithStatus(input)) {
    throw new AppError('VALIDATION_FAILED', 'Beberapa field tidak valid.', {
      details: [
        {
          path: 'stockQuantity',
          code: 'invalid_value',
          message: 'Produk dengan status Made to Order tidak boleh punya jumlah stok.',
        },
      ],
    });
  }
  return deriveStockStatus(input);
}

// ── Snapshot revisi (model §6.3) ─────────────────────────────────────────────

/**
 * Menulis `ProductRevision` **sesudah** perubahan, memakai DTO yang sama
 * dengan respons. Snapshot karena itu selalu bisa dibaca ulang dengan kontrak
 * yang sama, tanpa perlu menebak bentuk baris Prisma versi lama.
 */
export async function writeRevisionSnapshot(
  tx: Tx,
  productId: string,
  editedById: string | null,
  siteThreshold: number,
  mediaPublicUrl: string | undefined,
): Promise<AdminProduct> {
  const row = (await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: adminProductSelect,
  })) as unknown as AdminProductData;
  const dto = toAdminProduct(row, siteThreshold, mediaPublicUrl);

  await tx.productRevision.upsert({
    where: { productId_number: { productId, number: row.revision } },
    create: {
      productId,
      number: row.revision,
      snapshot: dto,
      editedById,
    },
    // Idempoten: menyimpan tanpa menaikkan revisi (isi tidak berubah) hanya
    // menyegarkan snapshot yang sudah ada, bukan menggagalkan request.
    update: { snapshot: dto, editedById },
    select: { id: true },
  });
  return dto;
}

// ── ActivityLog (model §6.9: transaksi yang sama) ────────────────────────────

export async function logProductActivity(
  tx: Tx,
  actorId: string | null,
  action: string,
  message: string,
  productId: string,
  kind: 'PRODUCT' | 'QC' = 'PRODUCT',
): Promise<void> {
  await tx.activityLog.create({
    data: { kind, action, message, actorId, entityType: 'Product', entityId: productId },
    select: { id: true },
  });
}

// ── Menyusun data tulis dari `ProductInput` ──────────────────────────────────

type ProductWrite = Omit<ProductInput, 'slug' | 'materials' | 'tags' | 'images' | 'specs'>;

/**
 * Field skalar yang ikut `INSERT`/`UPDATE` bila dikirim (kontrak §1.3: PATCH
 * parsial). `?: T | undefined` eksplisit karena `exactOptionalPropertyTypes`
 * membedakan "tidak dikirim" dari "dikirim sebagai undefined".
 */
type PartialProductWrite = { [K in keyof ProductWrite]?: ProductWrite[K] | undefined };

function scalarData(input: PartialProductWrite): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  const set = (key: keyof ProductWrite): void => {
    if (input[key] !== undefined) {
      (data as Record<string, unknown>)[key] = input[key];
    }
  };
  set('name');
  set('sku');
  set('excerpt');
  set('categoryId');
  set('artisanId');
  set('moqQuantity');
  set('moqUnit');
  set('leadTimeDays');
  set('lengthCm');
  set('widthCm');
  set('heightCm');
  set('weightKg');
  set('fobPriceUsd');
  set('fobPort');
  set('stockQuantity');
  set('stockStatusOverride');
  set('lowStockThreshold');
  set('stockNote');
  set('primaryImageId');
  // `description` bertipe Json: `null` di Prisma Json berarti "JSON null",
  // yang di sini memang artinya "dikosongkan" (kontrak §1.3).
  if (input.description !== undefined) {
    data.description = input.description ?? Prisma.DbNull;
  }
  return data;
}

/** Mengganti seluruh isi relasi array bila field-nya dikirim (kontrak §1.3). */
async function syncRelations(
  tx: Tx,
  productId: string,
  input: {
    materials?: { materialId: string; isPrimary: boolean }[] | undefined;
    tags?: string[] | undefined;
    images?: string[] | undefined;
    specs?: { label: string; value: string }[] | undefined;
  },
): Promise<void> {
  if (input.materials !== undefined) {
    await assertMaterialsExist(
      tx,
      input.materials.map((material) => material.materialId),
    );
    await tx.productMaterial.deleteMany({ where: { productId } });
    if (input.materials.length > 0) {
      await tx.productMaterial.createMany({
        data: input.materials.map((material) => ({
          productId,
          materialId: material.materialId,
          isPrimary: material.isPrimary,
        })),
      });
    }
  }

  if (input.tags !== undefined) {
    const tagIds = await resolveTagIds(tx, input.tags);
    await tx.productTag.deleteMany({ where: { productId } });
    if (tagIds.length > 0) {
      await tx.productTag.createMany({ data: tagIds.map((tagId) => ({ productId, tagId })) });
    }
  }

  if (input.images !== undefined) {
    await assertUsableMedia(tx, input.images);
    await tx.productImage.deleteMany({ where: { productId } });
    if (input.images.length > 0) {
      await tx.productImage.createMany({
        data: input.images.map((mediaId, position) => ({ productId, mediaId, position })),
      });
    }
  }

  if (input.specs !== undefined) {
    await tx.productSpec.deleteMany({ where: { productId } });
    if (input.specs.length > 0) {
      await tx.productSpec.createMany({
        data: input.specs.map((spec, position) => ({
          productId,
          label: spec.label,
          value: spec.value,
          position,
        })),
      });
    }
  }
}

/** Empat baris QC dibuat bersamaan dengan produk (model §3.5). */
function qcChecksCreate(): Prisma.ProductQcCheckCreateWithoutProductInput[] {
  return QC_STAGES.map((stage) => ({ stage, status: 'PENDING' as const }));
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateProductOptions {
  actor: Actor;
  /** Contributor tidak boleh mengirim `slug` (kontrak §5.6 `403 FORBIDDEN_FIELD`). */
  input: ProductInput;
  mediaPublicUrl: string | undefined;
}

export async function createProduct(
  prisma: PrismaClient,
  { actor, input, mediaPublicUrl }: CreateProductOptions,
): Promise<AdminProduct> {
  return prisma
    .$transaction(async (tx) => {
      await assertCategoryExists(tx, input.categoryId);
      if (input.artisanId !== undefined && input.artisanId !== null) {
        await assertArtisanExists(tx, input.artisanId);
      }
      await assertUsableMedia(
        tx,
        input.primaryImageId === undefined || input.primaryImageId === null
          ? []
          : [input.primaryImageId],
      );

      const slug = await resolveProductSlug(tx, { requested: input.slug, name: input.name });
      const sku = input.sku ?? null;
      if (sku !== null) await assertSkuFree(tx, sku);

      const threshold = await siteLowStockThreshold(tx);
      const stockStatus = computeStockStatus(
        {
          stockStatusOverride: input.stockStatusOverride ?? null,
          stockQuantity: input.stockQuantity ?? null,
          lowStockThreshold: input.lowStockThreshold ?? null,
        },
        threshold,
      );

      const created = await tx.product.create({
        data: {
          ...(scalarData(input) as Prisma.ProductUncheckedCreateInput),
          name: input.name,
          slug,
          sku,
          categoryId: input.categoryId,
          moqQuantity: input.moqQuantity,
          moqUnit: input.moqUnit,
          stockStatus,
          publishStatus: 'DRAFT',
          revision: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });
      // Relasi ditulis berurutan, bukan sebagai nested write: interpreter
      // Prisma menjalankan nested write secara paralel di atas **satu**
      // koneksi transaksi, yang membuat driver pg mengantre query dan
      // memperingatkan deprecation.
      await tx.productQcCheck.createMany({
        data: qcChecksCreate().map((check) => ({ ...check, productId: created.id })),
      });

      // Slug baru mungkin tercatat sebagai redirect lama milik produk lain:
      // slug aktif selalu menang (§6.10).
      await releaseRedirectFor(tx, slug);
      await syncRelations(tx, created.id, input);

      await logProductActivity(
        tx,
        actor.id,
        'product.created',
        `Produk "${input.name}" dibuat sebagai draf`,
        created.id,
      );
      return writeRevisionSnapshot(tx, created.id, actor.id, threshold, mediaPublicUrl);
    })
    .catch(asConflict);
}

// ── Update ───────────────────────────────────────────────────────────────────

export const editConflict = (current: {
  revision: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
}): AppError =>
  new AppError('EDIT_CONFLICT', 'Produk sudah diubah orang lain. Muat ulang sebelum menyimpan.', {
    details: {
      currentRevision: current.revision,
      updatedAt: current.updatedAt.toISOString(),
      updatedBy: current.updatedBy,
    },
  });

export interface UpdateProductOptions {
  actor: Actor;
  productId: string;
  body: UpdateProductBody;
  mediaPublicUrl: string | undefined;
}

/**
 * Field yang benar-benar mengubah isi produk. Dipakai untuk memutuskan apakah
 * `revision` naik: kontrak §5.6 menyebut "tanpa perubahan → revisi tetap",
 * supaya menekan Simpan dua kali tidak memalsukan riwayat.
 */
function hasContentChange(body: UpdateProductBody): boolean {
  return Object.keys(body).some((key) => key !== 'expectedRevision');
}

export async function updateProduct(
  prisma: PrismaClient,
  { actor, productId, body, mediaPublicUrl }: UpdateProductOptions,
): Promise<AdminProduct> {
  const { expectedRevision, slug: requestedSlug, ...input } = body;

  return prisma
    .$transaction(async (tx) => {
      const current = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: {
          id: true,
          slug: true,
          name: true,
          revision: true,
          updatedAt: true,
          publishStatus: true,
          deletedAt: true,
          stockStatusOverride: true,
          stockQuantity: true,
          lowStockThreshold: true,
          updatedBy: { select: { id: true, name: true } },
        },
      });

      if (current.deletedAt !== null) {
        throw new AppError('INVALID_STATE', 'Produk di Trash tidak dapat diubah.', {
          details: { current: 'TRASHED', allowed: ['DRAFT', 'PUBLISHED'] },
        });
      }
      if (current.revision !== expectedRevision) throw editConflict(current);

      if (input.categoryId !== undefined) await assertCategoryExists(tx, input.categoryId);
      if (input.artisanId !== undefined && input.artisanId !== null) {
        await assertArtisanExists(tx, input.artisanId);
      }
      if (input.primaryImageId !== undefined && input.primaryImageId !== null) {
        await assertUsableMedia(tx, [input.primaryImageId]);
      }

      const nextSlug =
        requestedSlug === undefined
          ? current.slug
          : await resolveProductSlug(
              tx,
              { requested: requestedSlug, name: current.name },
              productId,
            );

      if (input.sku !== undefined && input.sku !== null) {
        await assertSkuFree(tx, input.sku, productId);
      }

      const threshold = await siteLowStockThreshold(tx);
      const stockStatus = computeStockStatus(
        {
          stockStatusOverride:
            input.stockStatusOverride === undefined
              ? current.stockStatusOverride
              : input.stockStatusOverride,
          stockQuantity:
            input.stockQuantity === undefined ? current.stockQuantity : input.stockQuantity,
          lowStockThreshold:
            input.lowStockThreshold === undefined
              ? current.lowStockThreshold
              : input.lowStockThreshold,
        },
        threshold,
      );

      const bumped = hasContentChange(body);
      await tx.product.update({
        where: { id: productId },
        data: {
          ...scalarData(input),
          slug: nextSlug,
          stockStatus,
          updatedById: actor.id,
          ...(bumped ? { revision: { increment: 1 } } : {}),
        },
        select: { id: true },
      });

      if (nextSlug !== current.slug) {
        await recordSlugRedirect(tx, productId, current.slug, nextSlug);
      }
      await syncRelations(tx, productId, input);

      // Produk yang sedang tayang tidak boleh diturunkan menjadi tidak layak
      // tayang lewat pintu belakang `PATCH` (kontrak §5.6).
      if (current.publishStatus === 'PUBLISHED') await assertPublishable(tx, productId);

      if (bumped) {
        await logProductActivity(
          tx,
          actor.id,
          'product.updated',
          `Produk "${input.name ?? current.name}" disimpan`,
          productId,
        );
      }
      return writeRevisionSnapshot(tx, productId, actor.id, threshold, mediaPublicUrl);
    })
    .catch(asConflict);
}

// ── Publikasi (model §6.3) ───────────────────────────────────────────────────

export const publishRequirementsNotMet = (issues: { path: string; code: string }[]): AppError =>
  new AppError(
    'PUBLISH_REQUIREMENTS_NOT_MET',
    'Produk belum memenuhi syarat terbit. Lengkapi field yang kurang.',
    { details: issues },
  );

/** Melempar `422` bila produk (sesudah perubahan) tidak layak tayang. */
export async function assertPublishable(tx: Tx, productId: string): Promise<void> {
  const row = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      name: true,
      sku: true,
      categoryId: true,
      artisanId: true,
      primaryImageId: true,
      moqQuantity: true,
      materials: { select: { isPrimary: true } },
      artisan: { select: { archivedAt: true } },
    },
  });
  const issues = publishRequirementIssues(row);
  if (issues.length > 0) throw publishRequirementsNotMet(issues);
}

export const invalidState = (message: string, current: string, allowed: string[]): AppError =>
  new AppError('INVALID_STATE', message, { details: { current, allowed } });

export async function publishProduct(
  prisma: PrismaClient,
  options: {
    actor: Actor;
    productId: string;
    expectedRevision?: number | undefined;
    mediaPublicUrl: string | undefined;
  },
): Promise<AdminProduct> {
  const { actor, productId, expectedRevision, mediaPublicUrl } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        name: true,
        revision: true,
        updatedAt: true,
        publishStatus: true,
        publishedAt: true,
        deletedAt: true,
        updatedBy: { select: { id: true, name: true } },
      },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Produk di Trash tidak dapat diterbitkan.', 'TRASHED', ['DRAFT']);
    }
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      throw editConflict(current);
    }
    await assertPublishable(tx, productId);

    await tx.product.update({
      where: { id: productId },
      data: {
        publishStatus: 'PUBLISHED',
        // Diisi saat **pertama kali** publish; publikasi ulang tidak memundurkan
        // urutan katalog publik (`-publishedAt`).
        ...(current.publishedAt === null ? { publishedAt: new Date() } : {}),
        updatedById: actor.id,
      },
      select: { id: true },
    });
    await logProductActivity(
      tx,
      actor.id,
      'product.published',
      `Produk "${current.name}" diterbitkan`,
      productId,
    );
    const threshold = await siteLowStockThreshold(tx);
    return writeRevisionSnapshot(tx, productId, actor.id, threshold, mediaPublicUrl);
  });
}

export async function unpublishProduct(
  prisma: PrismaClient,
  options: { actor: Actor; productId: string; mediaPublicUrl: string | undefined },
): Promise<AdminProduct> {
  const { actor, productId, mediaPublicUrl } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, publishStatus: true, deletedAt: true },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Produk di Trash tidak dapat diubah.', 'TRASHED', ['PUBLISHED']);
    }
    if (current.publishStatus !== 'PUBLISHED') {
      throw invalidState('Produk ini bukan produk terbit.', current.publishStatus, ['PUBLISHED']);
    }

    await tx.product.update({
      where: { id: productId },
      // `publishedAt` dipertahankan (§6.4): ia adalah jejak kapan produk
      // pernah tayang, bukan penanda status sekarang.
      data: { publishStatus: 'DRAFT', updatedById: actor.id },
      select: { id: true },
    });
    await logProductActivity(
      tx,
      actor.id,
      'product.unpublished',
      `Produk "${current.name}" dijadikan draf`,
      productId,
    );
    const threshold = await siteLowStockThreshold(tx);
    return writeRevisionSnapshot(tx, productId, actor.id, threshold, mediaPublicUrl);
  });
}

// ── Trash, restore, purge (model §6.4) ───────────────────────────────────────

export async function trashProduct(
  prisma: PrismaClient,
  options: { actor: Actor; productId: string },
): Promise<{ id: string; deletedAt: Date }> {
  const { actor, productId } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, deletedAt: true, publishStatus: true },
    });
    if (current.deletedAt !== null) {
      throw invalidState('Produk ini sudah berada di Trash.', 'TRASHED', ['DRAFT', 'PUBLISHED']);
    }

    const updated = await tx.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), updatedById: actor.id },
      select: { id: true, deletedAt: true },
    });
    await logProductActivity(
      tx,
      actor.id,
      'product.trashed',
      `Produk "${current.name}" dipindahkan ke Trash`,
      productId,
    );
    /* c8 ignore next */
    if (updated.deletedAt === null) throw new Error('deletedAt tidak terisi setelah trash');
    return { id: updated.id, deletedAt: updated.deletedAt };
  });
}

export async function restoreProduct(
  prisma: PrismaClient,
  options: { actor: Actor; productId: string; mediaPublicUrl: string | undefined },
): Promise<AdminProduct> {
  const { actor, productId, mediaPublicUrl } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, slug: true, deletedAt: true, publishStatus: true },
    });
    if (current.deletedAt === null) {
      throw invalidState('Produk ini tidak berada di Trash.', current.publishStatus, ['TRASHED']);
    }

    await tx.product.update({
      where: { id: productId },
      // **Selalu** kembali ke DRAFT (Q3/§6.4): konten usang tidak boleh tayang
      // lagi tanpa diperiksa ulang. Inilah alasan Contributor boleh memulihkan
      // miliknya sendiri tanpa izin terbit.
      data: { deletedAt: null, publishStatus: 'DRAFT', updatedById: actor.id },
      select: { id: true },
    });
    await releaseRedirectFor(tx, current.slug);
    await logProductActivity(
      tx,
      actor.id,
      'product.restored',
      `Produk "${current.name}" dipulihkan sebagai draf`,
      productId,
    );
    const threshold = await siteLowStockThreshold(tx);
    return writeRevisionSnapshot(tx, productId, actor.id, threshold, mediaPublicUrl);
  });
}

export async function purgeProduct(
  prisma: PrismaClient,
  options: { actor: Actor; productId: string },
): Promise<void> {
  const { actor, productId } = options;
  await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { name: true, deletedAt: true, publishStatus: true },
    });
    if (current.deletedAt === null) {
      throw invalidState(
        'Hanya produk di Trash yang bisa dihapus permanen.',
        current.publishStatus,
        ['TRASHED'],
      );
    }

    // Log ditulis **sebelum** baris hilang: `entityId` sengaja dibiarkan
    // menunjuk id yang sudah tidak ada (relasi polimorfik tanpa FK, §3.8),
    // supaya jejak penghapusan tidak ikut terhapus.
    await logProductActivity(
      tx,
      actor.id,
      'product.purged',
      `Produk "${current.name}" dihapus permanen`,
      productId,
    );
    // `SlugRedirect` ikut terhapus (Cascade, §6.4: redirect entitas yang
    // di-purge ikut terhapus).
    await tx.product.delete({ where: { id: productId }, select: { id: true } });
  });
}

// ── Duplikat (model §6.3) ────────────────────────────────────────────────────

export async function duplicateProduct(
  prisma: PrismaClient,
  options: { actor: Actor; productId: string; mediaPublicUrl: string | undefined },
): Promise<AdminProduct> {
  const { actor, productId, mediaPublicUrl } = options;
  return prisma
    .$transaction(async (tx) => {
      const source = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        select: {
          name: true,
          slug: true,
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
          stockQuantity: true,
          stockStatusOverride: true,
          lowStockThreshold: true,
          stockNote: true,
          primaryImageId: true,
          materials: { select: { materialId: true, isPrimary: true } },
          tags: { select: { tagId: true } },
          images: { orderBy: { position: 'asc' }, select: { mediaId: true, position: true } },
          specs: {
            orderBy: { position: 'asc' },
            select: { label: true, value: true, position: true },
          },
          qcChecks: { select: { stage: true, criteria: true } },
        },
      });

      const name = `${source.name} (copy)`.slice(0, 160);
      const slug = await uniqueCopySlug(source.slug, (candidate) => slugTaken(tx, candidate));
      const threshold = await siteLowStockThreshold(tx);

      const copy = await tx.product.create({
        data: {
          name,
          slug,
          // SKU unik, jadi duplikat lahir tanpa SKU dan diisi ulang lewat
          // saran sebelum publish (§6.3).
          sku: null,
          description:
            source.description === null
              ? Prisma.DbNull
              : (source.description as Prisma.InputJsonValue),
          excerpt: source.excerpt,
          categoryId: source.categoryId,
          artisanId: source.artisanId,
          moqQuantity: source.moqQuantity,
          moqUnit: source.moqUnit,
          leadTimeDays: source.leadTimeDays,
          lengthCm: source.lengthCm,
          widthCm: source.widthCm,
          heightCm: source.heightCm,
          weightKg: source.weightKg,
          fobPriceUsd: source.fobPriceUsd,
          fobPort: source.fobPort,
          stockQuantity: source.stockQuantity,
          stockStatusOverride: source.stockStatusOverride,
          lowStockThreshold: source.lowStockThreshold,
          stockNote: source.stockNote,
          primaryImageId: source.primaryImageId,
          stockStatus: computeStockStatus(source, threshold),
          publishStatus: 'DRAFT',
          publishedAt: null,
          revision: 1,
          duplicatedFromId: productId,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });

      // Checklist QC **direset** ke PENDING (Q6): hasil pemeriksaan milik
      // barang yang sudah dibuat, bukan milik salinan yang belum ada.
      // `criteria` ikut disalin karena ia bagian isi produk, bukan hasil.
      await tx.productQcCheck.createMany({
        data: QC_STAGES.map((stage) => ({
          productId: copy.id,
          stage,
          status: 'PENDING' as const,
          criteria: source.qcChecks.find((check) => check.stage === stage)?.criteria ?? null,
        })),
      });
      if (source.materials.length > 0) {
        await tx.productMaterial.createMany({
          data: source.materials.map((material) => ({
            productId: copy.id,
            materialId: material.materialId,
            isPrimary: material.isPrimary,
          })),
        });
      }
      if (source.tags.length > 0) {
        await tx.productTag.createMany({
          data: source.tags.map((tag) => ({ productId: copy.id, tagId: tag.tagId })),
        });
      }
      if (source.images.length > 0) {
        await tx.productImage.createMany({
          data: source.images.map((image) => ({
            productId: copy.id,
            mediaId: image.mediaId,
            position: image.position,
          })),
        });
      }
      if (source.specs.length > 0) {
        await tx.productSpec.createMany({
          data: source.specs.map((spec) => ({
            productId: copy.id,
            label: spec.label,
            value: spec.value,
            position: spec.position,
          })),
        });
      }

      await releaseRedirectFor(tx, slug);
      await logProductActivity(
        tx,
        actor.id,
        'product.duplicated',
        `Produk "${source.name}" diduplikasi sebagai draf "${name}"`,
        copy.id,
      );
      return writeRevisionSnapshot(tx, copy.id, actor.id, threshold, mediaPublicUrl);
    })
    .catch(asConflict);
}

// ── QC (kontrak §5.6) ────────────────────────────────────────────────────────

export async function updateQcCheck(
  prisma: PrismaClient,
  options: {
    actor: Actor;
    productId: string;
    stage: QcStage;
    body: {
      status?: QcStatus | undefined;
      criteria?: string | null | undefined;
      notes?: string | null | undefined;
    };
  },
) {
  const { actor, productId, stage, body } = options;
  return prisma.$transaction(async (tx) => {
    const current = await tx.productQcCheck.findUnique({
      where: { productId_stage: { productId, stage } },
      select: { id: true, status: true },
    });
    /* c8 ignore next */
    if (current === null) throw badRequest('Checklist QC tahap ini belum ada untuk produk ini.');

    const statusChanged = body.status !== undefined && body.status !== current.status;
    const updated = await tx.productQcCheck.update({
      where: { id: current.id },
      data: {
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.criteria === undefined ? {} : { criteria: body.criteria }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        // `checkedBy`/`checkedAt` hanya berubah saat **status** berubah
        // (kontrak §5.6): memperbaiki kalimat kriteria bukan pemeriksaan baru.
        ...(statusChanged ? { checkedById: actor.id, checkedAt: new Date() } : {}),
      },
      select: {
        stage: true,
        status: true,
        criteria: true,
        notes: true,
        checkedAt: true,
        checkedBy: { select: { id: true, name: true } },
      },
    });

    if (statusChanged) {
      // Tidak menaikkan `revision` (kontrak §5.6): QC adalah catatan proses,
      // bukan isi produk.
      await logProductActivity(
        tx,
        actor.id,
        'product.qc_updated',
        `QC tahap ${stage} menjadi ${updated.status}`,
        productId,
        'QC',
      );
    }
    return updated;
  });
}
