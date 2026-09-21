/**
 * Batasan kepemilikan & status produk untuk Contributor (kontrak §2.4, §3.1, A1).
 *
 * Primitifnya (`notOwner`, `notDraft`, `assertOwn…`) ada di
 * `modules/admin/ownership.ts` karena artikel memakai aturan yang sama dengan
 * kolom yang berbeda (`Article.authorId`, `Article.status`). Yang tersisa di
 * sini hanyalah penerjemahan bentuk baris produk ke primitif itu, supaya
 * pemanggil tetap membaca "boleh menulis produk ini?" alih-alih menyusun
 * `{ ownerId, isDraft }` sendiri di setiap rute.
 */

import { assertOwn, assertOwnDraft, type Actor } from '../ownership.js';

export { isRestrictedToOwnDrafts, notDraft, notOwner, type Actor } from '../ownership.js';

export interface ProductOwnership {
  publishStatus: 'DRAFT' | 'PUBLISHED';
  createdById: string | null;
  deletedAt: Date | null;
}

const asRow = (product: ProductOwnership) => ({
  ownerId: product.createdById,
  isDraft: product.publishStatus === 'DRAFT',
});

/** Menulis produk (create dilewati: belum ada barisnya). */
export function assertCanWrite(actor: Actor, product: ProductOwnership): void {
  assertOwnDraft(actor, asRow(product));
}

/**
 * Memulihkan dari Trash. Tanpa cek status publikasi: pemulihan **selalu**
 * menghasilkan `DRAFT` (Q3), jadi kepemilikan saja sudah cukup (A1).
 */
export function assertCanRestore(actor: Actor, product: ProductOwnership): void {
  assertOwn(actor, asRow(product));
}

/** Membaca revisi: 🔒 snapshot isi produk, jadi Contributor hanya miliknya (§3.2). */
export function assertCanReadRevisions(actor: Actor, product: ProductOwnership): void {
  assertOwn(actor, asRow(product));
}
