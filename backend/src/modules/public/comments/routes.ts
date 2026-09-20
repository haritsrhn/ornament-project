/**
 * Submit komentar publik — kontrak §5.3
 * (`POST /v1/public/articles/:slug/comments`).
 *
 * Dipisah dari `public/articles/routes.ts` karena sifatnya berbeda di hampir
 * semua hal yang penting: rute **tulis** (key internal wajib, `no-store`,
 * rate limit per `ipHash`, honeypot, idempotensi) yang tidak membaca apa pun
 * dan tidak mengembalikan satu pun field komentar.
 *
 * ── Yang dijaga di sini ──────────────────────────────────────────────────────
 * - Komentar baru selalu `PENDING` (model §6.8): ia **tidak** muncul di
 *   `GET .../comments`, yang hanya menampilkan `APPROVED`.
 * - Artikelnya harus sedang tayang (§6.8: komentar pada artikel yang belum/
 *   tidak terbit ditolak). Draf, terjadwal yang belum jatuh tempo, di Trash,
 *   dan slug yang tidak ada dijawab `404` yang sama — keberadaan draf tidak
 *   pernah bocor.
 * - Respons `202 { data: { status: "PENDING" } }` saja: tanpa `id`, tanpa isi,
 *   tanpa apa pun yang mengaitkan `authorEmail` 🔒 dengan komentar (§4).
 * - `parentId` tidak ada di skema input (`strictObject`), jadi komentar publik
 *   selalu komentar akar; balasan bersarang hanya dibuat admin, dengan nesting
 *   maksimal 1 tingkat (model §3.6).
 */

import {
  idempotencyHeadersSchema,
  publicCommentInputSchema,
  publicCommentSubmitResponseSchema,
  slugParamsSchema,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { notFound } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { publishedArticleWhere } from '../articles/query.js';
import { publicWriteAccess } from '../guard.js';
import { handlePublicSubmit } from '../submit.js';
import type { PublicSubmitThrottles } from '../submit-throttle.js';

export interface PublicCommentsRoutesOptions {
  /** Rahasia `ipHash` = `INTERNAL_API_KEY`; lihat `client-identity.ts`. */
  internalApiKey?: string | undefined;
  throttles: PublicSubmitThrottles;
}

const COMMENT_SCOPE = 'POST /v1/public/articles/:slug/comments';

/** Respons sukses, asli maupun palsu (A6): bentuknya harus identik. */
const PENDING_RESPONSE = { statusCode: 202, body: ok({ status: 'PENDING' as const }) };

export const publicCommentsRoutes: FastifyPluginAsyncZod<PublicCommentsRoutesOptions> = (
  app,
  options,
) => {
  const ipHashSecret = options.internalApiKey ?? '';

  app.post(
    '/public/articles/:slug/comments',
    {
      config: publicWriteAccess('Submit komentar pengunjung pada artikel journal.'),
      schema: {
        headers: idempotencyHeadersSchema,
        params: slugParamsSchema,
        body: publicCommentInputSchema,
        response: { 202: publicCommentSubmitResponseSchema },
      },
    },
    async (request, reply) => {
      await handlePublicSubmit({
        prisma: app.prisma,
        request,
        reply,
        scope: COMMENT_SCOPE,
        ipHashSecret,
        throttles: [options.throttles.commentBurst, options.throttles.commentDaily],
        body: { slug: request.params.slug, ...request.body },
        honeypot: request.body.website,
        fakeSuccess: () => PENDING_RESPONSE,
        run: async (identity) => {
          const article = await app.prisma.article.findFirst({
            where: { slug: request.params.slug, ...publishedArticleWhere(new Date()) },
            select: { id: true },
          });
          if (article === null) throw notFound('Artikel tidak ditemukan.');

          await app.prisma.comment.create({
            data: {
              articleId: article.id,
              // Komentar publik tidak pernah menjadi balasan (lihat kepala berkas).
              parentId: null,
              authorName: request.body.authorName,
              // 🔒 Wajib (Q9), tidak pernah tampil publik.
              authorEmail: request.body.authorEmail,
              // Bukan admin, jadi bukan balasan staf.
              authorUserId: null,
              body: request.body.body,
              // Antrean moderasi (§6.8); `APPROVED` hanya lewat admin.
              status: 'PENDING',
              // 🔒 Hash, bukan IP mentah (model §6.11).
              ipHash: identity.ipHash,
              userAgent: identity.userAgent,
            },
            select: { id: true },
          });

          return PENDING_RESPONSE;
        },
      });
    },
  );

  return Promise.resolve();
};
