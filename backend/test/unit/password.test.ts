import { describe, expect, test } from 'vitest';

import {
  hashPassword,
  needsRehash,
  PASSWORD_HASH_PARAMS,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../src/lib/password.js';

/** Penanda yang dipakai seed T2.4 sebelum modul auth ada. */
const LEGACY_SEED_MARKER = 'seed-only$no-login$bukan-hash-argon2id-yang-sah';

describe('hashPassword', () => {
  test('menghasilkan PHC argon2id dengan parameter kebijakan', async () => {
    const hash = await hashPassword('kata-sandi-dev-1');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(PASSWORD_HASH_PARAMS).toMatchObject({
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      outputLen: 32,
    });
  });

  test('salt acak: dua hash dari sandi yang sama berbeda, keduanya sah', async () => {
    const [a, b] = await Promise.all([hashPassword('sandi-sama'), hashPassword('sandi-sama')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'sandi-sama')).toBe(true);
    expect(await verifyPassword(b, 'sandi-sama')).toBe(true);
  });

  test('hash tidak memuat kata sandi mentah', async () => {
    const password = 'rahasia-yang-tidak-boleh-muncul';
    expect(await hashPassword(password)).not.toContain(password);
  });
});

describe('verifyPassword', () => {
  test('menerima sandi benar dan menolak yang salah (termasuk beda kapitalisasi)', async () => {
    const hash = await hashPassword('Sandi-Benar-9');
    expect(await verifyPassword(hash, 'Sandi-Benar-9')).toBe(true);
    expect(await verifyPassword(hash, 'sandi-benar-9')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  test('hash rusak/bukan argon2 → false, bukan throw', async () => {
    expect(await verifyPassword(LEGACY_SEED_MARKER, 'apa pun')).toBe(false);
    expect(await verifyPassword('', 'apa pun')).toBe(false);
    expect(await verifyPassword('$argon2id$rusak', 'apa pun')).toBe(false);
  });
});

describe('needsRehash', () => {
  test('hash dengan parameter sekarang tidak perlu ditulis ulang', async () => {
    expect(needsRehash(await hashPassword('x'.repeat(10)))).toBe(false);
  });

  test('parameter lebih lemah dianggap usang', () => {
    // Batas bawah OWASP (m=19456, t=2) — sah, tapi di bawah kebijakan kami.
    expect(
      needsRehash('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$' + 'a'.repeat(43)),
    ).toBe(true);
  });

  test('argon2i (bukan argon2id) dianggap usang', () => {
    expect(
      needsRehash('$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$' + 'a'.repeat(43)),
    ).toBe(true);
  });

  test('bukan hash argon2 sama sekali dianggap usang', () => {
    expect(needsRehash(LEGACY_SEED_MARKER)).toBe(true);
  });
});

describe('verifyAgainstDummyHash', () => {
  test('selalu selesai tanpa melempar dan biayanya sebanding verifikasi nyata', async () => {
    const real = await hashPassword('sandi-nyata-1');

    const t0 = performance.now();
    await verifyPassword(real, 'sandi-salah-1');
    const realMs = performance.now() - t0;

    const t1 = performance.now();
    await verifyAgainstDummyHash('sandi-salah-1');
    const dummyMs = performance.now() - t1;

    // Ambang sengaja longgar (CI bisa berisik); yang penting ordenya sama,
    // bukan "instan" seperti kalau verifikasi dilewati sama sekali.
    expect(dummyMs).toBeGreaterThan(realMs / 10);
  });
});
