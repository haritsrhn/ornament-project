/**
 * Undangan pengguna — kontrak §5.13 (`/v1/admin/invites/*`, izin `user.manage`).
 *
 * Endpoint tanpa sesi (verifikasi token & terima undangan) ada di
 * `modules/auth/routes.ts`, sesuai kontrak §2.2.
 *
 * ── Token ────────────────────────────────────────────────────────────────────
 * Token mentah dibuat dari CSPRNG dan **hanya hash-nya** yang masuk DB. Karena
 * modul email (Resend, ADR K4) belum ada, token mentah dikembalikan sekali di
 * respons `POST /invites` dan `POST /invites/:id/resend` agar undangan bisa
 * dibagikan manual; ia tidak pernah muncul lagi di `GET /invites` maupun di
 * log.
 */

import {
  adminInviteResponseSchema,
  adminInvitesQuerySchema,
  adminInvitesResponseSchema,
  adminInviteWithTokenResponseSchema,
  createInviteBodySchema,
  inviteIdParamsSchema,
  type AdminInvitesQuery,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { ok } from '../../lib/http.js';
import { adminRateLimit } from '../../lib/rate-limit.js';
import { adminPermission, currentSession } from '../auth/guard.js';
import { NoopEmailSender, type EmailSender } from '../email/sender.js';
import { adminInviteSelect, toAdminInvite } from '../users/dto.js';
import { deliverInviteEmail } from './service.js';
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from './token.js';

export interface InvitesRoutesOptions {
  /** Pengirim email; default no-op sampai modul Resend dibangun (ADR K4). */
  emailSender?: EmailSender;
}

/** Filter status = kombinasi kolom waktu (status bukan kolom, lihat §5.13). */
function statusWhere(status: AdminInvitesQuery['status'], now: Date): Prisma.InviteWhereInput {
  switch (status) {
    case 'PENDING':
      return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
    case 'EXPIRED':
      return { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } };
    case 'ACCEPTED':
      return { acceptedAt: { not: null } };
    case 'REVOKED':
      return { acceptedAt: null, revokedAt: { not: null } };
    default:
      return {};
  }
}

export const invitesRoutes: FastifyPluginAsyncZod<InvitesRoutesOptions> = (app, options) => {
  const emailSender = options.emailSender ?? new NoopEmailSender();
  const access = { adminAccess: adminPermission('user.manage'), ...adminRateLimit() };

  app.get(
    '/admin/invites',
    {
      config: access,
      schema: {
        querystring: adminInvitesQuerySchema,
        response: { 200: adminInvitesResponseSchema },
      },
    },
    async (request) => {
      const now = new Date();
      const invites = await app.prisma.invite.findMany({
        where: statusWhere(request.query.status, now),
        select: adminInviteSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
      return ok(invites.map((invite) => toAdminInvite(invite, now)));
    },
  );

  app.post(
    '/admin/invites',
    {
      config: access,
      schema: {
        body: createInviteBodySchema,
        response: { 201: adminInviteWithTokenResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, role } = request.body;
      const actor = currentSession(request).user;
      const now = new Date();

      const existingUser = await app.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser !== null) {
        throw conflict(['email'], 'Email ini sudah menjadi pengguna.');
      }

      // Indeks unik parsial `invite_email_active_key` hanya mengizinkan satu
      // undangan yang belum diterima & belum dicabut per email. Yang masih
      // berlaku → 409; yang sudah kedaluwarsa → baris itu dipakai ulang
      // (setara "kirim ulang"), supaya admin tidak terjebak indeks unik.
      const active = await app.prisma.invite.findFirst({
        where: { email, acceptedAt: null, revokedAt: null },
        select: { id: true, expiresAt: true },
      });
      if (active !== null && active.expiresAt.getTime() > now.getTime()) {
        throw conflict(['email'], 'Sudah ada undangan aktif untuk email ini.');
      }

      const token = generateInviteToken();
      const data = {
        email,
        role,
        tokenHash: hashInviteToken(token),
        expiresAt: inviteExpiresAt(now),
        invitedById: actor.id,
        emailSentAt: null,
        emailMessageId: null,
        emailError: null,
      };
      const invite =
        active === null
          ? await app.prisma.invite.create({ data, select: adminInviteSelect })
          : await app.prisma.invite.update({
              where: { id: active.id },
              data,
              select: adminInviteSelect,
            });

      const sent = await deliverInviteEmail(app.prisma, emailSender, invite.id, {
        to: invite.email,
        role: invite.role,
        token,
        expiresAt: invite.expiresAt,
        invitedByName: invite.invitedBy.name,
      });

      // Sengaja tanpa token di log (hanya id undangan dan pelakunya).
      request.log.info(
        { actorId: actor.id, inviteId: invite.id, role, emailSent: sent.emailSentAt !== null },
        'undangan dibuat',
      );
      return reply.code(201).send(
        ok({
          ...toAdminInvite({ ...invite, ...sent }, now),
          token,
        }),
      );
    },
  );

  app.post(
    '/admin/invites/:id/resend',
    {
      config: access,
      schema: {
        params: inviteIdParamsSchema,
        response: { 200: adminInviteWithTokenResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const actor = currentSession(request).user;
      const now = new Date();

      const existing = await app.prisma.invite.findUnique({
        where: { id },
        select: { id: true, acceptedAt: true, revokedAt: true },
      });
      if (existing === null) throw notFound('Undangan tidak ditemukan.');
      if (existing.acceptedAt !== null || existing.revokedAt !== null) {
        throw new AppError('INVALID_STATE', 'Undangan ini sudah diterima atau dicabut.', {
          details: {
            current: existing.acceptedAt !== null ? 'ACCEPTED' : 'REVOKED',
            allowed: ['PENDING', 'EXPIRED'],
          },
        });
      }

      // Token baru menggantikan yang lama: kolom `token_hash` ditimpa, jadi
      // tautan lama otomatis tidak berlaku (kontrak §5.13).
      const token = generateInviteToken();
      const invite = await app.prisma.invite.update({
        where: { id },
        data: {
          tokenHash: hashInviteToken(token),
          expiresAt: inviteExpiresAt(now),
          emailSentAt: null,
          emailMessageId: null,
          emailError: null,
        },
        select: adminInviteSelect,
      });

      const sent = await deliverInviteEmail(app.prisma, emailSender, invite.id, {
        to: invite.email,
        role: invite.role,
        token,
        expiresAt: invite.expiresAt,
        invitedByName: invite.invitedBy.name,
      });

      request.log.info({ actorId: actor.id, inviteId: id }, 'undangan dikirim ulang');
      return ok({ ...toAdminInvite({ ...invite, ...sent }, now), token });
    },
  );

  app.delete(
    '/admin/invites/:id',
    {
      config: access,
      schema: { params: inviteIdParamsSchema, response: { 200: adminInviteResponseSchema } },
    },
    async (request) => {
      const { id } = request.params;
      const actor = currentSession(request).user;

      const existing = await app.prisma.invite.findUnique({
        where: { id },
        select: { id: true, acceptedAt: true, revokedAt: true },
      });
      if (existing === null) throw notFound('Undangan tidak ditemukan.');
      if (existing.acceptedAt !== null || existing.revokedAt !== null) {
        throw new AppError('INVALID_STATE', 'Undangan ini sudah diterima atau dicabut.', {
          details: {
            current: existing.acceptedAt !== null ? 'ACCEPTED' : 'REVOKED',
            allowed: ['PENDING', 'EXPIRED'],
          },
        });
      }

      const invite = await app.prisma.invite.update({
        where: { id },
        data: { revokedAt: new Date() },
        select: adminInviteSelect,
      });

      request.log.info({ actorId: actor.id, inviteId: id }, 'undangan dicabut');
      return ok(toAdminInvite(invite));
    },
  );

  return Promise.resolve();
};
