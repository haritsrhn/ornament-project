/**
 * Pengaman seed (T2.4). Seed **menghapus seluruh isi database** sebelum mengisi
 * ulang, jadi ia hanya boleh menyentuh database pengembangan/tes.
 *
 * Dua lapis, keduanya dijalankan sebelum koneksi dibuka:
 * 1. `NODE_ENV=production` → tolak. Seed tidak pernah ikut `migrate deploy`
 *    (lihat `prisma.config.ts`: `migrations.seed` hanya dipakai `migrate dev`
 *    dan `migrate reset`, bukan `migrate deploy`).
 * 2. Nama database pada `DATABASE_URL` harus memuat `ornament`
 *    (mis. `ornament`, `ornament_test`, `ornament_dev_ana`). Pengaman sederhana
 *    dan sengaja longgar — ia mencegah salah tunjuk (DB lain di host yang sama,
 *    URL production yang tercecer di shell), bukan menggantikan kebijakan akses.
 */

export class SeedNotAllowedError extends Error {
  override readonly name = 'SeedNotAllowedError';
}

export interface SeedTarget {
  databaseUrl: string;
  databaseName: string;
}

/** Nama database dari URL Postgres (`postgresql://…/<nama>?…`). */
export function databaseNameFromUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new SeedNotAllowedError('DATABASE_URL bukan URL yang valid.');
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

/**
 * Memastikan seed boleh dijalankan terhadap `env.DATABASE_URL`.
 * Melempar `SeedNotAllowedError` (tanpa menulis apa pun) bila tidak.
 */
export function assertSeedAllowed(env: NodeJS.ProcessEnv = process.env): SeedTarget {
  if (env.NODE_ENV === 'production') {
    throw new SeedNotAllowedError(
      'Seed tidak boleh dijalankan di production (NODE_ENV=production). ' +
        'Seed menghapus seluruh isi database sebelum mengisi data mockup.',
    );
  }

  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new SeedNotAllowedError('DATABASE_URL belum di-set; seed butuh database tujuan.');
  }

  const databaseName = databaseNameFromUrl(databaseUrl);
  if (!databaseName.includes('ornament')) {
    throw new SeedNotAllowedError(
      `Seed hanya boleh menunjuk database yang namanya memuat "ornament" ` +
        `(mis. "ornament", "ornament_test"); DATABASE_URL menunjuk "${databaseName}". ` +
        'Tidak ada data yang ditulis.',
    );
  }

  return { databaseUrl, databaseName };
}
