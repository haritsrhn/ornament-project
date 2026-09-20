/**
 * Slug entitas (model domain §6.1).
 *
 * Aturannya: dibuat server dari `name`/`title` (huruf kecil, `[^a-z0-9]+` →
 * `-`, tanpa `-` di awal/akhir, maks 80 karakter), **unik per tabel termasuk
 * baris di Trash** supaya pemulihan tidak pernah bentrok, dan bila bentrok
 * diberi akhiran `-2`, `-3`, ….
 */

import { SLUG_MAX_LENGTH } from '@ornament/shared';

/** Akhiran maksimum yang dicoba sebelum menyerah; praktis tidak pernah tercapai. */
const MAX_SUFFIX = 200;

/**
 * `"Kursi Lounge Rotan!"` → `"kursi-lounge-rotan"`.
 *
 * Diakritik dinormalisasi lebih dulu (`"Kayu Jatí"` → `"kayu-jati"`) agar
 * huruf beraksen tidak hilang menjadi tanda hubung.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Menambahkan akhiran `-2`, `-3`, … tanpa melewati batas panjang: basis slug
 * dipotong lebih dulu supaya `<basis>-12` tetap ≤ 80 karakter.
 */
export function slugWithSuffix(base: string, suffix: number): string {
  if (suffix <= 1) return base;
  const tail = `-${String(suffix)}`;
  return `${base.slice(0, SLUG_MAX_LENGTH - tail.length).replace(/-+$/g, '')}${tail}`;
}

/**
 * Slug unik pertama yang lolos `isTaken`.
 *
 * `isTaken` menerima *seluruh* baris tabel — termasuk yang di Trash (§6.1) —
 * sehingga pemulihan dari Trash tidak pernah bentrok dengan slug yang sempat
 * dipakai ulang selagi barisnya tersembunyi.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  // `slugify("...")` bisa menghasilkan string kosong (nama yang seluruhnya
  // non-alfanumerik). Slug kosong tidak pernah sah sebagai URL.
  const safeBase = base === '' ? 'item' : base;
  for (let suffix = 1; suffix <= MAX_SUFFIX; suffix += 1) {
    const candidate = slugWithSuffix(safeBase, suffix);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(
    `tidak menemukan slug unik untuk "${safeBase}" setelah ${String(MAX_SUFFIX)} percobaan`,
  );
}

/**
 * Slug duplikat produk (model §6.3): `<slug>-copy`, lalu `-copy-2`, `-copy-3`.
 * Dipisah dari `uniqueSlug` karena basisnya berbeda (slug asal + `-copy`),
 * bukan hasil `slugify(name)`.
 */
export async function uniqueCopySlug(
  sourceSlug: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugWithSuffix(`${sourceSlug}-copy`.slice(0, SLUG_MAX_LENGTH), 1);
  return uniqueSlug(base.replace(/-+$/g, ''), isTaken);
}
