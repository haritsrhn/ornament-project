/**
 * Admin media — kontrak API §5.12 (`/v1/admin/media/*`).
 *
 * Dua lapis izin seperti modul konten lain: `config.adminAccess` menjawab
 * "peran ini punya tombolnya?", sedangkan service menjawab "boleh untuk baris
 * ini?" (Contributor hanya berkas miliknya sendiri, dan tidak pernah berkas
 * `PRIVATE`).
 *
 * Tanpa `R2_*` dan `MEDIA_UPLOAD_SECRET`, rute yang butuh bucket menjawab
 * `503 SERVICE_UNAVAILABLE` — bukan `500`, dan bukan URL karangan. Sisa Media
 * Library tetap berfungsi penuh atas baris yang sudah ada.
 */

import {
  adminMediaDetailResponseSchema,
  adminMediaListResponseSchema,
  adminMediaResponseSchema,
  mediaConfirmSchema,
  mediaIdParamsSchema,
  mediaListQuerySchema,
  mediaPatchSchema,
  mediaTrashedResponseSchema,
  mediaUploadRequestSchema,
  mediaUploadTicketResponseSchema,
  mediaUrlQuerySchema,
  mediaUrlResponseSchema,
  roleHasPermission,
  type MediaListMeta,
  type Permission,
} from '@ornament/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import type { R2 } from '../../../lib/r2.js';
import { adminPermission, adminSession, currentSession } from '../../auth/guard.js';
import { toAdminMedia, toAdminMediaDetail } from './dto.js';
import {
  buildMediaUrl,
  confirmUpload,
  createUploadTicket,
  listMedia,
  loadMedia,
  purgeMedia,
  restoreMedia,
  trashMedia,
  updateMedia,
  type MediaActor,
  type MediaDeps,
} from './service.js';

export interface AdminMediaRoutesOptions {
  /** Basis URL publik R2 (ADR K3); tanpa ini `AdminMedia.url` selalu null. */
  mediaPublicUrl?: string | undefined;
  /** `null` bila `R2_*` belum lengkap — rute yang butuh bucket menjawab 503. */
  r2?: R2 | null;
  /** Kunci HMAC tiket unggah (kontrak §5.12). */
  uploadSecret?: string | undefined;
}

export const adminMediaRoutes: FastifyPluginAsyncZod<AdminMediaRoutesOptions> = (app, options) => {
  const publicBaseUrl = options.mediaPublicUrl;
  const rateLimit = adminRateLimit();

  const deps: MediaDeps = {
    prisma: app.prisma,
    r2: options.r2 ?? null,
    uploadSecret: options.uploadSecret,
  };

  /** Baca: semua peran admin; berkas privat disaring di service, bukan di guard. */
  const readAccess = { adminAccess: adminSession(), ...rateLimit };
  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): MediaActor => {
    const { user } = currentSession(request);
    return { id: user.id, role: user.role };
  };

  // ── Unggah: presign lalu konfirmasi ────────────────────────────────────────

  app.post(
    '/admin/media/uploads',
    {
      config: access('media.upload'),
      schema: {
        body: mediaUploadRequestSchema,
        response: { 201: mediaUploadTicketResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      // `media.private` dicek di sini, bukan di guard rute: izin unggahnya sama,
      // yang berbeda hanya visibilitas yang boleh diminta (kontrak §5.12).
      if (request.body.visibility === 'PRIVATE') {
        assertCanUploadPrivate(actor);
      }
      const ticket = await createUploadTicket(deps, actor, request.body);
      return reply.code(201).send(ok(ticket));
    },
  );

  app.post(
    '/admin/media',
    {
      config: access('media.upload'),
      schema: {
        body: mediaConfirmSchema,
        response: { 200: adminMediaResponseSchema, 201: adminMediaResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const { row, replayed } = await confirmUpload(deps, actor, request.body);
      if (!replayed) {
        request.log.info({ actorId: actor.id, mediaId: row.id }, 'media dikonfirmasi');
      }
      // Konfirmasi ulang tiket yang sama mengembalikan media yang sudah ada
      // dengan `200`, bukan `409` — retry klien setelah jaringan putus adalah
      // kejadian normal, bukan konflik (kontrak §5.12).
      return reply.code(replayed ? 200 : 201).send(ok(toAdminMedia(row, 0, publicBaseUrl)));
    },
  );

  // ── Daftar & detail ────────────────────────────────────────────────────────

  app.get(
    '/admin/media',
    {
      config: readAccess,
      schema: {
        querystring: mediaListQuerySchema,
        response: { 200: adminMediaListResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const result = await listMedia(deps, actorOf(request), query);

      const meta: MediaListMeta = {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
        totalSizeBytes: result.totalSizeBytes,
        months: result.months,
      };
      return ok(
        result.rows.map((row) =>
          toAdminMedia(row, result.usageCounts.get(row.id) ?? 0, publicBaseUrl),
        ),
        meta,
      );
    },
  );

  app.get(
    '/admin/media/:id',
    {
      config: readAccess,
      schema: { params: mediaIdParamsSchema, response: { 200: adminMediaDetailResponseSchema } },
    },
    async (request) => {
      const { row, usages } = await loadMedia(deps, actorOf(request), request.params.id);
      return ok(toAdminMediaDetail(row, usages, publicBaseUrl));
    },
  );

  app.get(
    '/admin/media/:id/url',
    {
      config: readAccess,
      schema: {
        params: mediaIdParamsSchema,
        querystring: mediaUrlQuerySchema,
        response: { 200: mediaUrlResponseSchema },
      },
    },
    async (request) => {
      const url = await buildMediaUrl(deps, actorOf(request), request.params.id, {
        download: request.query.download ?? false,
        publicBaseUrl,
      });
      return ok(url);
    },
  );

  // ── Ubah ───────────────────────────────────────────────────────────────────

  app.patch(
    '/admin/media/:id',
    {
      config: access('media.upload'),
      schema: {
        params: mediaIdParamsSchema,
        body: mediaPatchSchema,
        response: { 200: adminMediaResponseSchema },
      },
    },
    async (request) => {
      const { row, usages } = await updateMedia(
        deps,
        actorOf(request),
        request.params.id,
        request.body,
      );
      return ok(toAdminMedia(row, usages.length, publicBaseUrl));
    },
  );

  // ── Trash, pulihkan, hapus permanen ────────────────────────────────────────

  app.delete(
    '/admin/media/:id',
    {
      config: access('media.upload'),
      schema: { params: mediaIdParamsSchema, response: { 200: mediaTrashedResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      const result = await trashMedia(deps, actor, request.params.id);
      request.log.info({ actorId: actor.id, mediaId: result.id }, 'media dipindahkan ke Trash');
      return ok({ id: result.id, deletedAt: result.deletedAt.toISOString() });
    },
  );

  app.post(
    '/admin/media/:id/restore',
    {
      config: access('media.upload'),
      schema: { params: mediaIdParamsSchema, response: { 200: adminMediaResponseSchema } },
    },
    async (request) => {
      const { row, usages } = await restoreMedia(deps, actorOf(request), request.params.id);
      return ok(toAdminMedia(row, usages.length, publicBaseUrl));
    },
  );

  app.delete(
    '/admin/media/:id/permanent',
    {
      config: access('media.purge'),
      schema: { params: mediaIdParamsSchema },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await purgeMedia(deps, actor, request.params.id);
      request.log.info({ actorId: actor.id, mediaId: request.params.id }, 'media dihapus permanen');
      return reply.code(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Izin unggahnya sama untuk semua peran admin; yang membedakan hanya
 * visibilitas yang boleh diminta. Contributor tanpa `media.private` tidak bisa
 * membuat berkas yang lolos dari Media Library-nya sendiri (kontrak §5.12).
 */
function assertCanUploadPrivate(actor: MediaActor): void {
  if (roleHasPermission(actor.role, 'media.private')) return;
  throw new AppError('FORBIDDEN', 'Anda tidak dapat mengunggah berkas privat.', {
    details: { requiredPermission: 'media.private' satisfies Permission },
  });
}
