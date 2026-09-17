import { defineConfig } from 'vitest/config';

/** Tes unit skema kontrak; tanpa database, tanpa server. */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
