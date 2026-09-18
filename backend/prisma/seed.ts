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
import { resolveSeedPassword, seedDatabase } from './seed/seed.js';

// Prisma 7 tidak memuat `.env` otomatis (sama seperti `prisma.config.ts`).
try {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env'));
} catch {
  // Tidak ada .env — pakai env proses apa adanya.
}

async function main(): Promise<void> {
  const target = assertSeedAllowed();
  console.log(`Seed → database "${target.databaseName}" …`);

  const password = resolveSeedPassword();
  const prisma = createPrismaClient(target.databaseUrl);
  try {
    const startedAt = Date.now();
    const counts = await seedDatabase(prisma, { password });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`Selesai dalam ${seconds} dtk. Baris per tabel:`);
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(18)} ${String(count)}`);
    }
    // Dicetak dengan sengaja: akun seed tidak ada gunanya kalau kata sandinya
    // harus ditebak, dan seed hanya boleh jalan di dev/tes (`guard.ts`).
    console.log(
      `\nLogin admin lokal: rani@ornament.id / ${password}\n` +
        '(kata sandi dev untuk SEMUA akun seed; atur SEED_ADMIN_PASSWORD untuk mengubahnya)',
    );
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
