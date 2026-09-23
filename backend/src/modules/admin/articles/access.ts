/**
 * Batasan kepemilikan & status artikel untuk Contributor (kontrak §2.4, §3.1, A1).
 *
 * Primitifnya ada di `modules/admin/ownership.ts`; yang di sini hanyalah
 * penerjemahan bentuk baris artikel (`authorId`, `status`) ke primitif itu.
 *
 * "Draf" untuk artikel berarti `status === 'DRAFT'` — bukan "belum pernah
 * terbit". Artikel `SCHEDULED` sudah punya tanggal tayang yang disetujui
 * Editor, jadi Contributor tidak boleh menyentuhnya lagi sampai ditarik.
 */

import type { ArticleStatus } from '@ornament/shared';

import { assertOwn, assertOwnDraft, type Actor } from '../ownership.js';

export { isRestrictedToOwnDrafts, notDraft, notOwner, type Actor } from '../ownership.js';

export interface ArticleOwnership {
  status: ArticleStatus;
  authorId: string;
  deletedAt: Date | null;
}

const asRow = (article: ArticleOwnership) => ({
  ownerId: article.authorId,
  isDraft: article.status === 'DRAFT',
});

/** Menulis artikel (create dilewati: belum ada barisnya). */
export function assertCanWrite(actor: Actor, article: ArticleOwnership): void {
  assertOwnDraft(actor, asRow(article));
}

/** Memulihkan dari Trash: hasilnya **selalu** `DRAFT` (Q3), jadi cukup kepemilikan. */
export function assertCanRestore(actor: Actor, article: ArticleOwnership): void {
  assertOwn(actor, asRow(article));
}

/**
 * Pratinjau (kontrak §5.9: `403 NOT_OWNER`). Kepemilikan saja, **tanpa** cek
 * status: pratinjau tidak menyimpan apa pun, jadi Contributor boleh melihat
 * hasil render draf maupun artikelnya yang sudah terbit — yang tidak boleh
 * hanyalah meminta server merender isi editor untuk tulisan orang lain.
 */
export function assertCanPreview(actor: Actor, article: ArticleOwnership): void {
  assertOwn(actor, asRow(article));
}
