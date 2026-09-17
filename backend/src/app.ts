import Fastify, { LogController, type FastifyInstance } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import {
  buildLoggerOptions,
  genReqId,
  registerRequestId,
  type LoggerOption,
} from './plugins/logger.js';
import { registerPrisma } from './plugins/prisma.js';
import { registerValidation } from './plugins/validation.js';
import { healthRoutes } from './routes/health.js';

/** Batas body JSON (kontrak §1.10: `413 PAYLOAD_TOO_LARGE` untuk body > 1 MB). */
export const BODY_LIMIT_BYTES = 1024 * 1024;

export interface BuildAppOptions {
  /** Config hasil `loadEnv()`. Bila ada, `app.prisma` dibuat dari `config.DATABASE_URL`. */
  config?: Env;
  /** Client Prisma siap pakai (mis. tes ke `ornament_test`); menang atas `config`. */
  prisma?: PrismaClient;
  /** Override logger Fastify; default dari `config` (level, redaksi, pretty di dev). */
  logger?: LoggerOption;
}

/**
 * Membangun instance Fastify tanpa memanggil `listen`, supaya bisa dipakai
 * ulang oleh server maupun tes (`app.inject`).
 *
 * Urutan: infrastruktur (validasi, request ID, error handler) → dekorator
 * (`prisma`) → rute. Tanpa `config` maupun `prisma`, app dibangun tanpa
 * database: semua rute tetap terdaftar, readiness menjawab 503.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? buildLoggerOptions(config),
    genReqId,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
  });

  registerValidation(app);
  registerRequestId(app);
  registerErrorHandling(app);

  if (options.prisma) {
    registerPrisma(app, { client: options.prisma });
  } else if (config) {
    registerPrisma(app, { databaseUrl: config.DATABASE_URL });
  }

  void app.register(healthRoutes, { prefix: '/v1' });

  return app;
}
