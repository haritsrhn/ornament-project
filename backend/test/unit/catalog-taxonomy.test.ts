import { describe, expect, test } from 'vitest';

import {
  categoryBranchIds,
  flattenTree,
  rollUpCounts,
  type CategoryNode,
} from '../../src/modules/public/products/taxonomy.js';
import { artisanProfileIsPublic, originOf } from '../../src/modules/public/products/dto.js';

/** Pohon kategori publik & turunan `origin` (kontrak §5.1, model §3.5/§6.7). */

const node = (id: string, slug: string, parentId: string | null, position = 0): CategoryNode => ({
  id,
  slug,
  name: slug,
  parentId,
  description: null,
  position,
});

//  furniture
//    ├─ kursi
//    │    └─ kursi-lounge
//    └─ meja
//  lighting
const TREE: CategoryNode[] = [
  node('lighting', 'lighting', null, 1),
  node('meja', 'meja', 'furniture', 1),
  node('furniture', 'furniture', null, 0),
  node('kursi-lounge', 'kursi-lounge', 'kursi', 0),
  node('kursi', 'kursi', 'furniture', 0),
];

describe('flattenTree', () => {
  test('datar tetapi urut pohon: induk mendahului anaknya, urut position', () => {
    expect(flattenTree(TREE).map((entry) => entry.node.slug)).toEqual([
      'furniture',
      'kursi',
      'kursi-lounge',
      'meja',
      'lighting',
    ]);
  });

  test('depth mengikuti tingkat kedalaman', () => {
    const depths = new Map(flattenTree(TREE).map((e) => [e.node.slug, e.depth]));
    expect(depths.get('furniture')).toBe(0);
    expect(depths.get('kursi')).toBe(1);
    expect(depths.get('kursi-lounge')).toBe(2);
  });

  test('kategori yatim tetap dikirim, bukan hilang diam-diam', () => {
    const yatim = [...TREE, node('lepas', 'lepas', 'induk-yang-tidak-ada')];
    expect(flattenTree(yatim)).toHaveLength(yatim.length);
  });
});

describe('categoryBranchIds', () => {
  test('mengembalikan kategori beserta seluruh turunannya', () => {
    expect(new Set(categoryBranchIds(TREE, 'furniture'))).toEqual(
      new Set(['furniture', 'kursi', 'kursi-lounge', 'meja']),
    );
    expect(categoryBranchIds(TREE, 'kursi')).toEqual(
      expect.arrayContaining(['kursi', 'kursi-lounge']),
    );
    expect(categoryBranchIds(TREE, 'lighting')).toEqual(['lighting']);
  });

  test('slug tak dikenal → null (pemanggil menjawab data kosong, bukan 404)', () => {
    expect(categoryBranchIds(TREE, 'entah-apa')).toBeNull();
  });
});

describe('rollUpCounts', () => {
  test('hitungan anak ikut dijumlahkan ke setiap leluhur', () => {
    const totals = rollUpCounts(
      TREE,
      new Map([
        ['kursi-lounge', 3],
        ['meja', 2],
        ['lighting', 5],
      ]),
    );

    expect(totals.get('kursi-lounge')).toBe(3);
    expect(totals.get('kursi')).toBe(3);
    expect(totals.get('furniture')).toBe(5);
    expect(totals.get('lighting')).toBe(5);
  });
});

describe('turunan kartu produk', () => {
  test('origin dirangkai dari village + regency', () => {
    expect(originOf({ village: 'Bangunjiwo', regency: 'Bantul' })).toBe('Bangunjiwo, Bantul');
    expect(originOf({ village: null, regency: 'Bantul' })).toBe('Bantul');
    expect(originOf(null)).toBeNull();
  });

  test('profil pengrajin publik hanya ACTIVE/FULL_CAPACITY yang tidak diarsipkan', () => {
    expect(artisanProfileIsPublic({ status: 'ACTIVE', archivedAt: null })).toBe(true);
    expect(artisanProfileIsPublic({ status: 'FULL_CAPACITY', archivedAt: null })).toBe(true);
    expect(artisanProfileIsPublic({ status: 'VERIFICATION', archivedAt: null })).toBe(false);
    expect(artisanProfileIsPublic({ status: 'ACTIVE', archivedAt: new Date() })).toBe(false);
  });
});
