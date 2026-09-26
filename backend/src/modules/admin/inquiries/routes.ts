/**
 * Admin inquiry — kontrak API §5.11 (`/v1/admin/inquiries/*`).
 *
 * Seperti komentar, rute bacanya pun digantung pada izin (`inquiry.manage`):
 * inquiry adalah data pembeli — nama, email, anggaran — bukan konten yang
 * boleh dilihat setiap peran admin. Anonimisasi Administrator saja (A3).
 */

import {
  adminInquiriesQuerySchema,
  idempotencyKeySchema,
  IDEMPOTENT_REPLAYED_HEADER,
  adminInquiriesResponseSchema,
  adminInquiryResponseSchema,
  anonymizeInquiryResponseSchema,
  anonymizeInquirySchema,
  inquiryIdParamsSchema,
  inquiryReplyInputSchema,
  inquiryReplyParamsSchema,
  inquiryReplyResponseSchema,
  roleHasPermission,
  sendInquiryReplyResponseSchema,
  updateInquiryReplySchema,
  updateInquirySchema,
  type PageMeta,
  type Permission,
} from '@ornament/shared';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { AppError } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { withIdempotency } from '../../../lib/idempotency.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import type { R2 } from '../../../lib/r2.js';
import { adminPermission, currentSession } from '../../auth/guard.js';
import type { EmailSender } from '../../email/sender.js';
import { toAdminInquiry, toAdminInquiryRow, toInquiryReply } from './dto.js';
import {
  anonymizeInquiry,
  createReply,
  deleteReply,
  listInquiries,
  loadInquiry,
  loadSendOutcome,
  sendReply,
  updateInquiry,
  updateReply,
  type InquiryActor,
  type InquiryDeps,
} from './service.js';

export interface AdminInquiriesRoutesOptions {
  emailSender: EmailSender;
  r2?: R2 | null;
}

/** `Idempotency-Key` disarankan pada pengiriman balasan (kontrak §5.11). */
const optionalIdempotencyHeadersSchema = z.looseObject({
  'idempotency-key': idempotencyKeySchema.optional(),
});

interface Actor extends InquiryActor {
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

export const adminInquiriesRoutes: FastifyPluginAsyncZod<AdminInquiriesRoutesOptions> = (
  app,
  options,
) => {
  const rateLimit = adminRateLimit();
  const deps: InquiryDeps = {
    prisma: app.prisma,
    email: options.emailSender,
    r2: options.r2 ?? null,
  };

  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): Actor => {
    const { user } = currentSession(request);
    return { id: user.id, name: user.name, role: user.role };
  };

  const assertCanAnonymize = (actor: Actor): void => {
    if (roleHasPermission(actor.role, 'privacy.anonymize')) return;
    throw new AppError('FORBIDDEN', 'Hanya Administrator yang dapat menganonimkan data.', {
      details: { requiredPermission: 'privacy.anonymize' satisfies Permission },
    });
  };

  // ── Daftar & detail ────────────────────────────────────────────────────────

  app.get(
    '/admin/inquiries',
    {
      config: access('inquiry.manage'),
      schema: {
        querystring: adminInquiriesQuerySchema,
        response: { 200: adminInquiriesResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const result = await listInquiries(app.prisma, query);
      const meta: PageMeta = {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
        counts: result.counts,
      };
      return ok(result.rows.map(toAdminInquiryRow), meta);
    },
  );

  app.get(
    '/admin/inquiries/:id',
    {
      config: access('inquiry.manage'),
      schema: { params: inquiryIdParamsSchema, response: { 200: adminInquiryResponseSchema } },
    },
    // `GET` tidak menandai dibaca (kontrak §5.11): itu aksi tersendiri lewat
    // `PATCH { read: true }`, supaya mengintip tidak sama dengan menerima.
    async (request) => ok(toAdminInquiry(await loadInquiry(app.prisma, request.params.id))),
  );

  app.patch(
    '/admin/inquiries/:id',
    {
      config: access('inquiry.manage'),
      schema: {
        params: inquiryIdParamsSchema,
        body: updateInquirySchema,
        response: { 200: adminInquiryResponseSchema },
      },
    },
    async (request) => {
      const row = await updateInquiry(app.prisma, {
        actor: actorOf(request),
        inquiryId: request.params.id,
        input: request.body,
      });
      return ok(toAdminInquiry(row));
    },
  );

  app.post(
    '/admin/inquiries/:id/anonymize',
    {
      config: access('inquiry.manage'),
      schema: {
        params: inquiryIdParamsSchema,
        body: anonymizeInquirySchema,
        response: { 200: anonymizeInquiryResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanAnonymize(actor);

      const { row, affected } = await anonymizeInquiry(deps, {
        actor,
        inquiryId: request.params.id,
        sameEmail: request.body.sameEmail,
      });
      // Tanpa email maupun nama: yang dianonimkan tidak boleh muncul di log.
      request.log.info({ actorId: actor.id, inquiryId: row.id, affected }, 'data dianonimkan');
      return ok({ inquiry: toAdminInquiry(row), affected });
    },
  );

  // ── Balasan ────────────────────────────────────────────────────────────────

  app.post(
    '/admin/inquiries/:id/replies',
    {
      config: access('inquiry.manage'),
      schema: {
        params: inquiryIdParamsSchema,
        body: inquiryReplyInputSchema,
        response: { 201: inquiryReplyResponseSchema },
      },
    },
    async (request, reply) => {
      const row = await createReply(deps, {
        actor: actorOf(request),
        inquiryId: request.params.id,
        input: request.body,
      });
      return reply.code(201).send(ok(toInquiryReply(row)));
    },
  );

  app.patch(
    '/admin/inquiries/:id/replies/:replyId',
    {
      config: access('inquiry.manage'),
      schema: {
        params: inquiryReplyParamsSchema,
        body: updateInquiryReplySchema,
        response: { 200: inquiryReplyResponseSchema },
      },
    },
    async (request) => {
      const row = await updateReply(deps, {
        inquiryId: request.params.id,
        replyId: request.params.replyId,
        input: request.body,
      });
      return ok(toInquiryReply(row));
    },
  );

  app.delete(
    '/admin/inquiries/:id/replies/:replyId',
    { config: access('inquiry.manage'), schema: { params: inquiryReplyParamsSchema } },
    async (request, reply) => {
      await deleteReply(app.prisma, {
        inquiryId: request.params.id,
        replyId: request.params.replyId,
      });
      return reply.code(204).send();
    },
  );

  app.post(
    '/admin/inquiries/:id/replies/:replyId/send',
    {
      config: access('inquiry.manage'),
      schema: {
        params: inquiryReplyParamsSchema,
        headers: optionalIdempotencyHeadersSchema,
        response: { 200: sendInquiryReplyResponseSchema },
      },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      const key = request.headers['idempotency-key'];
      const { id: inquiryId, replyId } = request.params;

      const render = async () => {
        const outcome = await loadSendOutcome(app.prisma, inquiryId, replyId);
        return ok({
          reply: toInquiryReply(outcome.reply),
          inquiry: toAdminInquiryRow(outcome.inquiry),
        });
      };

      if (key === undefined) {
        await sendReply(deps, { actor, inquiryId, replyId });
        return render();
      }

      /**
       * Yang disimpan hanya id, bukan DTO jadi.
       *
       * `IdempotencyRecord` hidup 24 jam di tabelnya sendiri dan tidak ikut
       * tersentuh anonimisasi (§6.11): menyimpan respons utuh di sana berarti
       * nama, email, dan isi balasan pembeli bertahan sehari setelah ia minta
       * datanya dihapus — dan pemutaran ulang akan menyajikannya kembali lewat
       * API. Karena itu respons dirender ulang dari database, baik pada
       * panggilan pertama maupun pengulangan.
       */
      const result = await withIdempotency(
        app.prisma,
        { scope: 'POST /v1/admin/inquiries/:id/replies/:replyId/send', actor: actor.id, key },
        { inquiryId, replyId },
        async () => {
          await sendReply(deps, { actor, inquiryId, replyId });
          return { statusCode: 200, body: { data: { inquiryId, replyId } } };
        },
      );
      if (result.replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return reply.code(200).send(await render());
    },
  );

  return Promise.resolve();
};
