import { describe, expect, test } from 'vitest';

import { DEFAULT_TEST_DATABASE_URL, resolveTestDatabaseUrl } from '../helpers/database.js';

/** Pengaman helper tes: jangan pernah mengarah ke DB dev/production. */
describe('resolveTestDatabaseUrl', () => {
  test('default ke ornament_test lokal dan mengabaikan DATABASE_URL', () => {
    expect(
      resolveTestDatabaseUrl({ DATABASE_URL: 'postgresql://u:p@localhost:5432/ornament' }),
    ).toBe(DEFAULT_TEST_DATABASE_URL);
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: '' })).toBe(DEFAULT_TEST_DATABASE_URL);
  });

  test('memakai TEST_DATABASE_URL bila nama database berakhiran _test', () => {
    const url = 'postgresql://ci:ci@127.0.0.1:5433/app_test';
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: url })).toBe(url);
  });

  test.each([
    'postgresql://u:p@localhost:5432/ornament?schema=public',
    'postgresql://u:p@localhost:5432/ornament_test_backup',
    'postgresql://u:p@localhost:5432/',
  ])('menolak %s', (url) => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow(/_test/);
  });

  test('menolak URL rusak', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'bukan url' })).toThrow(
      /bukan URL yang valid/,
    );
  });
});
