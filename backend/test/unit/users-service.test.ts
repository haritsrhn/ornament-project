import { describe, expect, test } from 'vitest';

import { isAppError } from '../../src/lib/errors.js';
import {
  assertNotLastAdministrator,
  cannotChangeOwnRole,
  cannotRevokeSelf,
  countOtherActiveAdministrators,
  type PrismaLike,
} from '../../src/modules/users/service.js';

/**
 * Aturan anti-lockout (#16). Diuji di sini — bukan lewat HTTP — karena
 * "Administrator aktif terakhir" adalah kondisi **global** database: di DB tes
 * yang dipakai bersama berkas lain, jumlah Administrator tidak bisa dikendalikan
 * secara deterministik.
 */

/** Client palsu: hanya `user.count` yang dipakai aturan ini. */
function fakePrisma(count: number): { prisma: PrismaLike; calls: unknown[] } {
  const calls: unknown[] = [];
  const prisma = {
    user: {
      count: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(count);
      },
    },
  } as unknown as PrismaLike;
  return { prisma, calls };
}

describe('assertNotLastAdministrator', () => {
  test('menolak 422 LAST_ADMINISTRATOR bila tidak ada Administrator aktif lain', async () => {
    const { prisma, calls } = fakePrisma(0);
    const target = { id: 'u1', role: 'ADMINISTRATOR', status: 'ACTIVE' };

    const error = await assertNotLastAdministrator(prisma, target).catch((e: unknown) => e);
    expect(isAppError(error)).toBe(true);
    if (!isAppError(error)) return;
    expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(error.statusCode).toBe(422);
    expect(error.details).toEqual({ rule: 'LAST_ADMINISTRATOR' });

    // Dirinya sendiri tidak ikut dihitung.
    expect(calls).toEqual([
      { where: { role: 'ADMINISTRATOR', status: 'ACTIVE', id: { not: 'u1' } } },
    ]);
  });

  test('mengizinkan bila masih ada Administrator aktif lain', async () => {
    const { prisma } = fakePrisma(2);
    await expect(
      assertNotLastAdministrator(prisma, { id: 'u1', role: 'ADMINISTRATOR', status: 'ACTIVE' }),
    ).resolves.toBeUndefined();
  });

  test('target bukan Administrator aktif tidak perlu dihitung sama sekali', async () => {
    const { prisma, calls } = fakePrisma(0);
    await expect(
      assertNotLastAdministrator(prisma, { id: 'u1', role: 'EDITOR', status: 'ACTIVE' }),
    ).resolves.toBeUndefined();
    await expect(
      assertNotLastAdministrator(prisma, { id: 'u1', role: 'ADMINISTRATOR', status: 'REVOKED' }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  test('countOtherActiveAdministrators mengecualikan id yang diberikan', async () => {
    const { prisma, calls } = fakePrisma(3);
    expect(await countOtherActiveAdministrators(prisma, 'u9')).toBe(3);
    expect(calls).toEqual([
      { where: { role: 'ADMINISTRATOR', status: 'ACTIVE', id: { not: 'u9' } } },
    ]);
  });
});

describe('kode aturan kontrak §5.13', () => {
  test('CANNOT_CHANGE_OWN_ROLE & CANNOT_REVOKE_SELF memakai 422 + details.rule', () => {
    for (const [error, rule] of [
      [cannotChangeOwnRole(), 'CANNOT_CHANGE_OWN_ROLE'],
      [cannotRevokeSelf(), 'CANNOT_REVOKE_SELF'],
    ] as const) {
      expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual({ rule });
    }
  });
});
