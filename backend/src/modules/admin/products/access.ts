/**
 * Batasan kepemilikan & status untuk Contributor (kontrak §2.4, §3.1, A1).
 *
 * Guard rute (`config.adminAccess`) hanya menjawab "peran ini punya tombolnya?".
 * Berkas ini menjawab pertanyaan kedua yang tidak bisa dijawab matriks izin:
 * **"boleh untuk baris ini?"** — Contributor hanya boleh menyentuh **draf
 * miliknya sendiri** (`Product.createdById` = dirinya).
 *
 * Kode `403` sengaja memakai `details.reason` (`NOT_OWNER` / `NOT_DRAFT`)
 * seperti kontrak §2.4, bukan `404`: barisnya memang ada dan Contributor
 * memang berhak melihatnya (§3.2 "baca produk: ✓✓✓"), yang tidak boleh
 * hanyalah menulisnya.
 */

import { FORBIDDEN_REASONS, type UserRole } from '@ornament/shared';

import { AppError } from '../../../lib/errors.js';

export interface ProductOwnership {
  publishStatus: 'DRAFT' | 'PUBLISHED';
  createdById: string | null;
  deletedAt: Date | null;
}

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
 * Menulis produk (create dilewati: belum ada barisnya). Urutan pemeriksaan
 * **kepemilikan dulu, baru status**: Contributor yang melihat produk orang
 * lain tidak perlu tahu status publikasinya.
 */
export function assertCanWrite(actor: Actor, product: ProductOwnership): void {
  if (!isRestrictedToOwnDrafts(actor.role)) return;
  if (product.createdById !== actor.id) throw notOwner();
  if (product.publishStatus !== 'DRAFT') throw notDraft();
}

/**
 * Memulihkan dari Trash. Tanpa cek status publikasi: pemulihan **selalu**
 * menghasilkan `DRAFT` (Q3), jadi Contributor tidak pernah bisa menayangkan
 * konten lewat jalur ini — kepemilikan saja sudah cukup (A1).
 */
export function assertCanRestore(actor: Actor, product: ProductOwnership): void {
  if (!isRestrictedToOwnDrafts(actor.role)) return;
  if (product.createdById !== actor.id) throw notOwner();
}

/** Membaca revisi: 🔒 snapshot isi produk, jadi Contributor hanya miliknya (§3.2). */
export function assertCanReadRevisions(actor: Actor, product: ProductOwnership): void {
  if (!isRestrictedToOwnDrafts(actor.role)) return;
  if (product.createdById !== actor.id) throw notOwner();
}
