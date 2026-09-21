/**
 * Admin artikel — kontrak API §5.9 (`/v1/admin/articles/*`).
 *
 * Dua lapis izin yang berbeda dipakai bersama, sama seperti modul produk:
 * 1. **Matriks §3** lewat `adminPermission(...)` — "peran ini punya tombolnya?"
 * 2. **Kepemilikan/status** lewat `./access.ts` — "boleh untuk baris ini?"
 *    (Contributor hanya draf miliknya, A1).
 *
 * Artikel tidak punya `article.trash` di katalog `Permission` (kontrak §3.3):
 * memindahkan ke Trash adalah bagian dari menulis draf, jadi rutenya memakai
 * `article.write_draft` dan dibatasi kepemilikan seperti `PATCH`.
 */

import {
  adminArticleResponseSchema,
  adminArticlesQuerySchema,
  adminArticlesResponseSchema,
  articleBulkBodySchema,
  articleBulkResponseSchema,
  articleIdParamsSchema,
  articleInputSchema,
  articleTrashedResponseSchema,
  ARTICLE_EDITOR_ONLY_FIELDS,
  ARTICLE_STATUSES,
  idempotencyKeySchema,
  IDEMPOTENT_REPLAYED_HEADER,
  previewArticleBodySchema,
  publicArticleResponseSchema,
  publishArticleBodySchema,
  roleHasPermission,
  updateArticleBodySchema,
  type AdminArticlesQuery,
  type ArticleBulkAction,
  type BulkResult,
  type PageMeta,
  type Permission,
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
import { assertCanPreview, assertCanRestore, assertCanWrite } from './access.js';
import {
  adminArticleRowSelect,
  adminArticleSelect,
  toAdminArticle,
  toAdminArticleRow,
  EMPTY_COMMENT_COUNTS,
  type AdminArticleData,
  type AdminArticleRowData,
  type CommentCounts,
} from './dto.js';
import { buildArticlePreview, previewArticleSelect } from './preview.js';
import {
  createArticle,
  publishArticle,
  purgeArticle,
  restoreArticle,
  trashArticle,
  unpublishArticle,
  updateArticle,
} from './service.js';

export interface AdminArticlesRoutesOptions {
  /** Basis URL publik R2 untuk `MediaRef.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
}

interface AdminActor {
  id: string;
  name: string;
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
}

/** `Idempotency-Key` opsional pada aksi massal (kontrak §1.8). */
const optionalIdempotencyHeadersSchema = z.looseObject({
  'idempotency-key': idempotencyKeySchema.optional(),
});

/** `where` daftar; `trashed` dipisah agar `counts` bisa mengabaikan filter tab. */
function baseWhere(query: AdminArticlesQuery): Prisma.ArticleWhereInput {
  const q = query.q === undefined ? undefined : escapeLike(query.q);
  return {
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.authorId === undefined ? {} : { authorId: query.authorId }),
    ...(q === undefined ? {} : { title: { contains: q, mode: 'insensitive' } }),
  };
}

/** Allowlist sort §1.7; tie-breaker `id` selalu ditambahkan server. */
function orderBy(sort: AdminArticlesQuery['sort']): Prisma.ArticleOrderByWithRelationInput[] {
  switch (sort) {
    case 'title':
      return [{ title: 'asc' }, { id: 'asc' }];
    case '-publishedAt':
      return [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
    default:
      return [{ updatedAt: 'desc' }, { id: 'asc' }];
  }
}

export const adminArticlesRoutes: FastifyPluginAsyncZod<AdminArticlesRoutesOptions> = (
  app,
  options,
) => {
  const mediaPublicUrl = options.mediaPublicUrl;
  const rateLimit = adminRateLimit();

  /** Baca: semua peran (kontrak §3.2 "baca artikel ✓✓✓"). */
  const readAccess = { adminAccess: adminSession(), ...rateLimit };
  const access = (permission: Permission) => ({
    adminAccess: adminPermission(permission),
    ...rateLimit,
  });

  const actorOf = (request: FastifyRequest): AdminActor => {
    const { user } = currentSession(request);
    return { id: user.id, name: user.name, role: user.role };
  };

  /**
   * Dua hitungan komentar dari **satu** `groupBy` (kontrak §5.9). Prisma hanya
   * mengizinkan satu `_count` berfilter per relasi, jadi menghitungnya di
   * `select` akan berarti satu query tambahan per baris.
   */
  async function commentCountsFor(ids: readonly string[]): Promise<Map<string, CommentCounts>> {
    const result = new Map<string, CommentCounts>();
    if (ids.length === 0) return result;

    const grouped = await app.prisma.comment.groupBy({
      by: ['articleId', 'status'],
      where: { articleId: { in: [...ids] }, status: { in: ['APPROVED', 'PENDING'] } },
      _count: { _all: true },
    });
    for (const row of grouped) {
      const current = result.get(row.articleId) ?? { approved: 0, pending: 0 };
      if (row.status === 'APPROVED') current.approved = row._count._all;
      else current.pending = row._count._all;
      result.set(row.articleId, current);
    }
    return result;
  }

  /** Artikel apa pun, termasuk yang di Trash (kontrak §5.9 `GET /:id`). */
  async function loadArticle(id: string): Promise<AdminArticleData> {
    const row = await app.prisma.article.findUnique({ where: { id }, select: adminArticleSelect });
    if (row === null) throw notFound('Artikel tidak ditemukan.');
    return row;
  }

  /** Bentuk ringkas untuk pemeriksaan kepemilikan sebelum aksi tulis. */
  async function loadOwnership(id: string) {
    const row = await app.prisma.article.findUnique({
      where: { id },
      select: { id: true, status: true, authorId: true, deletedAt: true },
    });
    if (row === null) throw notFound('Artikel tidak ditemukan.');
    return row;
  }

  async function respondArticle(id: string) {
    const row = await loadArticle(id);
    const counts = await commentCountsFor([id]);
    return ok(toAdminArticle(row, counts.get(id) ?? EMPTY_COMMENT_COUNTS, mediaPublicUrl));
  }

  // ── Daftar ─────────────────────────────────────────────────────────────────

  app.get(
    '/admin/articles',
    {
      config: readAccess,
      schema: {
        querystring: adminArticlesQuerySchema,
        response: { 200: adminArticlesResponseSchema },
      },
    },
    async (request) => {
      const query = request.query;
      const filters = baseWhere(query);
      const where: Prisma.ArticleWhereInput = {
        ...filters,
        deletedAt: query.trashed ? { not: null } : null,
      };
      const countsWhere = baseWhere({ ...query, status: undefined });

      const [rows, total, live, trash] = await Promise.all([
        app.prisma.article.findMany({
          where,
          select: adminArticleRowSelect,
          orderBy: orderBy(query.sort),
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        app.prisma.article.count({ where }),
        app.prisma.article.groupBy({
          by: ['status'],
          where: { ...countsWhere, deletedAt: null },
          _count: { _all: true },
        }),
        app.prisma.article.count({ where: { ...countsWhere, deletedAt: { not: null } } }),
      ]);

      const counts: Record<string, number> = { all: 0, trash };
      for (const status of ARTICLE_STATUSES) counts[status] = 0;
      let all = 0;
      for (const group of live) {
        counts[group.status] = group._count._all;
        all += group._count._all;
      }
      counts.all = all;

      const commentCounts = await commentCountsFor(rows.map((row) => row.id));
      const meta: PageMeta = {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
        counts,
      };
      return ok(
        (rows as unknown as AdminArticleRowData[]).map((row) =>
          toAdminArticleRow(row, commentCounts.get(row.id) ?? EMPTY_COMMENT_COUNTS),
        ),
        meta,
      );
    },
  );

  // ── Aksi massal (sebelum `/:id` karena `bulk` bukan uuid) ──────────────────

  app.post(
    '/admin/articles/bulk',
    {
      config: access('article.write_draft'),
      schema: {
        headers: optionalIdempotencyHeadersSchema,
        body: articleBulkBodySchema,
        response: { 200: articleBulkResponseSchema },
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
        { scope: 'POST /v1/admin/articles/bulk', actor: actor.id, key },
        body,
        run,
      );
      if (result.replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
      return reply.code(200).send(result.body as BulkEnvelope);
    },
  );

  /**
   * Setiap item dicek izinnya sendiri-sendiri dan kegagalannya dikumpulkan
   * (kontrak §5: sukses parsial diizinkan, selalu `200`). Berurutan, bukan
   * `Promise.all`: aksi massal menulis ke tabel yang sama dan urutan hasil
   * harus bisa diprediksi.
   */
  async function runBulk(
    actor: AdminActor,
    body: { action: ArticleBulkAction; ids: string[] },
  ): Promise<BulkResult> {
    const result: BulkResult = { succeeded: [], failed: [] };
    for (const id of body.ids) {
      try {
        await runBulkItem(actor, body.action, id);
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
    action: ArticleBulkAction,
    id: string,
  ): Promise<void> {
    /** Izin per aksi, sama dengan endpoint tunggalnya (kontrak §5.9). */
    const requirePermission = (permission: Permission): void => {
      if (!roleHasPermission(actor.role, permission)) {
        throw new AppError('FORBIDDEN', 'Anda tidak memiliki izin untuk aksi ini.', {
          details: { requiredPermission: permission },
        });
      }
    };

    switch (action) {
      case 'PUBLISH': {
        requirePermission('article.publish');
        await loadOwnership(id);
        await publishArticle(app.prisma, { actor, articleId: id, publishAt: null });
        return;
      }
      case 'UNPUBLISH': {
        requirePermission('article.publish');
        await loadOwnership(id);
        await unpublishArticle(app.prisma, { actor, articleId: id });
        return;
      }
      case 'TRASH': {
        requirePermission('article.write_draft');
        assertCanWrite(actor, await loadOwnership(id));
        await trashArticle(app.prisma, { actor, articleId: id });
        return;
      }
      case 'RESTORE': {
        requirePermission('article.restore');
        assertCanRestore(actor, await loadOwnership(id));
        await restoreArticle(app.prisma, { actor, articleId: id });
        return;
      }
      default: {
        requirePermission('article.purge');
        await loadOwnership(id);
        await purgeArticle(app.prisma, { actor, articleId: id });
        return;
      }
    }
  }

  // ── Detail & tulis ─────────────────────────────────────────────────────────

  app.post(
    '/admin/articles',
    {
      config: access('article.write_draft'),
      schema: { body: articleInputSchema, response: { 201: adminArticleResponseSchema } },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      assertNoEditorOnlyFields(actor, request.body);

      const articleId = await createArticle(app.prisma, { actor, input: request.body });
      request.log.info({ actorId: actor.id, articleId }, 'artikel dibuat');
      return reply.code(201).send(await respondArticle(articleId));
    },
  );

  app.get(
    '/admin/articles/:id',
    {
      config: readAccess,
      schema: { params: articleIdParamsSchema, response: { 200: adminArticleResponseSchema } },
    },
    async (request) => respondArticle(request.params.id),
  );

  app.patch(
    '/admin/articles/:id',
    {
      config: access('article.write_draft'),
      schema: {
        params: articleIdParamsSchema,
        body: updateArticleBodySchema,
        response: { 200: adminArticleResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertNoEditorOnlyFields(actor, request.body);
      assertCanWrite(actor, await loadOwnership(request.params.id));

      await updateArticle(app.prisma, {
        actor,
        articleId: request.params.id,
        body: request.body,
      });
      return respondArticle(request.params.id);
    },
  );

  app.post(
    '/admin/articles/:id/publish',
    {
      config: access('article.publish'),
      schema: {
        params: articleIdParamsSchema,
        body: publishArticleBodySchema,
        response: { 200: adminArticleResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      await publishArticle(app.prisma, {
        actor,
        articleId: request.params.id,
        publishAt: request.body.publishAt,
      });
      return respondArticle(request.params.id);
    },
  );

  app.post(
    '/admin/articles/:id/unpublish',
    {
      config: access('article.publish'),
      schema: { params: articleIdParamsSchema, response: { 200: adminArticleResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      await unpublishArticle(app.prisma, { actor, articleId: request.params.id });
      return respondArticle(request.params.id);
    },
  );

  // ── Pratinjau (tidak menyimpan apa pun, kontrak §5.9) ──────────────────────

  app.post(
    '/admin/articles/:id/preview',
    {
      config: access('article.write_draft'),
      schema: {
        params: articleIdParamsSchema,
        body: previewArticleBodySchema,
        response: { 200: publicArticleResponseSchema },
      },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanPreview(actor, await loadOwnership(request.params.id));

      const row = await app.prisma.article.findUnique({
        where: { id: request.params.id },
        select: previewArticleSelect,
      });
      if (row === null) throw notFound('Artikel tidak ditemukan.');

      return ok(
        await buildArticlePreview(app.prisma, {
          row,
          body: request.body,
          mediaPublicUrl,
        }),
      );
    },
  );

  // ── Trash, restore, purge ──────────────────────────────────────────────────

  app.delete(
    '/admin/articles/:id',
    {
      config: access('article.write_draft'),
      schema: { params: articleIdParamsSchema, response: { 200: articleTrashedResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanWrite(actor, await loadOwnership(request.params.id));
      const trashed = await trashArticle(app.prisma, { actor, articleId: request.params.id });
      return ok({ id: trashed.id, deletedAt: trashed.deletedAt.toISOString() });
    },
  );

  app.post(
    '/admin/articles/:id/restore',
    {
      config: access('article.restore'),
      schema: { params: articleIdParamsSchema, response: { 200: adminArticleResponseSchema } },
    },
    async (request) => {
      const actor = actorOf(request);
      assertCanRestore(actor, await loadOwnership(request.params.id));
      await restoreArticle(app.prisma, { actor, articleId: request.params.id });
      return respondArticle(request.params.id);
    },
  );

  app.delete(
    '/admin/articles/:id/permanent',
    {
      // Administrator saja (A3): tidak bisa dibatalkan.
      config: access('article.purge'),
      schema: { params: articleIdParamsSchema },
    },
    async (request, reply) => {
      const actor = actorOf(request);
      await loadOwnership(request.params.id);
      await purgeArticle(app.prisma, { actor, articleId: request.params.id });
      request.log.info(
        { actorId: actor.id, articleId: request.params.id },
        'artikel dihapus permanen',
      );
      return reply.code(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * `403 FORBIDDEN_FIELD` (kontrak §1.10/§5.9): Contributor boleh memanggil
 * endpoint ini, tetapi tidak boleh menentukan `slug` (URL publik adalah
 * keputusan Editor+, model §6.1) maupun `authorId` (menulis atas nama orang
 * lain akan memindahkan kepemilikan — dan dengan itu batas A1 — ke orang lain).
 */
function assertNoEditorOnlyFields(actor: AdminActor, body: Record<string, unknown>): void {
  if (actor.role !== 'CONTRIBUTOR') return;
  const sent = ARTICLE_EDITOR_ONLY_FIELDS.filter((field) => body[field] !== undefined);
  if (sent.length > 0) {
    throw new AppError('FORBIDDEN_FIELD', 'Anda tidak boleh mengubah field ini.', {
      details: { fields: [...sent] },
    });
  }
}
