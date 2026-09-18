/**
 * DTO `Me` (kontrak §2.2). Ditulis eksplisit — tipe Prisma tidak pernah bocor
 * ke kontrak (ADR K6), sehingga `passwordHash` dan kolom internal lain tidak
 * mungkin ikut terkirim.
 */

import { permissionsForRole, type Me, type MediaRef } from '@ornament/shared';

import type { SessionUser } from './session.js';

/**
 * `MediaRef` untuk avatar. Dipakai `Me` dan `AdminUser` (kontrak §5.13) supaya
 * keduanya membentuk URL dengan aturan yang sama.
 */
export function toMediaRef(
  avatar: NonNullable<SessionUser['avatar']>,
  publicBaseUrl: string | undefined,
): MediaRef {
  return {
    id: avatar.id,
    // URL publik R2 baru ada saat modul media dibangun (ADR K3); sampai itu
    // `url` null — kontrak memang mengizinkan `string | null`.
    url: publicBaseUrl === undefined ? null : `${publicBaseUrl.replace(/\/$/, '')}/${avatar.key}`,
    alt: avatar.alt,
    width: avatar.width,
    height: avatar.height,
  };
}

/**
 * `permissions` diturunkan dari `role` lewat tabel di `@ornament/shared`
 * (kontrak §3.3). Frontend memakainya untuk menyembunyikan tombol; server tetap
 * memeriksa izin di setiap rute (matriks per endpoint menyusul di #15).
 */
export function toMe(user: SessionUser, publicBaseUrl?: string): Me {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    avatar: user.avatar === null ? null : toMediaRef(user.avatar, publicBaseUrl),
    lastActiveAt: user.lastActiveAt === null ? null : user.lastActiveAt.toISOString(),
    permissions: permissionsForRole(user.role),
  };
}
