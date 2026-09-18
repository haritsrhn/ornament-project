/**
 * Manajemen pengguna admin — kontrak §5.13 (`/v1/admin/users/*`).
 *
 * Seluruh rute memakai izin `user.manage` (matriks §3.1: hanya Administrator).
 * Izin dinyatakan lewat `config.adminAccess`; guard sesi + izin dipasang
 * otomatis oleh hook di `modules/auth/guard.ts`, jadi urutan `401 → 403 → 400`
 * berlaku tanpa rute perlu mengaturnya sendiri.
 */

import {
  adminUserResponseSchema,
  adminUsersQuerySchema,
  adminUsersResponseSchema,
  updateUserBodySchema,
  userIdParamsSchema,
  type AdminUsersQuery,
  type PageMeta,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../generated/prisma/client.js';
import { AppError, notFound } from '../../lib/errors.js';
import { ok } from '../../lib/http.js';
import { adminRateLimit } from '../../lib/rate-limit.js';
import { adminPermission, currentSession } from '../auth/guard.js';
import { adminUserSelect, toAdminUser } from './dto.js';
import { assertNotLastAdministrator, cannotChangeOwnRole, cannotRevokeSelf } from './service.js';

export interface UsersRoutesOptions {
  /** Basis URL publik R2 untuk `AdminUser.avatar.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

/** `where` dari query (kontrak §1.7). `role` dipisah agar `counts` bisa mengabaikannya. */
/**
 * `contains` Prisma diterjemahkan ke `LIKE '%q%'`, dan `%`/`_`/`\\` di `q` akan
 * diperlakukan sebagai wildcard. Bukan celah injeksi (query tetap
 * terparameterisasi), tapi hasil pencariannya jadi tidak sesuai yang diketik.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function baseWhere(query: AdminUsersQuery): Prisma.UserWhereInput {
  return {
    ...(query.status === 'ALL' ? {} : { status: query.status }),
    ...(query.q === undefined
      ? {}
      : {
          OR: [
            { name: { contains: escapeLike(query.q), mode: 'insensitive' } },
            // `email` bertipe citext: `LIKE` di atasnya sudah case-insensitive.
            { email: { contains: escapeLike(query.q) } },
          ],
        }),
  };
}

/** Allowlist sort §1.7; tie-breaker `id` selalu ditambahkan server. */
function orderBy(sort: AdminUsersQuery['sort']): Prisma.UserOrderByWithRelationInput[] {
  switch (sort) {
    case '-name':
      return [{ name: 'desc' }, { id: 'asc' }];
    case 'lastActiveAt':
      return [{ lastActiveAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
    case '-lastActiveAt':
      return [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    default:
      return [{ name: 'asc' }, { id: 'asc' }];
  }
}

export const usersRoutes: FastifyPluginAsyncZod<UsersRoutesOptions> = (app, options) => {
  const mediaPublicUrl = options.mediaPublicUrl;
  const access = { adminAccess: adminPermission('user.manage'), ...adminRateLimit() };

  async function loadUser(id: string) {
    const user = await app.prisma.user.findUnique({ where: { id }, select: adminUserSelect });
    // User tidak pernah dihapus permanen (model domain §3.1), jadi 404 di sini
    // berarti id memang tidak ada.
    if (user === null) throw notFound('Pengguna tidak ditemukan.');
    return user;
  }

  app.get(
    '/admin/users',
    {
      config: access,
      schema: { querystring: adminUsersQuerySchema, response: { 200: adminUsersResponseSchema } },
    },
    async (request) => {
      const query = request.query;
      const where: Prisma.UserWhereInput = {
        ...baseWhere(query),
        ...(query.role === undefined ? {} : { role: query.role }),
      };

      const [rows, total, perRole] = await Promise.all([
        app.prisma.user.findMany({
          where,
          select: adminUserSelect,
          orderBy: orderBy(query.sort),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        app.prisma.user.count({ where }),
        // `counts` dihitung dengan filter yang sama **kecuali** filter tab itu
        // sendiri (kontrak §1.4), yaitu `role`.
        app.prisma.user.groupBy({
          by: ['role'],
          where: baseWhere(query),
          _count: { _all: true },
        }),
      ]);

      const counts: Record<string, number> = { all: 0 };
      let all = 0;
      for (const row of perRole) {
        counts[row.role] = row._count._all;
        all += row._count._all;
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
        rows.map((row) => toAdminUser(row, mediaPublicUrl)),
        meta,
      );
    },
  );

  app.get(
    '/admin/users/:id',
    {
      config: access,
      schema: { params: userIdParamsSchema, response: { 200: adminUserResponseSchema } },
    },
    async (request) => ok(toAdminUser(await loadUser(request.params.id), mediaPublicUrl)),
  );

  app.patch(
    '/admin/users/:id',
    {
      config: access,
      schema: {
        params: userIdParamsSchema,
        body: updateUserBodySchema,
        response: { 200: adminUserResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { name, role } = request.body;
      const actor = currentSession(request).user;
      const target = await loadUser(id);

      if (role !== undefined && role !== target.role) {
        // Aturan anti-lockout; penjelasan lengkap di `service.ts`.
        if (target.id === actor.id) throw cannotChangeOwnRole();
        await assertNotLastAdministrator(app.prisma, target);
      }

      const updated = await app.prisma.user.update({
        where: { id },
        data: { ...(name === undefined ? {} : { name }), ...(role === undefined ? {} : { role }) },
        select: adminUserSelect,
      });

      request.log.info(
        { actorId: actor.id, userId: id, role: role ?? null },
        'pengguna diperbarui',
      );
      return ok(toAdminUser(updated, mediaPublicUrl));
    },
  );

  app.post(
    '/admin/users/:id/revoke',
    {
      config: access,
      schema: { params: userIdParamsSchema, response: { 200: adminUserResponseSchema } },
    },
    async (request) => {
      const { id } = request.params;
      const actor = currentSession(request).user;
      const target = await loadUser(id);

      if (target.id === actor.id) throw cannotRevokeSelf();
      if (target.status === 'REVOKED') {
        throw new AppError('INVALID_STATE', 'Akses pengguna ini sudah dicabut.', {
          details: { current: 'REVOKED', allowed: ['ACTIVE'] },
        });
      }
      await assertNotLastAdministrator(app.prisma, target);

      const [updated] = await app.prisma.$transaction([
        app.prisma.user.update({
          where: { id },
          data: { status: 'REVOKED', revokedAt: new Date() },
          select: adminUserSelect,
        }),
        // ADR K7: penonaktifan menghapus semua sesi user, jadi cookie yang
        // masih beredar mati seketika (bukan menunggu `expiresAt`).
        app.prisma.session.deleteMany({ where: { userId: id } }),
      ]);

      request.log.info({ actorId: actor.id, userId: id }, 'akses pengguna dicabut');
      return ok(toAdminUser(updated, mediaPublicUrl));
    },
  );

  app.post(
    '/admin/users/:id/reactivate',
    {
      config: access,
      schema: { params: userIdParamsSchema, response: { 200: adminUserResponseSchema } },
    },
    async (request) => {
      const { id } = request.params;
      const actor = currentSession(request).user;
      const target = await loadUser(id);

      if (target.status === 'ACTIVE') {
        throw new AppError('INVALID_STATE', 'Pengguna ini sudah aktif.', {
          details: { current: 'ACTIVE', allowed: ['REVOKED'] },
        });
      }

      // Kontrak §5.13: user login kembali dengan kata sandi lama; sesi lamanya
      // sudah dihapus saat pencabutan dan tidak dihidupkan lagi.
      const updated = await app.prisma.user.update({
        where: { id },
        data: { status: 'ACTIVE', revokedAt: null },
        select: adminUserSelect,
      });

      request.log.info({ actorId: actor.id, userId: id }, 'pengguna diaktifkan kembali');
      return ok(toAdminUser(updated, mediaPublicUrl));
    },
  );

  return Promise.resolve();
};
