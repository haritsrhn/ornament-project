import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export type BuildAppOptions = Pick<FastifyServerOptions, 'logger'>;

/**
 * Membangun instance Fastify tanpa memanggil `listen`, supaya bisa dipakai
 * ulang oleh server maupun tes (`app.inject`).
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  // Rute sementara untuk memastikan server jalan; health check formal menyusul (T1.3).
  app.get('/v1', () => ({ data: { name: 'ornament-api' } }));

  return app;
}
