import { describe, expect, test } from 'vitest';

import { assertSeedAllowed, SeedNotAllowedError } from '../../prisma/seed/guard.js';
import {
  computeStockStatus,
  MOCKUP_REFERENCE,
  parseRelativeWhen,
  parseStockQuantity,
  parseTargetShipDate,
  shiftMockupDate,
  slugify,
} from '../../prisma/seed/transform.js';

const devUrl = 'postgresql://ornament:ornament@localhost:5432/ornament?schema=public';

describe('pengaman seed', () => {
  test('menolak NODE_ENV=production', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production', DATABASE_URL: devUrl })).toThrow(
      SeedNotAllowedError,
    );
  });

  test('menolak database yang namanya tidak memuat "ornament"', () => {
    expect(() =>
      assertSeedAllowed({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://u:p@db.example.com:5432/produksi',
      }),
    ).toThrow(/memuat "ornament"/);
  });

  test('menolak DATABASE_URL kosong atau tidak valid', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL belum/);
    expect(() => assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: 'bukan-url' })).toThrow(
      /bukan URL/,
    );
  });

  test('mengizinkan database dev dan tes', () => {
    expect(assertSeedAllowed({ NODE_ENV: 'development', DATABASE_URL: devUrl }).databaseName).toBe(
      'ornament',
    );
    expect(
      assertSeedAllowed({
        NODE_ENV: 'test',
        DATABASE_URL: devUrl.replace('/ornament?', '/ornament_test?'),
      }).databaseName,
    ).toBe('ornament_test');
  });
});

describe('pengubah data mockup', () => {
  const now = new Date('2026-09-18T12:00:00Z');

  test('waktu relatif dihitung mundur dari waktu seed', () => {
    expect(parseRelativeWhen('Baru saja', now).toISOString()).toBe('2026-09-18T12:00:00.000Z');
    expect(parseRelativeWhen('3 jam lalu', now).toISOString()).toBe('2026-09-18T09:00:00.000Z');
    expect(parseRelativeWhen('Kemarin', now).toISOString()).toBe('2026-09-17T12:00:00.000Z');
    expect(parseRelativeWhen('18 mnt', now).toISOString()).toBe('2026-09-18T11:42:00.000Z');
    expect(parseRelativeWhen('4 hari lalu', now).toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  test('tanggal absolut digeser dengan jarak yang sama ke waktu seed', () => {
    // 26 Agu 2026 berada 2 hari 9 jam setelah "sekarang"-nya mockup, jadi
    // artikel terjadwal tetap di masa depan setelah digeser.
    const scheduled = shiftMockupDate('26 Agu 2026', now);
    expect(scheduled.getTime()).toBeGreaterThan(now.getTime());
    expect(scheduled.getTime() - now.getTime()).toBe(
      new Date('2026-08-26T02:00:00Z').getTime() - MOCKUP_REFERENCE.getTime(),
    );
    // 14 Agu 2026 sudah lewat di mockup → tetap lewat setelah digeser.
    expect(shiftMockupDate('14 Agu 2026', now).getTime()).toBeLessThan(now.getTime());
  });

  test('teks stok, target kirim, slug, dan status stok turunan', () => {
    expect(parseStockQuantity('84 unit siap kirim')).toBe(84);
    expect(parseStockQuantity('Lead time 45 hari')).toBeNull();
    expect(parseStockQuantity('Menunggu foto produk')).toBeNull();
    expect(parseTargetShipDate('Nov 2026')?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(parseTargetShipDate('ASAP')).toBeNull();
    expect(slugify('Storage & Basketry')).toBe('storage-basketry');

    const base = { globalLowStockThreshold: 10, lowStockThreshold: null };
    expect(computeStockStatus({ ...base, stockQuantity: null })).toBe('MADE_TO_ORDER');
    expect(computeStockStatus({ ...base, stockQuantity: 84 })).toBe('IN_STOCK');
    expect(computeStockStatus({ ...base, stockQuantity: 8 })).toBe('LOW_STOCK');
    expect(computeStockStatus({ ...base, stockQuantity: 12, lowStockThreshold: 20 })).toBe(
      'LOW_STOCK',
    );
  });
});
