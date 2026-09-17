import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 tidak lagi memuat `.env` otomatis. Muat `backend/.env` bila ada
// (tanpa dependensi dotenv); env yang sudah di-set di shell/CI tidak ditimpa.
try {
  process.loadEnvFile(path.join(import.meta.dirname, '.env'));
} catch {
  // Tidak ada .env — pakai env proses apa adanya (CI, production).
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Dipakai `prisma migrate dev` dan `prisma migrate reset` — **bukan**
    // `migrate deploy`, jadi rilis production tidak pernah menjalankan seed.
    // Seed punya pengamannya sendiri (prisma/seed/guard.ts).
    seed: 'tsx prisma/seed.ts',
  },
  // `url` hanya dibutuhkan perintah yang menyentuh database (migrate, studio).
  // `prisma generate` tetap jalan tanpa DATABASE_URL, mis. saat postinstall di clone baru.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
