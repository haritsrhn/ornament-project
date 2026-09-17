import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { registerPrisma } from './plugins/prisma.js';

export interface BuildAppOptions {
  /** Config hasil `loadEnv()`. Bila ada, `app.prisma` dibuat dari `config.DATABASE_URL`. */
  config?: Env;
  /** Client Prisma siap pakai (mis. tes ke `ornament_test`); menang atas `config`. */
  prisma?: PrismaClient;
  /** Override logger Fastify; default mengikuti `config.LOG_LEVEL`, atau `true`. */
  logger?: FastifyServerOptions['logger'];
}

/**
 * Membangun instance Fastify tanpa memanggil `listen`, supaya bisa dipakai
 * ulang oleh server maupun tes (`app.inject`).
 *
 * Tanpa `config` maupun `prisma`, app dibangun tanpa database — cukup untuk
 * menguji rute yang tidak menyentuh DB. Membuat PrismaClient tidak membuka
 * koneksi; koneksi baru dibuka pada query pertama.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { config } = options;
  const logger = options.logger ?? (config ? { level: config.LOG_LEVEL } : true);
  const app = Fastify({ logger });

  if (options.prisma) {
    registerPrisma(app, { client: options.prisma });
  } else if (config) {
    registerPrisma(app, { databaseUrl: config.DATABASE_URL });
  }

  // Rute sementara untuk memastikan server jalan; health check formal menyusul (T1.3).
  app.get('/v1', () => ({ data: { name: 'ornament-api' } }));

  return app;
}
