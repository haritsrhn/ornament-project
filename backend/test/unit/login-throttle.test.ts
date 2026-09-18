import { describe, expect, test } from 'vitest';

import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  LoginThrottle,
} from '../../src/modules/auth/login-throttle.js';

const EMAIL = 'rani@ornament.id';

describe('LoginThrottle (kontrak §2.3: 5 gagal / 15 menit)', () => {
  test('default sesuai kontrak', () => {
    const throttle = new LoginThrottle();
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(throttle.limit).toBe(5);
    expect(throttle.windowMs).toBe(15 * 60 * 1000);
  });

  test('empat kegagalan belum mengunci, kelima mengunci', () => {
    const throttle = new LoginThrottle();
    const t0 = 1_000_000;

    for (let i = 1; i < LOGIN_FAILURE_LIMIT; i += 1) {
      expect(throttle.recordFailure(EMAIL, t0 + i)).toBe(i);
      expect(throttle.isLocked(EMAIL, t0 + i)).toBe(false);
    }
    expect(throttle.recordFailure(EMAIL, t0 + LOGIN_FAILURE_LIMIT)).toBe(LOGIN_FAILURE_LIMIT);
    expect(throttle.isLocked(EMAIL, t0 + LOGIN_FAILURE_LIMIT)).toBe(true);
  });

  test('retryAfterSeconds menghitung sisa jendela dan tidak pernah 0 saat terkunci', () => {
    const throttle = new LoginThrottle();
    const t0 = 0;
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) throttle.recordFailure(EMAIL, t0);

    expect(throttle.retryAfterSeconds(EMAIL, t0)).toBe(900);
    expect(throttle.retryAfterSeconds(EMAIL, t0 + 60_000)).toBe(840);
    // Satu milidetik sebelum jendela berakhir: dibulatkan ke atas menjadi 1.
    expect(throttle.retryAfterSeconds(EMAIL, t0 + LOGIN_FAILURE_WINDOW_MS - 1)).toBe(1);
  });

  test('pulih sendiri setelah jendela lewat', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) throttle.recordFailure(EMAIL, 0);

    expect(throttle.isLocked(EMAIL, LOGIN_FAILURE_WINDOW_MS - 1)).toBe(true);
    expect(throttle.isLocked(EMAIL, LOGIN_FAILURE_WINDOW_MS)).toBe(false);
    // Entri kedaluwarsa dibuang, jadi hitungan mulai dari satu lagi.
    expect(throttle.recordFailure(EMAIL, LOGIN_FAILURE_WINDOW_MS)).toBe(1);
  });

  test('kegagalan di luar jendela membuka jendela baru, bukan menumpuk', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.recordFailure(EMAIL, 0);
    expect(throttle.recordFailure(EMAIL, LOGIN_FAILURE_WINDOW_MS + 1)).toBe(1);
    expect(throttle.isLocked(EMAIL, LOGIN_FAILURE_WINDOW_MS + 1)).toBe(false);
  });

  test('login sukses mereset hitungan', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < 4; i += 1) throttle.recordFailure(EMAIL, 0);
    throttle.reset(EMAIL);
    expect(throttle.recordFailure(EMAIL, 0)).toBe(1);
    expect(throttle.isLocked(EMAIL, 0)).toBe(false);
  });

  test('lockout per email, tidak menular ke email lain', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) throttle.recordFailure(EMAIL, 0);
    expect(throttle.isLocked(EMAIL, 0)).toBe(true);
    expect(throttle.isLocked('sekar@ornament.id', 0)).toBe(false);
  });

  test('jumlah entri dibatasi agar banjir email acak tidak memakan memori', () => {
    const throttle = new LoginThrottle({ maxEntries: 10 });
    for (let i = 0; i < 100; i += 1) throttle.recordFailure(`orang${String(i)}@ornament.id`, 0);
    expect(throttle.size).toBeLessThanOrEqual(10);
  });
});
