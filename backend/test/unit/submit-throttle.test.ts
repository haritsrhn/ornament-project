import { describe, expect, test } from 'vitest';

import { isAppError } from '../../src/lib/errors.js';
import {
  createPublicSubmitThrottles,
  enforceSubmitThrottles,
  SUBMIT_LIMITS,
} from '../../src/modules/public/submit-throttle.js';

/**
 * Batas submit publik per `ipHash` (kontrak §2.3). Yang diuji di sini adalah
 * perilaku **dua jendela sekaligus**, yang tidak bisa dinyatakan lewat
 * `@fastify/rate-limit` dan karena itu mudah salah bila ditulis ulang.
 */

function expectRateLimited(run: () => void): number {
  try {
    run();
  } catch (error) {
    if (!isAppError(error)) throw error;
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    return (error.details as { retryAfterSeconds: number }).retryAfterSeconds;
  }
  throw new Error('Seharusnya RATE_LIMITED.');
}

describe('SUBMIT_LIMITS', () => {
  test('sesuai kontrak §2.3', () => {
    expect(SUBMIT_LIMITS.inquiryBurst).toEqual({ limit: 5, windowMs: 60 * 60 * 1000 });
    expect(SUBMIT_LIMITS.inquiryDaily).toEqual({ limit: 20, windowMs: 24 * 60 * 60 * 1000 });
    expect(SUBMIT_LIMITS.uploadBurst).toEqual({ limit: 15, windowMs: 60 * 60 * 1000 });
    expect(SUBMIT_LIMITS.commentBurst).toEqual({ limit: 5, windowMs: 10 * 60 * 1000 });
    expect(SUBMIT_LIMITS.commentDaily).toEqual({ limit: 30, windowMs: 24 * 60 * 60 * 1000 });
  });
});

describe('enforceSubmitThrottles', () => {
  test('mengizinkan tepat `limit` percobaan lalu menolak', () => {
    const throttles = createPublicSubmitThrottles({ inquiryBurst: { limit: 3, windowMs: 60_000 } });
    const windows = [throttles.inquiryBurst];

    for (let i = 0; i < 3; i += 1) enforceSubmitThrottles(windows, 'hash-a');
    const retryAfter = expectRateLimited(() => {
      enforceSubmitThrottles(windows, 'hash-a');
    });
    expect(retryAfter).toBeGreaterThan(0);
  });

  test('kunci berbeda punya kuota sendiri', () => {
    const throttles = createPublicSubmitThrottles({ inquiryBurst: { limit: 1, windowMs: 60_000 } });
    enforceSubmitThrottles([throttles.inquiryBurst], 'hash-a');
    expect(() => {
      enforceSubmitThrottles([throttles.inquiryBurst], 'hash-b');
    }).not.toThrow();
  });

  test('jendela panjang tetap menahan setelah jendela pendek pulih', () => {
    const throttles = createPublicSubmitThrottles({
      inquiryBurst: { limit: 2, windowMs: 1_000 },
      inquiryDaily: { limit: 3, windowMs: 1_000_000 },
    });
    const windows = [throttles.inquiryBurst, throttles.inquiryDaily];
    const start = Date.now();

    enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    // Jendela pendek penuh.
    expectRateLimited(() => {
      enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    });

    // Jendela pendek pulih, kuota harian tinggal satu.
    const later = new Date(start + 2_000);
    enforceSubmitThrottles(windows, 'hash-a', later);
    expectRateLimited(() => {
      enforceSubmitThrottles(windows, 'hash-a', later);
    });
  });

  test('request yang ditolak jendela pendek tidak menghabiskan kuota jendela panjang', () => {
    const throttles = createPublicSubmitThrottles({
      inquiryBurst: { limit: 1, windowMs: 1_000 },
      inquiryDaily: { limit: 5, windowMs: 1_000_000 },
    });
    const windows = [throttles.inquiryBurst, throttles.inquiryDaily];
    const start = Date.now();

    enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    for (let i = 0; i < 10; i += 1) {
      expectRateLimited(() => {
        enforceSubmitThrottles(windows, 'hash-a', new Date(start));
      });
    }
    // Hanya 1 percobaan yang tercatat di jendela harian, jadi 4 sisa kuota.
    expect(throttles.inquiryDaily.retryAfterSeconds('hash-a', start)).toBe(0);
    for (let i = 0; i < 4; i += 1) {
      enforceSubmitThrottles([throttles.inquiryDaily], 'hash-a', new Date(start));
    }
    expectRateLimited(() => {
      enforceSubmitThrottles([throttles.inquiryDaily], 'hash-a', new Date(start));
    });
  });

  test('Retry-After memakai sisa terlama dari semua jendela', () => {
    const throttles = createPublicSubmitThrottles({
      inquiryBurst: { limit: 1, windowMs: 2_000 },
      inquiryDaily: { limit: 1, windowMs: 100_000 },
    });
    const windows = [throttles.inquiryBurst, throttles.inquiryDaily];
    const start = Date.now();

    enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    const retryAfter = expectRateLimited(() => {
      enforceSubmitThrottles(windows, 'hash-a', new Date(start));
    });
    expect(retryAfter).toBe(100);
  });
});
