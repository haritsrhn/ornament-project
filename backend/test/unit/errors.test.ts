import { describe, expect, test } from 'vitest';

import {
  AppError,
  ERROR_STATUS,
  badRequest,
  businessRuleViolation,
  conflict,
  forbidden,
  isAppError,
  notFound,
  rateLimited,
  serviceUnavailable,
  unauthenticated,
  validationFailed,
} from '../../src/lib/errors.js';

describe('AppError', () => {
  test('status default diambil dari katalog kode', () => {
    const error = new AppError('INVALID_STATE', 'Status tidak valid.', {
      details: { current: 'draft' },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({ current: 'draft' });
    expect(error.headers).toBeUndefined();
    expect(error.isServerError).toBe(false);
  });

  test('statusCode eksplisit dan cause dipertahankan', () => {
    const cause = new Error('akar');
    const error = new AppError('UPSTREAM_FAILED', 'Gagal.', { statusCode: 504, cause });
    expect(error.statusCode).toBe(504);
    expect(error.cause).toBe(cause);
    expect(error.isServerError).toBe(true);
  });

  test('tanpa cause, properti cause tidak ada', () => {
    expect('cause' in new AppError('CONFLICT', 'x')).toBe(false);
  });

  test('isAppError hanya benar untuk AppError', () => {
    expect(isAppError(notFound())).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError({ code: 'NOT_FOUND', statusCode: 404 })).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  test('setiap kode katalog berstatus 4xx/5xx', () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});

describe('helper error', () => {
  test.each([
    ['BAD_REQUEST', 400, badRequest()],
    ['VALIDATION_FAILED', 400, validationFailed([])],
    ['UNAUTHENTICATED', 401, unauthenticated()],
    ['FORBIDDEN', 403, forbidden()],
    ['NOT_FOUND', 404, notFound()],
    ['CONFLICT', 409, conflict(['slug'])],
    ['BUSINESS_RULE_VIOLATION', 422, businessRuleViolation('rule', 'Pesan.')],
    ['RATE_LIMITED', 429, rateLimited(30)],
    ['SERVICE_UNAVAILABLE', 503, serviceUnavailable()],
  ] as const)('%s → %i', (code, status, error) => {
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(status);
    expect(error.message).not.toBe('');
  });

  test('details sesuai kontrak', () => {
    const issue = { path: 'name', code: 'too_small', message: 'Terlalu pendek' };
    expect(validationFailed([issue]).details).toEqual([issue]);
    expect(conflict(['slug', 'name']).details).toEqual({ fields: ['slug', 'name'] });
    expect(businessRuleViolation('min_photos', 'Minimal 1 foto.').details).toEqual({
      rule: 'min_photos',
    });
    expect(badRequest('Salah.', { a: 1 })).toMatchObject({ message: 'Salah.', details: { a: 1 } });
  });

  test('rateLimited menambah header Retry-After', () => {
    const error = rateLimited(42);
    expect(error.details).toEqual({ retryAfterSeconds: 42 });
    expect(error.headers).toEqual({ 'retry-after': '42' });
  });

  test('serviceUnavailable menyimpan cause', () => {
    const cause = new Error('db mati');
    expect(serviceUnavailable('DB mati.', cause).cause).toBe(cause);
  });
});
