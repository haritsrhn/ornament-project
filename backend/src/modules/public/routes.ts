/**
 * Rakitan rute `/v1/public/*` (kontrak §5.1–§5.2).
 *
 * Satu plugin agar guard publik (`registerPublicGuard`) terenkapsulasi bersama
 * rutenya: header `Cache-Control` dan flag `isTrustedInternalCaller` hanya
 * berlaku di sini, tidak bocor ke `/v1/admin/*`.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { publicArtisansRoutes } from './artisans/routes.js';
import { registerPublicGuard } from './guard.js';
import { publicProductsRoutes } from './products/routes.js';

export interface PublicRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
  /** `INTERNAL_API_KEY` (kontrak §1.2/§2.3). */
  internalApiKey?: string | undefined;
}

export const publicRoutes: FastifyPluginAsyncZod<PublicRoutesOptions> = async (app, options) => {
  registerPublicGuard(app, { internalApiKey: options.internalApiKey });

  const mediaOption =
    options.mediaPublicUrl === undefined ? {} : { mediaPublicUrl: options.mediaPublicUrl };

  await app.register(publicProductsRoutes, mediaOption);
  await app.register(publicArtisansRoutes, mediaOption);
};
