import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { serviceUnavailable } from '../lib/errors.js';
import { dataEnvelope, ok } from '../lib/http.js';

/** Batas waktu `SELECT 1` readiness; LB tidak boleh menunggu lama. */
export const READINESS_TIMEOUT_MS = 2000;

const healthResponse = dataEnvelope(z.object({ status: z.literal('ok') }));

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout ${String(ms)} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * - `GET /health` — liveness: proses hidup, tanpa menyentuh DB.
 * - `GET /health/ready` — readiness: `SELECT 1` ke DB. Gagal/timeout, atau app
 *   dibangun tanpa DB → `503 SERVICE_UNAVAILABLE`.
 */
export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.get('/health', { schema: { response: { 200: healthResponse } }, logLevel: 'warn' }, () =>
    ok({ status: 'ok' as const }),
  );

  app.get('/health/ready', { schema: { response: { 200: healthResponse } } }, async () => {
    if (!app.hasDecorator('prisma')) {
      throw serviceUnavailable('Database tidak dikonfigurasi.');
    }
    try {
      await withTimeout(app.prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    } catch (err) {
      // Dicatat (beserta cause) oleh error handler sebagai 5xx.
      throw serviceUnavailable('Database tidak dapat dihubungi.', err);
    }
    return ok({ status: 'ok' as const });
  });

  return Promise.resolve();
};
