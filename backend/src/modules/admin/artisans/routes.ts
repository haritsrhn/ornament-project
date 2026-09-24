/**
 * Admin pengrajin — kontrak API §5.8 (`/v1/admin/artisans/*`).
 *
 * Izin dinyatakan lewat `config.adminAccess`; guard sesi + izin dipasang
 * otomatis oleh hook di `modules/auth/guard.ts` (urutan §1.10).
 *
 * Yang khas modul ini dibanding produk/artikel: **tidak ada** batas
 * kepemilikan. Matriks §3.1 menempatkan pengrajin sebagai "tulis Editor+,
 * Contributor hanya lihat", jadi pembedanya bukan siapa pemilik barisnya
 * melainkan **bentuk DTO-nya** — Contributor selalu menerima `ArtisanRedacted`
 * tanpa empat field 🔒 dan tanpa akses ke dokumen sama sekali.
 */

import {
  adminArtisanDetailResponseSchema,
  adminArtisanResponseSchema,
  adminArtisansQuerySchema,
  adminArtisansResponseSchema,
  artisanArchivedResponseSchema,
  artisanDocumentInputSchema,
  artisanDocumentParamsSchema,
  artisanDocumentResponseSchema,
  artisanDocumentsResponseSchema,
  artisanDocumentUrlQuerySchema,
  artisanDocumentUrlResponseSchema,
  artisanIdParamsSchema,
  artisanInputSchema,
  ARTISAN_ARCHIVE_WARNINGS,
  ARTISAN_STATUSES,
  MEDIA_DOWNLOAD_TTL_SECONDS,
  roleHasPermission,
  updateArtisanBodySchema,
  updateArtisanDocumentBodySchema,
  type AdminArtisanDetail,
  type AdminArtisansQuery,
  type ArtisanArchiveWarning,
  type PageMeta,
  type Permission,
} from '@ornament/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import { AppError, notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { escapeLike } from '../../../lib/like.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import type { R2 } from '../../../lib/r2.js';
import { adminPermission, adminSession, currentSession } from '../../auth/guard.js';
import {
  adminArtisanRowSelect,
  artisanDocumentOrder,
  artisanDocumentSelect,
  toAdminArtisan,
  toAdminArtisanRow,
  toArtisanDocument,
  toArtisanRedacted,
  type AdminArtisanRowData,
  type ArtisanDocumentData,
} from './dto.js';
import {
  archiveArtisan,
  createArtisan,
  createArtisanDocument,
  deleteArtisanDocument,
  loadArtisanResult,
  unarchiveArtisan,
  updateArtisan,
  type ArtisanResult,
} from './service.js';

export interface AdminArtisansRoutesOptions {
  /** Basis URL publik R2 untuk `MediaRef.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
  /** Penyimpanan objek; `null` → unduhan dokumen privat menjawab `503`. */
  r2?: R2 | null;
}

interface AdminActor {
  id: string;
  name: string;
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

/** `where` daftar; `archived` dipisah agar `counts` bisa mengabaikan filter tab. */
function baseWhere(query: AdminArtisansQuery): Prisma.ArtisanWhereInput {
  const q = query.q === undefined ? undefined : escapeLike(query.q);
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.regency === undefined
      ? {}
      : { regency: { equals: query.regency, mode: 'insensitive' } }),
    ...(q === undefined
      ? {}
      : {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { village: { contains: q, mode: 'insensitive' } },
            { regency: { contains: q, mode: 'insensitive' } },
            // `skills` adalah `String[]`: `has` cocok persis satu elemen, jadi
            // pencarian sebagian ditangani `hasSome` atas nilai yang diketik.
            { skills: { hasSome: [query.q ?? ''] } },
          ],
        }),
  };
}

/** Allowlist sort §1.7; tie-breaker `id` selalu ditambahkan server. */
function orderBy(sort: AdminArtisansQuery['sort']): Prisma.ArtisanOrderByWithRelationInput[] {
  switch (sort) {
    case '-updatedAt':
      return [{ updatedAt: 'desc' }, { id: 'asc' }];
    case '-monthlyCapacity':
      return [{ monthlyCapacity: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    default:
      return [{ name: 'asc' }, { id: 'asc' }];
  }
}

export const adminArtisansRoutes: FastifyPluginAsyncZod<AdminArtisansRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;
  const r2 = options.r2 ?? null;
  const rateLimit = adminRateLimit();

  /** Baca: semua peran (kontrak §3.1 "Mengelola pengrajin: CTR = Lihat"). */
  const readAccess = { adminAccess: adminSession(), ...rateLimit };
  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): AdminActor => {
    const { user } = currentSession(request);
    return { id: user.id, name: user.name, role: user.role };
  };

  /** Satu-satunya tempat yang memutuskan siapa melihat field 🔒 (kontrak §3.1). */
  const toDetail = (result: ArtisanResult, actor: AdminActor): AdminArtisanDetail =>
    roleHasPermission(actor.role, 'artisan.read_private')
      ? toAdminArtisan(result.row, result.publishedProductCount, mediaPublicUrl)
      : toArtisanRedacted(result.row, result.publishedProductCount, mediaPublicUrl);

  async function assertArtisanExists(id: string): Promise<void> {
    const row = await app.prisma.artisan.findUnique({ where: { id }, select: { id: true } });
    if (row === null) throw notFound('Pengrajin tidak ditemukan.');
  }

  // ── Daftar ─────────────────────────────────────────────────────────────────

  app.get(
    '/admin/artisans',
    {
      config: readAccess,
      schema: {
        querystring: adminArtisansQuerySchema,
        response: { 200: adminArtisansResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const filters = baseWhere(query);
      const where: Prisma.ArtisanWhereInput = {
        ...filters,
        archivedAt: query.archived ? { not: null } : null,
      };
      // `counts` memakai filter yang sama **kecuali** filter tab itu sendiri
      // (kontrak §1.4), yaitu `status` dan `archived`.
      const countsWhere = baseWhere({ ...query, status: undefined });

      const [rows, total, live, archived] = await Promise.all([
        app.prisma.artisan.findMany({
          where,
          select: adminArtisanRowSelect,
          orderBy: orderBy(query.sort),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        app.prisma.artisan.count({ where }),
        app.prisma.artisan.groupBy({
          by: ['status'],
          where: { ...countsWhere, archivedAt: null },
          _count: { _all: true },
        }),
        app.prisma.artisan.count({ where: { ...countsWhere, archivedAt: { not: null } } }),
      ]);

      const counts: Record<string, number> = { all: 0, archived };
      for (const status of ARTISAN_STATUSES) counts[status] = 0;
      let all = 0;
      for (const group of live) {
        counts[group.status] = group._count._all;
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
        (rows as unknown as AdminArtisanRowData[]).map((row) =>
          toAdminArtisanRow(row, mediaPublicUrl),
        ),
        meta,
      );
    },
  );

  // ── Detail & tulis ─────────────────────────────────────────────────────────

  app.post(
    '/admin/artisans',
    {
      config: access('artisan.write'),
      schema: { body: artisanInputSchema, response: { 201: adminArtisanResponseSchema } },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const result = await createArtisan(app.prisma, { actor, input: request.body });
      request.log.info({ actorId: actor.id, artisanId: result.row.id }, 'pengrajin dibuat');
      return reply
        .code(201)
        .send(ok(toAdminArtisan(result.row, result.publishedProductCount, mediaPublicUrl)));
    },
  );

  app.get(
    '/admin/artisans/:id',
    {
      config: readAccess,
      schema: {
        params: artisanIdParamsSchema,
        response: { 200: adminArtisanDetailResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const result = await loadArtisanResult(app.prisma, request.params.id);
      return ok(toDetail(result, actor));
    },
  );

  app.patch(
    '/admin/artisans/:id',
    {
      config: access('artisan.write'),
      schema: {
        params: artisanIdParamsSchema,
        body: updateArtisanBodySchema,
        response: { 200: adminArtisanResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      await assertArtisanExists(request.params.id);
      const result = await updateArtisan(app.prisma, {
        actor,
        artisanId: request.params.id,
        body: request.body,
      });
      return ok(toAdminArtisan(result.row, result.publishedProductCount, mediaPublicUrl));
    },
  );

  app.post(
    '/admin/artisans/:id/archive',
    {
      config: access('artisan.write'),
      schema: { params: artisanIdParamsSchema, response: { 200: artisanArchivedResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      await assertArtisanExists(request.params.id);
      const result = await archiveArtisan(app.prisma, { actor, artisanId: request.params.id });

      const warnings: ArtisanArchiveWarning[] =
        result.publishedProductCountAtArchive === 0
          ? []
          : [
              {
                code: ARTISAN_ARCHIVE_WARNINGS.HAS_PUBLISHED_PRODUCTS,
                count: result.publishedProductCountAtArchive,
              },
            ];
      return ok({
        ...toAdminArtisan(result.row, result.publishedProductCount, mediaPublicUrl),
        warnings,
      });
    },
  );

  app.post(
    '/admin/artisans/:id/unarchive',
    {
      config: access('artisan.write'),
      schema: { params: artisanIdParamsSchema, response: { 200: adminArtisanResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      await assertArtisanExists(request.params.id);
      const result = await unarchiveArtisan(app.prisma, { actor, artisanId: request.params.id });
      return ok(toAdminArtisan(result.row, result.publishedProductCount, mediaPublicUrl));
    },
  );

  // ── Dokumen 🔒 (kontrak §5.8; Editor+ saja, model §3.4) ────────────────────

  app.get(
    '/admin/artisans/:id/documents',
    {
      config: access('artisan.read_private'),
      schema: {
        params: artisanIdParamsSchema,
        response: { 200: artisanDocumentsResponseSchema },
      },
    },
    async (request) => {
      await assertArtisanExists(request.params.id);
      const rows = await app.prisma.artisanDocument.findMany({
        where: { artisanId: request.params.id },
        select: artisanDocumentSelect,
        orderBy: artisanDocumentOrder,
      });
      return ok((rows as ArtisanDocumentData[]).map(toArtisanDocument));
    },
  );

  app.post(
    '/admin/artisans/:id/documents',
    {
      config: access('artisan.write'),
      schema: {
        params: artisanIdParamsSchema,
        body: artisanDocumentInputSchema,
        response: { 201: artisanDocumentResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await assertArtisanExists(request.params.id);
      const documentId = await createArtisanDocument(app.prisma, {
        actor,
        artisanId: request.params.id,
        input: request.body,
      });
      const row = await app.prisma.artisanDocument.findUniqueOrThrow({
        where: { id: documentId },
        select: artisanDocumentSelect,
      });
      return reply.code(201).send(ok(toArtisanDocument(row)));
    },
  );

  app.patch(
    '/admin/artisans/:id/documents/:documentId',
    {
      config: access('artisan.write'),
      schema: {
        params: artisanDocumentParamsSchema,
        body: updateArtisanDocumentBodySchema,
        response: { 200: artisanDocumentResponseSchema },
      },
    },
    async (request) => {
      const { id, documentId } = request.params;
      const current = await app.prisma.artisanDocument.findFirst({
        where: { id: documentId, artisanId: id },
        select: { id: true },
      });
      if (current === null) throw notFound('Dokumen tidak ditemukan.');

      const row = await app.prisma.artisanDocument.update({
        where: { id: current.id },
        data: {
          ...(request.body.kind === undefined ? {} : { kind: request.body.kind }),
          ...(request.body.title === undefined ? {} : { title: request.body.title }),
        },
        select: artisanDocumentSelect,
      });
      return ok(toArtisanDocument(row));
    },
  );

  app.delete(
    '/admin/artisans/:id/documents/:documentId',
    {
      config: access('artisan.write'),
      schema: { params: artisanDocumentParamsSchema },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await deleteArtisanDocument(app.prisma, {
        actor,
        artisanId: request.params.id,
        documentId: request.params.documentId,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/artisans/:id/documents/:documentId/url',
    {
      config: access('artisan.read_private'),
      schema: {
        params: artisanDocumentParamsSchema,
        querystring: artisanDocumentUrlQuerySchema,
        response: { 200: artisanDocumentUrlResponseSchema },
      },
    },
    async (request) => {
      const { id, documentId } = request.params;
      const document = await app.prisma.artisanDocument.findFirst({
        where: { id: documentId, artisanId: id },
        select: { mediaId: true, media: { select: { key: true, fileName: true } } },
      });
      // `404` lebih dulu: peminta yang menebak id dokumen tidak boleh bisa
      // membedakan "ada tapi belum bisa diunduh" dari "tidak ada".
      if (document === null) throw notFound('Dokumen tidak ditemukan.');

      /**
       * Penandatanganan dilakukan modul media (kontrak §5.12): dokumen
       * pengrajin adalah Media `PRIVATE` biasa, jadi tidak ada jalur presign
       * kedua yang perlu dijaga terpisah. Tanpa `R2_*`, `presignGet` tidak ada
       * dan rute ini menjawab `503` seperti sebelumnya.
       */
      if (r2 === null) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Penyimpanan berkas belum dikonfigurasi. Hubungi administrator.',
        );
      }

      const expiresAt = new Date(Date.now() + MEDIA_DOWNLOAD_TTL_SECONDS * 1000);
      const url = await r2.presignGet({
        key: document.media.key,
        expiresInSeconds: MEDIA_DOWNLOAD_TTL_SECONDS,
        ...(request.query.download ? { downloadAs: document.media.fileName } : {}),
      });
      return ok({ url, expiresAt: expiresAt.toISOString() });
    },
  );

  return Promise.resolve();
};
