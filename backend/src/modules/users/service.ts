/**
 * Aturan domain pengguna admin (kontrak §5.13) yang tidak boleh ada duanya di
 * dua handler: pengaman "sistem tidak boleh kehabisan Administrator".
 *
 * ── Aturan konkret ───────────────────────────────────────────────────────────
 * 1. **Peran sendiri tidak bisa diubah** (`CANNOT_CHANGE_OWN_ROLE`) dan
 *    **akses sendiri tidak bisa dicabut** (`CANNOT_REVOKE_SELF`) — apa pun
 *    jumlah Administrator. Ini bukan sekadar kenyamanan: karena pemanggil
 *    selalu Administrator **aktif** (guard `user.manage`), melarang dua aksi
 *    ini membuat sistem *secara struktural* selalu menyisakan minimal satu
 *    Administrator aktif, tanpa bergantung pada hasil `COUNT` yang bisa basi
 *    karena request lain berjalan bersamaan.
 * 2. Menurunkan peran atau mencabut **Administrator aktif terakhir** ditolak
 *    `LAST_ADMINISTRATOR`. Setelah aturan 1, kondisi ini praktis tidak
 *    tercapai lewat API (pemanggil sendiri sudah satu Administrator aktif);
 *    pemeriksaannya tetap ada sebagai jaring pengaman untuk data yang diubah
 *    di luar API (SQL manual, seed) dan untuk pesan error yang jelas.
 * 3. Nama sendiri tetap boleh diubah, dan Administrator lain tetap boleh
 *    diubah/dicabut selama aturan 2 terpenuhi.
 *
 * Konsekuensi yang disengaja: satu-satunya cara "menghapus" Administrator
 * terakhir adalah lewat database, bukan API.
 */

import { USER_BUSINESS_RULES } from '@ornament/shared';

import { AppError, businessRuleViolation } from '../../lib/errors.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** Sub-himpunan `PrismaClient` yang juga dipenuhi client transaksi. */
export type PrismaLike = Pick<PrismaClient, 'user'>;

export const cannotChangeOwnRole = (): AppError =>
  businessRuleViolation(
    USER_BUSINESS_RULES.CANNOT_CHANGE_OWN_ROLE,
    'Anda tidak bisa mengubah peran akun Anda sendiri. Minta Administrator lain melakukannya.',
  );

export const cannotRevokeSelf = (): AppError =>
  businessRuleViolation(
    USER_BUSINESS_RULES.CANNOT_REVOKE_SELF,
    'Anda tidak bisa mencabut akses akun Anda sendiri.',
  );

export const lastAdministrator = (): AppError =>
  businessRuleViolation(
    USER_BUSINESS_RULES.LAST_ADMINISTRATOR,
    'Sistem harus punya minimal satu Administrator aktif.',
  );

/** Jumlah Administrator aktif selain `exceptUserId`. */
export async function countOtherActiveAdministrators(
  prisma: PrismaLike,
  exceptUserId: string,
): Promise<number> {
  return prisma.user.count({
    where: { role: 'ADMINISTRATOR', status: 'ACTIVE', id: { not: exceptUserId } },
  });
}

/**
 * Menolak aksi yang akan menghilangkan Administrator aktif terakhir.
 * `target` adalah keadaan user **sebelum** aksi.
 */
export async function assertNotLastAdministrator(
  prisma: PrismaLike,
  target: { id: string; role: string; status: string },
): Promise<void> {
  if (target.role !== 'ADMINISTRATOR' || target.status !== 'ACTIVE') return;
  const others = await countOtherActiveAdministrators(prisma, target.id);
  if (others === 0) throw lastAdministrator();
}
