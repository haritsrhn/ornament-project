/**
 * Admin produk — kontrak API §5.6 (`/v1/admin/products/*`).
 *
 * Izin dinyatakan lewat `config.adminAccess`; guard sesi + izin dipasang
 * otomatis oleh hook di `modules/auth/guard.ts`, sehingga urutan
 * `401 → 403 → 400 → 404 → 409/422` (kontrak §1.10) berlaku tanpa rute perlu
 * mengaturnya sendiri.
 *
 * Dua lapis izin yang berbeda dipakai bersama:
 * 1. **Matriks §3** lewat `adminPermission(...)` — "peran ini punya tombolnya?"
 * 2. **Kepemilikan/status** lewat `modules/admin/products/access.ts` — "boleh
 *    untuk baris ini?" (Contributor hanya draf miliknya, A1).
 */

import {
  adminProductResponseSchema,
  adminProductsQuerySchema,
  adminProductsResponseSchema,
  adminQcCheckResponseSchema,
  idempotencyKeySchema,
  IDEMPOTENT_REPLAYED_HEADER,
  PRODUCT_EDITOR_ONLY_FIELDS,
  productBulkBodySchema,
  productBulkResponseSchema,
  productIdParamsSchema,
  productInputSchema,
  productQcParamsSchema,
  productRevisionParamsSchema,
  productRevisionResponseSchema,
  productRevisionsResponseSchema,
  productTrashedResponseSchema,
  publishProductBodySchema,
  roleHasPermission,
  skuSuggestionBodySchema,
  skuSuggestionResponseSchema,
  updateProductBodySchema,
  updateProductQcBodySchema,
  type AdminProduct,
  type AdminProductsQuery,
  type BulkResult,
  type PageMeta,
  type Permission,
  type ProductBulkAction,
  type ProductRevisionDetail,
  type StockStatus,
} from '@ornament/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { AppError, isAppError, notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { withIdempotency } from '../../../lib/idempotency.js';
import { escapeLike } from '../../../lib/like.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import { adminPermission, adminSession, currentSession } from '../../auth/guard.js';
import { assertCanReadRevisions, assertCanRestore, assertCanWrite } from './access.js';
import {
  adminProductRowSelect,
  adminProductSelect,
  toAdminProduct,
  toAdminProductRow,
  toAdminQcCheck,
  type AdminProductData,
  type AdminProductRowData,
} from './dto.js';
import {
  createProduct,
  duplicateProduct,
  publishProduct,
  purgeProduct,
  restoreProduct,
  siteLowStockThreshold,
  trashProduct,
  unpublishProduct,
  updateProduct,
  updateQcCheck,
} from './service.js';
import { buildSkuSuggestion, DEFAULT_TIMEZONE, nextSkuSequence } from './sku.js';

/**
 * Aktor aksi admin. Menggabungkan apa yang dibutuhkan dua lapis berbeda:
 * `role` untuk batas kepemilikan (`access.ts`) dan `name` untuk pesan
 * `ActivityLog` (`service.ts`).
 */
export interface AdminActor {
  id: string;
  name: string;
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

export interface AdminProductsRoutesOptions {
  /** Basis URL publik R2 untuk `MediaRef.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/**
 * `Idempotency-Key` **opsional** (kontrak §1.8: "disarankan" untuk duplicate
 * dan bulk). `looseObject` karena hasil validasi header menggantikan
 * `request.headers`, jadi header lain harus lolos apa adanya.
 */
const optionalIdempotencyHeadersSchema = z.looseObject({
  'idempotency-key': idempotencyKeySchema.optional(),
});

/** `where` daftar; `trashed` dipisah agar `counts` bisa mengabaikan filter tab. */
function baseWhere(query: AdminProductsQuery): Prisma.ProductWhereInput {
  const q = query.q === undefined ? undefined : escapeLike(query.q);
  return {
    ...(query.publishStatus === undefined ? {} : { publishStatus: query.publishStatus }),
    ...(query.stockStatus === undefined ? {} : { stockStatus: query.stockStatus }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.artisanId === undefined ? {} : { artisanId: query.artisanId }),
    // "Material mana pun" (kontrak §5.6), bukan hanya material primer.
    ...(query.materialId === undefined
      ? {}
      : { materials: { some: { materialId: query.materialId } } }),
    ...(query.regency === undefined ? {} : { artisan: { is: { regency: query.regency } } }),
    ...(q === undefined
      ? {}
      : {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { sku: { contains: q, mode: 'insensitive' } },
            { materials: { some: { material: { name: { contains: q, mode: 'insensitive' } } } } },
            { artisan: { is: { regency: { contains: q, mode: 'insensitive' } } } },
          ],
        }),
  };
}

/** Allowlist sort §1.7; tie-breaker `id` selalu ditambahkan server. */
function orderBy(sort: AdminProductsQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ name: 'asc' }, { id: 'asc' }];
    case 'sku':
      return [{ sku: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    case '-publishedAt':
      return [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    default:
      return [{ updatedAt: 'desc' }, { id: 'asc' }];
  }
}

export const adminProductsRoutes: FastifyPluginAsyncZod<AdminProductsRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;
  const rateLimit = adminRateLimit();

  /**
   * Rute baca: semua peran boleh (kontrak §3.2 "baca produk ✓✓✓"), jadi
   * penandanya `adminSession()` — bukan izin tulis yang kebetulan dimiliki
   * ketiga peran, yang akan menyesatkan pembaca rute.
   */
  const readAccess = { adminAccess: adminSession(), ...rateLimit };
  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): AdminActor => {
    const { user } = currentSession(request);
    return { id: user.id, name: user.name, role: user.role };
  };

  /** Produk apa pun, termasuk yang di Trash (kontrak §5.6 `GET /:id`). */
  async function loadProduct(id: string): Promise<AdminProductData> {
    const row = await app.prisma.product.findUnique({ where: { id }, select: adminProductSelect });
    if (row === null) throw notFound('Produk tidak ditemukan.');
    return row;
  }

  /** Bentuk ringkas untuk pemeriksaan kepemilikan sebelum aksi tulis. */
  async function loadOwnership(id: string) {
    const row = await app.prisma.product.findUnique({
      where: { id },
      select: { id: true, publishStatus: true, createdById: true, deletedAt: true },
    });
    if (row === null) throw notFound('Produk tidak ditemukan.');
    return row;
  }

  async function respondProduct(id: string) {
    const [row, threshold] = await Promise.all([
      loadProduct(id),
      siteLowStockThreshold(app.prisma),
    ]);
    return ok(toAdminProduct(row, threshold, mediaPublicUrl));
  }

  // ── Daftar ─────────────────────────────────────────────────────────────────

  app.get(
    '/admin/products',
    {
      config: readAccess,
      schema: {
        querystring: adminProductsQuerySchema,
        response: { 200: adminProductsResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const filters = baseWhere(query);
      // Default hanya baris hidup; `trashed=true` **hanya** baris di Trash (§1.7).
      const where: Prisma.ProductWhereInput = {
        ...filters,
        deletedAt: query.trashed ? { not: null } : null,
      };

      const [rows, total, live, trash] = await Promise.all([
        app.prisma.product.findMany({
          where,
          select: adminProductRowSelect,
          orderBy: orderBy(query.sort),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        app.prisma.product.count({ where }),
        // `counts` memakai filter yang sama **kecuali** filter tab itu sendiri
        // (kontrak §1.4), yaitu `publishStatus` dan `trashed`.
        app.prisma.product.groupBy({
          by: ['publishStatus'],
          where: { ...baseWhere({ ...query, publishStatus: undefined }), deletedAt: null },
          _count: { _all: true },
        }),
        app.prisma.product.count({
          where: {
            ...baseWhere({ ...query, publishStatus: undefined }),
            deletedAt: { not: null },
          },
        }),
      ]);

      const counts: Record<string, number> = { all: 0, PUBLISHED: 0, DRAFT: 0, trash };
      let all = 0;
      for (const group of live) {
        counts[group.publishStatus] = group._count._all;
        all += group._count._all;
      }
      counts.all = all;

      const meta: PageMeta = {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        counts,
      };
      return ok(
        (rows as unknown as AdminProductRowData[]).map((row) =>
          toAdminProductRow(row, mediaPublicUrl),
        ),
        meta,
      );
    },
  );

  // ── Saran SKU (didaftarkan sebelum `/:id` agar tidak tertangkap params) ─────

  app.post(
    '/admin/products/sku-suggestions',
    {
      config: access('product.write_draft'),
      schema: {
        body: skuSuggestionBodySchema,
        response: { 200: skuSuggestionResponseSchema },
      },
    },
    async (request) => {
      const { materialId } = request.body;
      let materialSkuCode: string | null = null;
      if (materialId !== undefined && materialId !== null) {
        const material = await app.prisma.material.findUnique({
          where: { id: materialId },
          select: { skuCode: true },
        });
        if (material === null) throw notFound('Material tidak ditemukan.');
        materialSkuCode = material.skuCode;
      }

      const setting = await app.prisma.siteSetting.findUnique({
        where: { id: 1 },
        select: { timezone: true },
      });
      const sequence = await nextSkuSequence(app.prisma);
      return ok({
        sku: buildSkuSuggestion(sequence, {
          materialSkuCode,
          timezone: setting?.timezone ?? DEFAULT_TIMEZONE,
        }),
      });
    },
  );

  // ── Aksi massal (sebelum `/:id` karena `bulk` bukan uuid) ──────────────────

  app.post(
    '/admin/products/bulk',
    {
      config: access('product.write_draft'),
      schema: {
        headers: optionalIdempotencyHeadersSchema,
        body: productBulkBodySchema,
        response: { 200: productBulkResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const body = request.body;
      const key = request.headers['idempotency-key'];

      interface BulkEnvelope {
        data: BulkResult;
      }
      const run = async () => ({
        statusCode: 200,
        body: ok(await runBulk(actor, body)) satisfies BulkEnvelope,
      });
      if (key === undefined) return (await run()).body;

      const result = await withIdempotency(
        app.prisma,
        { scope: 'POST /v1/admin/products/bulk', actor: actor.id, key },
        body,
        run,
      );
      // Pengulangan dengan body identik mengembalikan respons tersimpan apa
      // adanya, ditandai header (kontrak §1.8). Statusnya selalu 200 di rute
      // ini, jadi tidak perlu dibaca ulang dari simpanan.
      if (result.replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return reply.code(200).send(result.body as BulkEnvelope);
    },
  );

  /**
   * Setiap item dicek izinnya sendiri-sendiri dan kegagalannya dikumpulkan
   * (kontrak §5: sukses parsial diizinkan, selalu `200`). Item diproses
   * berurutan, bukan `Promise.all`: aksi massal menulis ke tabel yang sama dan
   * urutan hasil harus bisa diprediksi.
   */
  async function runBulk(
    actor: AdminActor,
    body: { action: ProductBulkAction; ids: string[]; stockStatusOverride?: unknown },
  ): Promise<BulkResult> {
    const result: BulkResult = { succeeded: [], failed: [] };

    for (const id of body.ids) {
      try {
        await runBulkItem(actor, body, id);
        result.succeeded.push(id);
      } catch (error) {
        if (!isAppError(error)) throw error;
        result.failed.push({ id, code: error.code, message: error.message });
      }
    }
    return result;
  }

  async function runBulkItem(
    actor: AdminActor,
    body: { action: ProductBulkAction; ids: string[]; stockStatusOverride?: unknown },
    id: string,
  ): Promise<void> {
    /** Izin per aksi, sama dengan endpoint tunggalnya (kontrak §5.6). */
    const requirePermission = (permission: Permission): void => {
      if (!roleHasPermission(actor.role, permission)) {
        throw new AppError('FORBIDDEN', 'Anda tidak memiliki izin untuk aksi ini.', {
          details: { requiredPermission: permission },
        });
      }
    };

    switch (body.action) {
      case 'PUBLISH': {
        requirePermission('product.publish');
        await publishProduct(app.prisma, { actor, productId: id, mediaPublicUrl });
        return;
      }
      case 'UNPUBLISH': {
        requirePermission('product.publish');
        await unpublishProduct(app.prisma, { actor, productId: id, mediaPublicUrl });
        return;
      }
      case 'TRASH': {
        requirePermission('product.trash');
        assertCanWrite(actor, await loadOwnership(id));
        await trashProduct(app.prisma, { actor, productId: id });
        return;
      }
      case 'RESTORE': {
        requirePermission('product.restore');
        assertCanRestore(actor, await loadOwnership(id));
        await restoreProduct(app.prisma, { actor, productId: id, mediaPublicUrl });
        return;
      }
      case 'PURGE': {
        requirePermission('product.purge');
        await purgeProduct(app.prisma, { actor, productId: id });
        return;
      }
      default: {
        requirePermission('product.write_draft');
        const current = await loadOwnership(id);
        assertCanWrite(actor, current);
        const row = await app.prisma.product.findUniqueOrThrow({
          where: { id },
          select: { revision: true },
        });
        await updateProduct(app.prisma, {
          actor,
          productId: id,
          body: {
            expectedRevision: row.revision,
            stockStatusOverride: body.stockStatusOverride as StockStatus | null,
          },
          mediaPublicUrl,
        });
        return;
      }
    }
  }

  // ── Detail & tulis ─────────────────────────────────────────────────────────

  app.post(
    '/admin/products',
    {
      config: access('product.write_draft'),
      schema: { body: productInputSchema, response: { 201: adminProductResponseSchema } },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      assertNoEditorOnlyFields(actor, request.body);

      const product = await createProduct(app.prisma, {
        actor,
        input: request.body,
        mediaPublicUrl,
      });
      request.log.info({ actorId: actor.id, productId: product.id }, 'produk dibuat');
      return reply.code(201).send(ok(product));
    },
  );

  app.get(
    '/admin/products/:id',
    {
      config: readAccess,
      schema: { params: productIdParamsSchema, response: { 200: adminProductResponseSchema } },
    },
    async (request) => respondProduct(request.params.id),
  );

  app.patch(
    '/admin/products/:id',
    {
      config: access('product.write_draft'),
      schema: {
        params: productIdParamsSchema,
        body: updateProductBodySchema,
        response: { 200: adminProductResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertNoEditorOnlyFields(actor, request.body);
      assertCanWrite(actor, await loadOwnership(request.params.id));

      const product = await updateProduct(app.prisma, {
        actor,
        productId: request.params.id,
        body: request.body,
        mediaPublicUrl,
      });
      return ok(product);
    },
  );

  app.post(
    '/admin/products/:id/publish',
    {
      config: access('product.publish'),
      schema: {
        params: productIdParamsSchema,
        body: publishProductBodySchema,
        response: { 200: adminProductResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      return ok(
        await publishProduct(app.prisma, {
          actor,
          productId: request.params.id,
          expectedRevision: request.body.expectedRevision,
          mediaPublicUrl,
        }),
      );
    },
  );

  app.post(
    '/admin/products/:id/unpublish',
    {
      config: access('product.publish'),
      schema: { params: productIdParamsSchema, response: { 200: adminProductResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      return ok(
        await unpublishProduct(app.prisma, { actor, productId: request.params.id, mediaPublicUrl }),
      );
    },
  );

  app.post(
    '/admin/products/:id/duplicate',
    {
      config: access('product.write_draft'),
      schema: {
        params: productIdParamsSchema,
        headers: optionalIdempotencyHeadersSchema,
        response: { 201: adminProductResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      const key = request.headers['idempotency-key'];

      const run = async () => ({
        statusCode: 201,
        body: ok(
          await duplicateProduct(app.prisma, {
            actor,
            productId: request.params.id,
            mediaPublicUrl,
          }),
        ),
      });

      if (key === undefined) return reply.code(201).send((await run()).body);

      const result = await withIdempotency(
        app.prisma,
        { scope: 'POST /v1/admin/products/:id/duplicate', actor: actor.id, key },
        { productId: request.params.id },
        run,
      );
      if (result.replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return reply.code(201).send(result.body as { data: AdminProduct });
    },
  );

  app.delete(
    '/admin/products/:id',
    {
      config: access('product.trash'),
      schema: { params: productIdParamsSchema, response: { 200: productTrashedResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanWrite(actor, await loadOwnership(request.params.id));
      const trashed = await trashProduct(app.prisma, { actor, productId: request.params.id });
      return ok({ id: trashed.id, deletedAt: trashed.deletedAt.toISOString() });
    },
  );

  app.post(
    '/admin/products/:id/restore',
    {
      config: access('product.restore'),
      schema: { params: productIdParamsSchema, response: { 200: adminProductResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanRestore(actor, await loadOwnership(request.params.id));
      return ok(
        await restoreProduct(app.prisma, { actor, productId: request.params.id, mediaPublicUrl }),
      );
    },
  );

  app.delete(
    '/admin/products/:id/permanent',
    {
      // Administrator saja (A3): tidak bisa dibatalkan.
      config: access('product.purge'),
      schema: { params: productIdParamsSchema },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      await purgeProduct(app.prisma, { actor, productId: request.params.id });
      request.log.info(
        { actorId: actor.id, productId: request.params.id },
        'produk dihapus permanen',
      );
      return reply.code(204).send();
    },
  );

  // ── QC & revisi ────────────────────────────────────────────────────────────

  app.patch(
    '/admin/products/:id/qc/:stage',
    {
      config: access('product.qc'),
      schema: {
        params: productQcParamsSchema,
        body: updateProductQcBodySchema,
        response: { 200: adminQcCheckResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      const check = await updateQcCheck(app.prisma, {
        actor,
        productId: request.params.id,
        stage: request.params.stage,
        body: request.body,
      });
      return ok(toAdminQcCheck(check));
    },
  );

  app.get(
    '/admin/products/:id/revisions',
    {
      config: readAccess,
      schema: { params: productIdParamsSchema, response: { 200: productRevisionsResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanReadRevisions(actor, await loadOwnership(request.params.id));

      const rows = await app.prisma.productRevision.findMany({
        where: { productId: request.params.id },
        orderBy: { number: 'desc' },
        select: {
          number: true,
          createdAt: true,
          editedBy: { select: { id: true, name: true } },
        },
      });
      return ok(
        rows.map((row) => ({
          number: row.number,
          editedBy: row.editedBy,
          createdAt: row.createdAt.toISOString(),
        })),
      );
    },
  );

  app.get(
    '/admin/products/:id/revisions/:number',
    {
      config: readAccess,
      schema: {
        params: productRevisionParamsSchema,
        response: { 200: productRevisionResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanReadRevisions(actor, await loadOwnership(request.params.id));

      const row = await app.prisma.productRevision.findUnique({
        where: {
          productId_number: { productId: request.params.id, number: request.params.number },
        },
        select: {
          number: true,
          snapshot: true,
          createdAt: true,
          editedBy: { select: { id: true, name: true } },
        },
      });
      if (row === null) throw notFound('Revisi tidak ditemukan.');
      return ok({
        number: row.number,
        editedBy: row.editedBy,
        createdAt: row.createdAt.toISOString(),
        snapshot: row.snapshot as ProductRevisionDetail['snapshot'],
      });
    },
  );

  return Promise.resolve();
};

/**
 * `403 FORBIDDEN_FIELD` (kontrak §1.10/§5.6): Contributor boleh memanggil
 * endpoint ini, tetapi tidak boleh menentukan `slug` — URL publik adalah
 * keputusan Editor+ (model §6.1).
 */
function assertNoEditorOnlyFields(actor: AdminActor, body: Record<string, unknown>): void {
  if (actor.role !== 'CONTRIBUTOR') return;
  const sent = PRODUCT_EDITOR_ONLY_FIELDS.filter((field) => body[field] !== undefined);
  if (sent.length > 0) {
    throw new AppError('FORBIDDEN_FIELD', 'Anda tidak boleh mengubah field ini.', {
      details: { fields: [...sent] },
    });
  }
}
