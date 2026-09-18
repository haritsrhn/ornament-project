/**
 * DTO `AdminUser` dan `AdminInvite` (kontrak §5.13).
 *
 * Ditulis eksplisit (whitelist), bukan hasil `omit` dari model Prisma (ADR K6,
 * model domain D9): `passwordHash` dan `tokenHash` karena itu tidak mungkin
 * ikut terkirim, bahkan bila kolom baru ditambahkan nanti.
 */

import { inviteStatusOf, type AdminInvite, type AdminUser } from '@ornament/shared';

import { toMediaRef } from '../auth/me.js';

/** Bentuk baris yang dibutuhkan DTO; sengaja bukan tipe Prisma penuh. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: AdminUser['role'];
  status: AdminUser['status'];
  lastActiveAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  avatar: {
    id: string;
    key: string;
    alt: string | null;
    width: number | null;
    height: number | null;
  } | null;
  _count: { articles: number; productsCreated: number; productRevisions: number };
}

/** `select` Prisma yang menghasilkan `UserRow` — satu sumber untuk semua query. */
export const adminUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastActiveAt: true,
  revokedAt: true,
  createdAt: true,
  avatar: { select: { id: true, key: true, alt: true, width: true, height: true } },
  _count: { select: { articles: true, productsCreated: true, productRevisions: true } },
} as const;

export function toAdminUser(user: UserRow, mediaPublicUrl?: string): AdminUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    avatar: user.avatar === null ? null : toMediaRef(user.avatar, mediaPublicUrl),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    revokedAt: user.revokedAt?.toISOString() ?? null,
    // Kolom "Konten" di tabel Users diturunkan saat query (model domain §3.1).
    contentCount: {
      articles: user._count.articles,
      products: user._count.productsCreated,
      revisions: user._count.productRevisions,
    },
    createdAt: user.createdAt.toISOString(),
  };
}

export interface InviteRow {
  id: string;
  email: string;
  role: AdminInvite['role'];
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  emailSentAt: Date | null;
  emailError: string | null;
  createdAt: Date;
  invitedBy: { id: string; name: string };
}

/** `select` Prisma yang menghasilkan `InviteRow`. `tokenHash` tidak pernah dipilih. */
export const adminInviteSelect = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  emailSentAt: true,
  emailError: true,
  createdAt: true,
  invitedBy: { select: { id: true, name: true } },
} as const;

export function toAdminInvite(invite: InviteRow, now: Date = new Date()): AdminInvite {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    // Status adalah turunan kolom waktu, bukan kolom tersendiri (§5.13).
    status: inviteStatusOf(invite, now),
    invitedBy: { id: invite.invitedBy.id, name: invite.invitedBy.name },
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
    revokedAt: invite.revokedAt?.toISOString() ?? null,
    emailSentAt: invite.emailSentAt?.toISOString() ?? null,
    emailError: invite.emailError,
    createdAt: invite.createdAt.toISOString(),
  };
}
