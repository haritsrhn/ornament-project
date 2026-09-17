import { describe, expect, test } from 'vitest';

import { ERROR_CODES, errorCodeSchema, errorEnvelopeSchema } from '../src/index.js';

describe('errorCodeSchema', () => {
  test('katalog unik dan berbentuk UPPER_SNAKE', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z]+(?:_[A-Z]+)*$/);
  });

  test('menolak kode di luar katalog', () => {
    expect(errorCodeSchema.safeParse('NOT_FOUND').success).toBe(true);
    expect(errorCodeSchema.safeParse('TEAPOT').success).toBe(false);
  });
});

describe('errorEnvelopeSchema', () => {
  test('menerima contoh kontrak §1.5', () => {
    const body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Beberapa field tidak valid.',
        details: [{ path: 'materials[0].materialId', code: 'invalid_format', message: 'x' }],
        requestId: '01J8Y9K7Q2N5',
      },
    };
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  test('details opsional; requestId wajib', () => {
    const error = { code: 'NOT_FOUND', message: 'Tidak ada.', requestId: 'r1' };
    expect(errorEnvelopeSchema.safeParse({ error }).success).toBe(true);
    const withoutId = { code: error.code, message: error.message };
    expect(errorEnvelopeSchema.safeParse({ error: withoutId }).success).toBe(false);
  });
});
