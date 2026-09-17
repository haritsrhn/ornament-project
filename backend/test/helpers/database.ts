import { createPrismaClient } from '../../src/plugins/prisma.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/** Default lokal: database tes di container docker-compose root. */
export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://ornament:ornament@localhost:5432/ornament_test?schema=public';

/**
 * URL database tes. Sengaja **tidak** membaca `DATABASE_URL` (yang di mesin dev
 * menunjuk DB `ornament`), dan menolak nama database yang tidak berakhiran
 * `_test` agar tes tidak pernah menyentuh DB dev/production.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TEST_DATABASE_URL;
  const url = raw === undefined || raw === '' ? DEFAULT_TEST_DATABASE_URL : raw;

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL bukan URL yang valid.');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL harus menunjuk database berakhiran "_test" (sekarang: "${databaseName}").`,
    );
  }
  return url;
}

/** Client Prisma ke database tes. Pemanggil (atau `app.close()`) wajib menutupnya. */
export function createTestPrisma(url: string = resolveTestDatabaseUrl()): PrismaClient {
  return createPrismaClient(url);
}
