import { defineConfig } from 'vitest/config';

/**
 * Dua project Vitest:
 * - `unit`        tanpa database; aman dijalankan di mana saja.
 * - `integration` memakai database tes (`TEST_DATABASE_URL`, default `ornament_test`
 *   lokal). Global setup memastikan DB terjangkau dan menerapkan migrasi.
 *
 * `npm test` menjalankan keduanya; `--project unit|integration` untuk salah satu.
 */
export default defineConfig({
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
          // Koneksi pool per file; timeout lebih longgar untuk I/O database.
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
