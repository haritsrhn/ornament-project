import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  generateSessionToken,
  hashSessionToken,
  isRememberMeSession,
  isWellFormedSessionToken,
  REMEMBER_ME_TTL,
  SESSION_TOKEN_BYTES,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL,
  sessionTokenHashEquals,
  sessionTtl,
} from '../../src/modules/auth/session.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('token sesi', () => {
  test('32 byte acak dikodekan base64url (43 karakter, tanpa padding)', () => {
    const token = generateSessionToken();
    expect(SESSION_TOKEN_BYTES).toBe(32);
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  test('tidak pernah berulang di 1000 pembuatan', () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateSessionToken));
    expect(tokens.size).toBe(1000);
  });

  test('hash yang disimpan adalah SHA-256 heksadesimal dari token', () => {
    const token = generateSessionToken();
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(hashSessionToken(token)).toBe(expected);
    expect(hashSessionToken(token)).toHaveLength(64);
    // Hash tidak boleh memuat token mentah — itulah gunanya menyimpan hash.
    expect(hashSessionToken(token)).not.toContain(token);
  });

  test('bentuk token divalidasi sebelum menyentuh database', () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
    expect(isWellFormedSessionToken('')).toBe(false);
    expect(isWellFormedSessionToken('terlalu-pendek')).toBe(false);
    expect(isWellFormedSessionToken('a'.repeat(44))).toBe(false);
    // `+` dan `/` adalah base64 klasik, bukan base64url.
    expect(isWellFormedSessionToken(`${'a'.repeat(42)}+`)).toBe(false);
  });

  test('perbandingan hash waktu konstan tetap benar secara fungsional', () => {
    const hash = hashSessionToken(generateSessionToken());
    expect(sessionTokenHashEquals(hash, hash)).toBe(true);
    expect(sessionTokenHashEquals(hash, hashSessionToken(generateSessionToken()))).toBe(false);
    expect(sessionTokenHashEquals(hash, hash.slice(0, 63))).toBe(false);
  });
});

describe('masa berlaku sesi (kontrak §2.1)', () => {
  test('12 jam default, 30 hari bila "Ingat saya"', () => {
    expect(sessionTtl(false)).toBe(SESSION_TTL);
    expect(sessionTtl(true)).toBe(REMEMBER_ME_TTL);
    expect(SESSION_TTL.idleMs).toBe(12 * HOUR_MS);
    expect(REMEMBER_ME_TTL.idleMs).toBe(30 * DAY_MS);
  });

  test('batas mutlak selalu lebih jauh dari jendela idle', () => {
    expect(SESSION_TTL.absoluteMs).toBeGreaterThan(SESSION_TTL.idleMs);
    expect(REMEMBER_ME_TTL.absoluteMs).toBeGreaterThan(REMEMBER_ME_TTL.idleMs);
  });

  test('sliding refresh dibatasi satu kali per menit', () => {
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(60_000);
  });

  test('"Ingat saya" dibaca kembali dari rentang mutlak sesi', () => {
    const createdAt = new Date('2026-09-18T00:00:00.000Z');
    const span = (ms: number) => ({ createdAt, absoluteExpiresAt: new Date(+createdAt + ms) });

    expect(isRememberMeSession(span(SESSION_TTL.absoluteMs))).toBe(false);
    expect(isRememberMeSession(span(REMEMBER_ME_TTL.absoluteMs))).toBe(true);
    // Jitter beberapa detik saat login tidak mengubah kesimpulan.
    expect(isRememberMeSession(span(SESSION_TTL.absoluteMs + 5000))).toBe(false);
    expect(isRememberMeSession(span(REMEMBER_ME_TTL.absoluteMs - 5000))).toBe(true);
  });
});
