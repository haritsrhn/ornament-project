import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import {
  ARTICLES,
  ARTISANS,
  CATEGORIES_TREE,
  INQUIRIES,
  PRODUCTS,
  USERS,
} from '../../prisma/seed/source-data.js';

/**
 * `prisma/seed/source-data.ts` adalah salinan `frontend/lib/data.ts` (alasannya
 * ada di berkas itu: paket frontend tidak bisa diimpor dari backend yang
 * memakai `moduleResolution: NodeNext` dan `rootDir`).
 *
 * Supaya salinan itu tidak diam-diam tertinggal, tes ini membaca berkas sumber
 * sebagai **teks** — bukan mengimpornya, agar `tsc` tidak ikut menarik berkas
 * frontend ke dalam proyek backend — lalu membandingkan kunci alaminya: slug
 * produk/artikel/pengrajin/kategori dan email pengguna/inquiry. Penambahan,
 * penghapusan, atau penggantian nama di mockup akan membuat tes ini gagal.
 */
const sourcePath = path.resolve(import.meta.dirname, '../../../frontend/lib/data.ts');
const sourceText = readFileSync(sourcePath, 'utf8');

function valuesOf(key: string): string[] {
  return [...sourceText.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, 'g'))]
    .map((match) => match[1] ?? '')
    .sort();
}

test('slug di salinan data mockup sama dengan frontend/lib/data.ts', () => {
  const expected = [
    ...PRODUCTS.map((row) => row.slug),
    ...ARTISANS.map((row) => row.slug),
    ...ARTICLES.map((row) => row.slug),
    ...CATEGORIES_TREE.map((row) => row.slug),
  ].sort();

  expect(valuesOf('slug')).toStrictEqual(expected);
});

test('email di salinan data mockup sama dengan frontend/lib/data.ts', () => {
  const expected = [...USERS.map((row) => row.email), ...INQUIRIES.map((row) => row.email)].sort();

  expect(valuesOf('email')).toStrictEqual(expected);
});
