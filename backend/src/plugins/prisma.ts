import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';

import { PrismaClient } from '../generated/prisma/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export interface PrismaPluginOptions {
  /** Client yang sudah jadi (mis. dari tes); bila tidak ada, dibuat dari `databaseUrl`. */
  client?: PrismaClient;
  databaseUrl?: string;
}

/**
 * Mendekorasi `app.prisma` dan memutus koneksi saat `app.close()`.
 * Fungsi biasa (bukan `fastify-plugin`) — dipanggil langsung di root instance
 * sehingga dekorasi terlihat di semua rute.
 *
 * Koneksi pool dibuka secara malas pada query pertama; plugin ini tidak
 * menyentuh database saat didaftarkan.
 */
export function registerPrisma(app: FastifyInstance, options: PrismaPluginOptions): void {
  const client =
    options.client ??
    (options.databaseUrl !== undefined ? createPrismaClient(options.databaseUrl) : undefined);
  if (!client) throw new Error('registerPrisma membutuhkan `client` atau `databaseUrl`');

  app.decorate('prisma', client);
  app.addHook('onClose', async () => {
    await client.$disconnect();
  });
}
