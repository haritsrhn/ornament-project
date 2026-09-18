import { describe, expect, test } from 'vitest';

import {
  adminUsersQuerySchema,
  adminInvitesQuerySchema,
  createInviteBodySchema,
  inviteStatusOf,
  rolesWithPermission,
  updateUserBodySchema,
  USER_BUSINESS_RULES,
} from '../src/index.js';

describe('rolesWithPermission (kontrak §3)', () => {
  test('user.manage & settings.manage hanya Administrator', () => {
    expect(rolesWithPermission('user.manage')).toEqual(['ADMINISTRATOR']);
    expect(rolesWithPermission('settings.manage')).toEqual(['ADMINISTRATOR']);
  });

  test('izin yang dibagi memberi daftar peran urut USER_ROLES', () => {
    expect(rolesWithPermission('product.publish')).toEqual(['ADMINISTRATOR', 'EDITOR']);
    expect(rolesWithPermission('media.upload')).toEqual(['ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR']);
  });
});

describe('inviteStatusOf (status turunan, §5.13)', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');
  const besok = new Date('2026-09-19T12:00:00.000Z');
  const kemarin = new Date('2026-09-17T12:00:00.000Z');

  test('urutan prioritas: diterima → dicabut → kedaluwarsa → tertunda', () => {
    expect(
      inviteStatusOf({ acceptedAt: kemarin, revokedAt: kemarin, expiresAt: kemarin }, now),
    ).toBe('ACCEPTED');
    expect(inviteStatusOf({ acceptedAt: null, revokedAt: kemarin, expiresAt: besok }, now)).toBe(
      'REVOKED',
    );
    expect(inviteStatusOf({ acceptedAt: null, revokedAt: null, expiresAt: kemarin }, now)).toBe(
      'EXPIRED',
    );
    expect(inviteStatusOf({ acceptedAt: null, revokedAt: null, expiresAt: besok }, now)).toBe(
      'PENDING',
    );
  });

  test('tepat pada detik kedaluwarsa sudah dianggap EXPIRED', () => {
    expect(inviteStatusOf({ acceptedAt: null, revokedAt: null, expiresAt: now }, now)).toBe(
      'EXPIRED',
    );
  });
});

describe('query & body pengguna', () => {
  test('default: halaman 1, 20 baris, status ACTIVE, sort name', () => {
    expect(adminUsersQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      status: 'ACTIVE',
      sort: 'name',
    });
  });

  test('sort di luar allowlist ditolak', () => {
    expect(adminUsersQuerySchema.safeParse({ sort: 'email' }).success).toBe(false);
  });

  test('daftar undangan default PENDING', () => {
    expect(adminInvitesQuerySchema.parse({})).toEqual({ status: 'PENDING' });
  });

  test('PATCH pengguna wajib berisi minimal satu field', () => {
    expect(updateUserBodySchema.safeParse({}).success).toBe(false);
    expect(updateUserBodySchema.parse({ name: '  Rani  ' })).toEqual({ name: 'Rani' });
    expect(updateUserBodySchema.safeParse({ name: 'Rani', peran: 'EDITOR' }).success).toBe(false);
  });

  test('undangan hanya menerima email @ornament.id, dinormalisasi', () => {
    expect(createInviteBodySchema.parse({ email: ' Dimas@Ornament.ID ', role: 'EDITOR' })).toEqual({
      email: 'dimas@ornament.id',
      role: 'EDITOR',
    });
    const gagal = createInviteBodySchema.safeParse({ email: 'x@gmail.com', role: 'EDITOR' });
    expect(gagal.success).toBe(false);
    expect(gagal.error?.issues[0]?.code).toBe('custom');
  });

  test('kode aturan domain stabil', () => {
    expect(Object.values(USER_BUSINESS_RULES)).toEqual([
      'LAST_ADMINISTRATOR',
      'CANNOT_CHANGE_OWN_ROLE',
      'CANNOT_REVOKE_SELF',
    ]);
  });
});
