import {
  deriveStockStatus,
  stockQuantityConflictsWithStatus,
  SLUG_MAX_LENGTH,
} from '@ornament/shared';
import { describe, expect, test } from 'vitest';

import { slugify, slugWithSuffix, uniqueCopySlug, uniqueSlug } from '../../src/lib/slug.js';
import {
  publishRequirementIssues,
  toPublishReadiness,
} from '../../src/modules/admin/products/dto.js';
import {
  buildSkuSuggestion,
  formatSkuSuggestion,
  yearMonthCode,
} from '../../src/modules/admin/products/sku.js';

/**
 * Aturan produk yang tidak butuh database (model §6.1 slug, §6.2 SKU, §6.3
 * stok & syarat publish). Diuji terpisah dari tes integrasi supaya kegagalan
 * aturannya terbaca langsung, bukan tersembunyi di balik satu respons HTTP.
 */

describe('slug (model §6.1)', () => {
  test('huruf kecil, non-alfanumerik menjadi tanda hubung, tanpa hubung di tepi', () => {
    expect(slugify('  Kursi Lounge Rotan!  ')).toBe('kursi-lounge-rotan');
    expect(slugify('Kayu Jatí — Reclaimed')).toBe('kayu-jati-reclaimed');
    expect(slugify('***')).toBe('');
  });

  test('tidak pernah melebihi 80 karakter, termasuk setelah diberi akhiran', () => {
    const panjang = slugify('a'.repeat(200));
    expect(panjang).toHaveLength(SLUG_MAX_LENGTH);
    expect(slugWithSuffix(panjang, 12).length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slugWithSuffix(panjang, 12).endsWith('-12')).toBe(true);
  });

  test('akhiran -2, -3 dipakai saat bentrok', async () => {
    const terpakai = new Set(['kursi-rotan', 'kursi-rotan-2']);
    await expect(
      uniqueSlug(slugify('Kursi Rotan'), (candidate) => Promise.resolve(terpakai.has(candidate))),
    ).resolves.toBe('kursi-rotan-3');
  });

  test('nama yang seluruhnya non-alfanumerik tetap menghasilkan slug yang sah', async () => {
    await expect(uniqueSlug(slugify('***'), () => Promise.resolve(false))).resolves.toBe('item');
  });

  test('duplikat memakai <slug>-copy, lalu -copy-2 (model §6.3)', async () => {
    const terpakai = new Set(['kursi-rotan-copy']);
    await expect(
      uniqueCopySlug('kursi-rotan', (candidate) => Promise.resolve(terpakai.has(candidate))),
    ).resolves.toBe('kursi-rotan-copy-2');
    await expect(uniqueCopySlug('kursi-rotan', () => Promise.resolve(false))).resolves.toBe(
      'kursi-rotan-copy',
    );
  });
});

describe('status stok turunan (model §6.3 Q13)', () => {
  test('override menang atas perhitungan apa pun', () => {
    expect(
      deriveStockStatus({
        stockStatusOverride: 'IN_STOCK',
        stockQuantity: 0,
        effectiveLowStockThreshold: 10,
      }),
    ).toBe('IN_STOCK');
  });

  test('tanpa jumlah stok → MADE_TO_ORDER', () => {
    expect(
      deriveStockStatus({
        stockStatusOverride: null,
        stockQuantity: null,
        effectiveLowStockThreshold: 10,
      }),
    ).toBe('MADE_TO_ORDER');
  });

  test('jumlah <= ambang → LOW_STOCK, selebihnya IN_STOCK', () => {
    const base = { stockStatusOverride: null, effectiveLowStockThreshold: 10 } as const;
    expect(deriveStockStatus({ ...base, stockQuantity: 10 })).toBe('LOW_STOCK');
    expect(deriveStockStatus({ ...base, stockQuantity: 11 })).toBe('IN_STOCK');
  });

  test('A11: hanya MADE_TO_ORDER efektif yang melarang stockQuantity', () => {
    expect(
      stockQuantityConflictsWithStatus({
        stockStatusOverride: 'MADE_TO_ORDER',
        stockQuantity: 5,
        effectiveLowStockThreshold: 10,
      }),
    ).toBe(true);
    // Override IN_STOCK dengan jumlah 0 tetap boleh (A11 eksplisit).
    expect(
      stockQuantityConflictsWithStatus({
        stockStatusOverride: 'IN_STOCK',
        stockQuantity: 0,
        effectiveLowStockThreshold: 10,
      }),
    ).toBe(false);
  });
});

describe('syarat publish (model §6.3)', () => {
  const lengkap = {
    name: 'Kursi Lounge',
    sku: 'ORN-RTN-0142',
    categoryId: 'c1',
    artisanId: 'a1',
    primaryImageId: 'm1',
    moqQuantity: 50,
    materials: [{ isPrimary: true }, { isPrimary: false }],
    artisan: { archivedAt: null },
  };

  test('produk lengkap siap terbit', () => {
    expect(publishRequirementIssues(lengkap)).toEqual([]);
    expect(toPublishReadiness([])).toEqual({ ready: true, missing: [] });
  });

  test('field kosong dilaporkan dengan path dan kode required', () => {
    const issues = publishRequirementIssues({
      ...lengkap,
      sku: null,
      artisanId: null,
      primaryImageId: null,
      artisan: null,
      materials: [],
    });
    expect(issues).toEqual([
      { path: 'sku', code: 'required' },
      { path: 'artisanId', code: 'required' },
      { path: 'primaryImageId', code: 'required' },
      { path: 'materials', code: 'required' },
    ]);
    expect(toPublishReadiness(issues).missing).toEqual([
      'sku',
      'artisanId',
      'primaryImageId',
      'materials',
    ]);
  });

  test('dua material primer tidak dianggap "tepat satu"', () => {
    const issues = publishRequirementIssues({
      ...lengkap,
      materials: [{ isPrimary: true }, { isPrimary: true }],
    });
    expect(issues).toEqual([{ path: 'materials', code: 'required' }]);
  });

  test('pengrajin yang diarsipkan memakai kode berbeda, bukan "required"', () => {
    const issues = publishRequirementIssues({ ...lengkap, artisan: { archivedAt: new Date() } });
    expect(issues).toEqual([{ path: 'artisanId', code: 'artisan_archived' }]);
  });
});

describe('saran SKU (model §6.2)', () => {
  test('NNNN dipadding minimal 4 digit dan tidak dipotong setelah 9999', () => {
    expect(formatSkuSuggestion('RTN', 142)).toBe('ORN-RTN-0142');
    expect(formatSkuSuggestion('RTN', 12_345)).toBe('ORN-RTN-12345');
  });

  test('material primer dengan skuCode dipakai apa adanya', () => {
    expect(buildSkuSuggestion(143, { materialSkuCode: 'RTN', timezone: 'Asia/Jakarta' })).toBe(
      'ORN-RTN-0143',
    );
  });

  test('tanpa skuCode memakai YYMM pada zona SiteSetting, bukan UTC', () => {
    // 31 Agustus 22.00 UTC = 1 September 05.00 WIB → kodenya bulan September.
    const now = new Date('2026-08-31T22:00:00.000Z');
    expect(yearMonthCode(now, 'UTC')).toBe('2608');
    expect(yearMonthCode(now, 'Asia/Jakarta')).toBe('2609');
    expect(buildSkuSuggestion(143, { materialSkuCode: null, timezone: 'Asia/Jakarta', now })).toBe(
      'ORN-2609-0143',
    );
  });
});
