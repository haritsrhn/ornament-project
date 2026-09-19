/**
 * Filter visibilitas, sort, dan keyset katalog publik (kontrak §1.6/§1.7, §5.1).
 */

import type { PublicProductSort } from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';
import { invalidCursor, type CursorPosition } from '../../../lib/cursor.js';

/**
 * Satu-satunya definisi "produk tayang publik" (model §6.3): terbit, tidak di
 * Trash, dan punya `publishedAt`.
 *
 * `publishedAt` ikut disyaratkan karena ia kunci sort keyset: baris `PUBLISHED`
 * tanpa `publishedAt` (hanya mungkin dari data yang rusak) akan membuat urutan
 * tidak total, sehingga halaman berikutnya bisa melompat. Menyaringnya di sini
 * membuat aturan itu sama untuk daftar, detail, produk terkait, dan hitungan.
 */
export const publishedProductWhere = {
  publishStatus: 'PUBLISHED',
  deletedAt: null,
  publishedAt: { not: null },
} as const satisfies Prisma.ProductWhereInput;

/** Sort allowlist §5.1; tie-breaker `id` selalu ditambahkan server (§1.7). */
export function productOrderBy(sort: PublicProductSort): Prisma.ProductOrderByWithRelationInput[] {
  return sort === 'name'
    ? [{ name: 'asc' }, { id: 'asc' }]
    : [{ publishedAt: 'desc' }, { id: 'desc' }];
}

/**
 * `WHERE` keyset untuk halaman berikutnya: "baris setelah (nilai, id) terakhir"
 * pada urutan yang sama. Tidak memakai `OFFSET`, sehingga produk yang terbit di
 * antara dua klik tidak menggeser halaman (§1.6).
 */
export function productKeysetWhere(
  sort: PublicProductSort,
  position: CursorPosition,
): Prisma.ProductWhereInput {
  if (sort === 'name') {
    return {
      OR: [{ name: { gt: position.value } }, { name: position.value, id: { gt: position.id } }],
    };
  }

  const publishedAt = new Date(position.value);
  if (Number.isNaN(publishedAt.getTime())) throw invalidCursor();
  return {
    OR: [{ publishedAt: { lt: publishedAt } }, { publishedAt, id: { lt: position.id } }],
  };
}

/** Posisi kursor dari baris terakhir halaman ini. */
export function productCursorPosition(
  sort: PublicProductSort,
  row: { id: string; name: string; publishedAt: Date | null },
): CursorPosition {
  return {
    value: sort === 'name' ? row.name : (row.publishedAt ?? new Date(0)).toISOString(),
    id: row.id,
  };
}
