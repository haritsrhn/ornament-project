import type { FastifyInstance } from 'fastify';
import { onTestFinished } from 'vitest';

import { buildApp, type BuildAppOptions } from '../../src/app.js';

/**
 * Membangun app untuk `app.inject` dengan logger mati. Tanpa `prisma`, app
 * dibangun tanpa database (readiness → 503). App ditutup otomatis di akhir tes
 * (termasuk `$disconnect` client Prisma yang diberikan).
 *
 * Harus dipanggil di dalam `test()`. Rute tambahan boleh didaftarkan sebelum
 * request pertama / `await app.ready()`.
 */
export function buildTestApp(options: Omit<BuildAppOptions, 'logger'> = {}): FastifyInstance {
  const app = buildApp({ ...options, logger: false });
  onTestFinished(async () => {
    await app.close();
  });
  return app;
}
