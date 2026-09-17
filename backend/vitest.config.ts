import { defineConfig } from 'vitest/config';

/**
 * Dua project Vitest:
 * - `unit`        tanpa database; aman dijalankan di mana saja.
 * - `integration` memakai database tes (`TEST_DATABASE_URL`, default `ornament_test`
 *   lokal). Global setup memastikan DB terjangkau dan menerapkan migrasi.
 *
 * `npm test` menjalankan keduanya; `--project unit|integration` untuk salah satu.
 *
 * `@ornament/source`: `@ornament/shared` di-resolve ke `src/*.ts` (bukan `dist/`),
 * sama seperti `npm run dev` (tsx), sehingga perubahan skema bersama langsung
 * teruji tanpa build ulang. Sisanya = kondisi server bawaan Vite
 * (`defaultServerConditions`), karena opsi ini menggantikan default.
 */
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@ornament/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/integration/global-setup.ts'],
          // Berkas dijalankan berurutan: `seed.test.ts` mengosongkan dan
          // mengisi ulang seluruh database tes, jadi ia tidak boleh berjalan
          // bersamaan dengan berkas lain yang memakai DB yang sama.
          fileParallelism: false,
          // Koneksi pool per file; timeout lebih longgar untuk I/O database.
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
