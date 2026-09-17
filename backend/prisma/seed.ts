/**
 * Entry `npm run db:seed` (dan `prisma migrate reset` lewat
 * `prisma.config.ts` → `migrations.seed`).
 *
 * Alur: muat `.env` → pengaman lingkungan → seed → cetak jumlah baris.
 * Seed **tidak pernah** ikut `migrate deploy`, jadi production tidak bisa
 * ter-seed lewat pipeline rilis.
 */

import path from 'node:path';

import { createPrismaClient } from '../src/plugins/prisma.js';
import { assertSeedAllowed, SeedNotAllowedError } from './seed/guard.js';
import { seedDatabase } from './seed/seed.js';

// Prisma 7 tidak memuat `.env` otomatis (sama seperti `prisma.config.ts`).
try {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'));
} catch {
  // Tidak ada .env — pakai env proses apa adanya.
}

async function main(): Promise<void> {
  const target = assertSeedAllowed();
  console.log(`Seed → database "${target.databaseName}" …`);

  const prisma = createPrismaClient(target.databaseUrl);
  try {
    const startedAt = Date.now();
    const counts = await seedDatabase(prisma);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`Selesai dalam ${seconds} dtk. Baris per tabel:`);
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(18)} ${String(count)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof SeedNotAllowedError) {
    // Pengaman: pesan jelas, tanpa stack trace, tanpa satu pun tulisan ke DB.
    console.error(`Seed dibatalkan: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
