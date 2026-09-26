/**
 * Admin komentar — kontrak API §5.10 (`/v1/admin/comments/*`).
 *
 * Contributor tidak punya akses sama sekali (A2), jadi seluruh rute — termasuk
 * yang hanya membaca — digantung pada `comment.moderate`, bukan `adminSession()`.
 * Ini satu-satunya modul admin yang daftarnya pun tertutup bagi peran itu:
 * isinya data pribadi pengunjung.
 */

import {
  adminCommentReplySchema,
  adminCommentResponseSchema,
  adminCommentsQuerySchema,
  adminCommentsResponseSchema,
  anonymizeCommentResponseSchema,
  anonymizeCommentSchema,
  commentBulkBodySchema,
  commentBulkResponseSchema,
  commentIdParamsSchema,
  moderateCommentSchema,
  roleHasPermission,
  type CommentBulkAction,
  type PageMeta,
  type Permission,
} from '@ornament/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import type { R2 } from '../../../lib/r2.js';
import { adminPermission, currentSession } from '../../auth/guard.js';
import { collectBulkResult } from '../bulk.js';
import { toAdminComment } from './dto.js';
import {
  anonymizeComment,
  listComments,
  loadComment,
  moderateComment,
  replyToComment,
  type CommentActor,
  type CommentDeps,
} from './service.js';

export interface AdminCommentsRoutesOptions {
  /** Untuk menghapus objek lampiran inquiry saat anonimisasi (§6.11). */
  r2?: R2 | null;
}

interface Actor extends CommentActor {
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

export const adminCommentsRoutes: FastifyPluginAsyncZod<AdminCommentsRoutesOptions> = (
  app,
  options,
) => {
  const rateLimit = adminRateLimit();
  const deps: CommentDeps = { prisma: app.prisma, r2: options.r2 ?? null };

  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): Actor => {
    const { user } = currentSession(request);
    return { id: user.id, name: user.name, role: user.role };
  };

  /** Anonimisasi tidak bisa dibatalkan, jadi Administrator saja (A3). */
  const assertCanAnonymize = (actor: Actor): void => {
    if (roleHasPermission(actor.role, 'privacy.anonymize')) return;
    throw new AppError('FORBIDDEN', 'Hanya Administrator yang dapat menganonimkan data.', {
      details: { requiredPermission: 'privacy.anonymize' satisfies Permission },
    });
  };

  // ── Daftar ─────────────────────────────────────────────────────────────────

  app.get(
    '/admin/comments',
    {
      config: access('comment.moderate'),
      schema: {
        querystring: adminCommentsQuerySchema,
        response: { 200: adminCommentsResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const result = await listComments(app.prisma, query);

      const meta: PageMeta = {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
        counts: result.counts,
      };
      return ok(result.rows.map(toAdminComment), meta);
    },
  );

  // ── Aksi massal (sebelum `/:id` karena `bulk` bukan uuid) ──────────────────

  app.post(
    '/admin/comments/bulk',
    {
      config: access('comment.moderate'),
      schema: { body: commentBulkBodySchema, response: { 200: commentBulkResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      const { action, ids } = request.body;
      if (action === 'ANONYMIZE') assertCanAnonymize(actor);

      return ok(await collectBulkResult(ids, request.log, (id) => runBulkItem(actor, action, id)));
    },
  );

  async function runBulkItem(actor: Actor, action: CommentBulkAction, id: string): Promise<void> {
    switch (action) {
      case 'APPROVE':
        await moderateComment(app.prisma, { actor, commentId: id, status: 'APPROVED' });
        return;
      case 'SPAM':
        await moderateComment(app.prisma, { actor, commentId: id, status: 'SPAM' });
        return;
      case 'DELETE':
        await moderateComment(app.prisma, { actor, commentId: id, status: 'DELETED' });
        return;
      case 'ANONYMIZE':
        // Izinnya sudah dicek sekali untuk seluruh batch; per item tidak ada
        // syarat tambahan selain yang ditegakkan service.
        await anonymizeComment(deps, { actor, commentId: id, sameEmail: false });
        return;
      default: {
        const exhaustive: never = action;
        throw new AppError('BAD_REQUEST', `Aksi massal tidak dikenal: ${String(exhaustive)}`);
      }
    }
  }

  // ── Satu komentar ──────────────────────────────────────────────────────────

  app.patch(
    '/admin/comments/:id',
    {
      config: access('comment.moderate'),
      schema: {
        params: commentIdParamsSchema,
        body: moderateCommentSchema,
        response: { 200: adminCommentResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const row = await moderateComment(app.prisma, {
        actor,
        commentId: request.params.id,
        status: request.body.status,
      });
      request.log.info(
        { actorId: actor.id, commentId: row.id, status: row.status },
        'komentar dimoderasi',
      );
      return ok(toAdminComment(row));
    },
  );

  app.post(
    '/admin/comments/:id/replies',
    {
      config: access('comment.moderate'),
      schema: {
        params: commentIdParamsSchema,
        body: adminCommentReplySchema,
        response: { 201: adminCommentResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const row = await replyToComment(app.prisma, {
        actor,
        commentId: request.params.id,
        body: request.body.body,
      });
      return reply.code(201).send(ok(toAdminComment(row)));
    },
  );

  app.post(
    '/admin/comments/:id/anonymize',
    {
      config: access('comment.moderate'),
      schema: {
        params: commentIdParamsSchema,
        body: anonymizeCommentSchema,
        response: { 200: anonymizeCommentResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanAnonymize(actor);

      const { row, affected } = await anonymizeComment(deps, {
        actor,
        commentId: request.params.id,
        sameEmail: request.body.sameEmail,
      });
      // Log rute sengaja tidak memuat email maupun nama: yang dianonimkan
      // tidak boleh muncul kembali di log aplikasi.
      request.log.info({ actorId: actor.id, commentId: row.id, affected }, 'data dianonimkan');
      return ok({ comment: toAdminComment(row), affected });
    },
  );

  // Dipakai tes dan UI untuk memuat ulang satu baris setelah aksi massal.
  app.get(
    '/admin/comments/:id',
    {
      config: access('comment.moderate'),
      schema: { params: commentIdParamsSchema, response: { 200: adminCommentResponseSchema } },
    },
    async (request) => ok(toAdminComment(await loadComment(app.prisma, request.params.id))),
  );

  return Promise.resolve();
};
