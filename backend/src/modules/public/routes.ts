/**
 * Rakitan rute `/v1/public/*` (kontrak §5.1–§5.5).
 *
 * Satu plugin agar guard publik (`registerPublicGuard`) terenkapsulasi bersama
 * rutenya: header `Cache-Control` dan flag `isTrustedInternalCaller` hanya
 * berlaku di sini, tidak bocor ke `/v1/admin/*`.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { publicArticlesRoutes } from './articles/routes.js';
import { publicArtisansRoutes } from './artisans/routes.js';
import { publicCommentsRoutes } from './comments/routes.js';
import { registerPublicGuard } from './guard.js';
import { publicInquiriesRoutes } from './inquiries/routes.js';
import { publicProductsRoutes } from './products/routes.js';
import { publicSiteRoutes } from './site/routes.js';
import type { PublicSubmitThrottles } from './submit-throttle.js';
import type { EmailSender } from '../email/sender.js';

export interface PublicRoutesOptions {
  /** Basis URL publik R2 untuk `PublicMedia.url` (ADR K3). */
  mediaPublicUrl?: string | undefined;
  /** `INTERNAL_API_KEY` (kontrak §1.2/§2.3), sekaligus rahasia `ipHash`. */
  internalApiKey?: string | undefined;
  /** Batas submit per `ipHash` (§2.3); satu set per instance app. */
  throttles: PublicSubmitThrottles;
  /** Notifikasi inquiry ke tim (ADR K4). */
  emailSender: EmailSender;
}

export const publicRoutes: FastifyPluginAsyncZod<PublicRoutesOptions> = async (app, options) => {
  registerPublicGuard(app, { internalApiKey: options.internalApiKey });

  const mediaOption =
    options.mediaPublicUrl === undefined ? {} : { mediaPublicUrl: options.mediaPublicUrl };

  await app.register(publicProductsRoutes, mediaOption);
  await app.register(publicArtisansRoutes, mediaOption);
  await app.register(publicArticlesRoutes, mediaOption);
  await app.register(publicSiteRoutes, mediaOption);

  const submitOption = {
    throttles: options.throttles,
    ...(options.internalApiKey === undefined ? {} : { internalApiKey: options.internalApiKey }),
  };
  await app.register(publicInquiriesRoutes, {
    ...submitOption,
    emailSender: options.emailSender,
  });
  await app.register(publicCommentsRoutes, submitOption);
};
