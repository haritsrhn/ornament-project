/**
 * Primitif batasan kepemilikan & status untuk Contributor (kontrak §2.4,
 * §3.1, A1) — dipakai bersama oleh modul produk dan artikel.
 *
 * Guard rute (`config.adminAccess`) hanya menjawab "peran ini punya
 * tombolnya?". Berkas ini menjawab pertanyaan kedua yang tidak bisa dijawab
 * matriks izin: **"boleh untuk baris ini?"** — Contributor hanya boleh
 * menyentuh **draf miliknya sendiri** (`Product.createdById` /
 * `Article.authorId` = dirinya).
 *
 * Kode `403` sengaja memakai `details.reason` (`NOT_OWNER` / `NOT_DRAFT`)
 * seperti kontrak §2.4, bukan `404`: barisnya memang ada dan Contributor
 * memang berhak melihatnya (§3.2 "baca produk/artikel: ✓✓✓"), yang tidak
 * boleh hanyalah menulisnya.
 */

import { FORBIDDEN_REASONS, type UserRole } from '@ornament/shared';

import { AppError } from '../../lib/errors.js';

export interface Actor {
  id: string;
  role: UserRole;
}

export const notOwner = (): AppError =>
  new AppError('FORBIDDEN', 'Anda hanya dapat mengubah konten milik Anda sendiri.', {
    details: { reason: FORBIDDEN_REASONS.NOT_OWNER },
  });

export const notDraft = (): AppError =>
  new AppError('FORBIDDEN', 'Anda hanya dapat mengubah konten yang berstatus draf.', {
    details: { reason: FORBIDDEN_REASONS.NOT_DRAFT },
  });

/** Contributor adalah satu-satunya peran yang dibatasi kepemilikan (A1). */
export function isRestrictedToOwnDrafts(role: UserRole): boolean {
  return role === 'CONTRIBUTOR';
}

/**
 * Urutan pemeriksaan **kepemilikan dulu, baru status**: Contributor yang
 * melihat konten orang lain tidak perlu tahu status publikasinya.
 */
export function assertOwnDraft(
  actor: Actor,
  row: { ownerId: string | null; isDraft: boolean },
): void {
  if (!isRestrictedToOwnDrafts(actor.role)) return;
  if (row.ownerId !== actor.id) throw notOwner();
  if (!row.isDraft) throw notDraft();
}

/**
 * Kepemilikan saja, tanpa status. Dipakai untuk pemulihan dari Trash —
 * pemulihan **selalu** menghasilkan `DRAFT` (Q3), jadi Contributor tidak
 * pernah bisa menayangkan konten lewat jalur itu (A1).
 */
export function assertOwn(actor: Actor, row: { ownerId: string | null }): void {
  if (!isRestrictedToOwnDrafts(actor.role)) return;
  if (row.ownerId !== actor.id) throw notOwner();
}
