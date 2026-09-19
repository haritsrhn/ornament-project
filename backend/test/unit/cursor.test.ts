import { describe, expect, test } from 'vitest';

import { canonicalFilter, decodeCursor, encodeCursor } from '../../src/lib/cursor.js';
import { isAppError } from '../../src/lib/errors.js';

/** Kursor keyset kontrak §1.6: opaque, mengikat filter & sort. */

const BINDING = { sort: '-publishedAt', filter: 'category=furniture' };
const POSITION = { value: '2026-08-21T02:00:00.000Z', id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' };

function expectInvalidCursor(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable('seharusnya melempar INVALID_CURSOR');
  } catch (error) {
    expect(isAppError(error) && error.code).toBe('INVALID_CURSOR');
  }
}

describe('kursor keyset', () => {
  test('encode lalu decode mengembalikan posisi yang sama', () => {
    const cursor = encodeCursor(BINDING, POSITION);
    expect(decodeCursor(cursor, BINDING)).toEqual(POSITION);
  });

  test('kursor aman dipakai di URL (base64url, tanpa padding)', () => {
    const cursor = encodeCursor(BINDING, POSITION);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  test('sort atau filter berbeda ditolak INVALID_CURSOR', () => {
    const cursor = encodeCursor(BINDING, POSITION);
    expectInvalidCursor(() => decodeCursor(cursor, { ...BINDING, sort: 'name' }));
    expectInvalidCursor(() => decodeCursor(cursor, { ...BINDING, filter: '' }));
  });

  test('kursor rusak, bukan JSON, atau isinya tidak lengkap ditolak', () => {
    for (const cursor of [
      'bukan-base64url!!',
      Buffer.from('bukan json', 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ s: '-publishedAt' }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ ...BINDING, v: 'x', i: 'bukan-uuid' }), 'utf8').toString(
        'base64url',
      ),
    ]) {
      expectInvalidCursor(() => decodeCursor(cursor, BINDING));
    }
  });
});

describe('canonicalFilter', () => {
  test('urutan penulisan filter tidak mengubah sidik jarinya', () => {
    expect(canonicalFilter({ material: 'a,b', category: 'furniture' })).toBe(
      canonicalFilter({ category: 'furniture', material: 'a,b' }),
    );
  });

  test('filter kosong dan tidak diisi diperlakukan sama', () => {
    expect(canonicalFilter({ category: undefined, tag: '' })).toBe('');
    expect(canonicalFilter({ category: 'x', tag: '' })).toBe('category=x');
  });
});
