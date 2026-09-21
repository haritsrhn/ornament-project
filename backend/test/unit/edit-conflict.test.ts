import { describe, expect, test } from 'vitest';

import { assertUpdatedAtMatches, editConflict } from '../../src/lib/edit-conflict.js';
import { isAppError } from '../../src/lib/errors.js';

/**
 * `expectedUpdatedAt` (kontrak §1.9) untuk resource tanpa nomor revisi.
 *
 * Kasus yang paling mudah salah — dan paling mahal — adalah presisi:
 * `timestamptz` Postgres menyimpan mikrodetik, sedangkan kontrak §1.3
 * mengirimkan ISO bermilidetik. Bila perbandingannya dilakukan atas string
 * mentah, setiap penyimpanan pada baris yang mikrodetiknya bukan kelipatan
 * 1000 akan gagal dengan `409` palsu yang tidak akan pernah pulih.
 */

const UPDATED_BY = { id: '9b1e0b4e-0000-4000-8000-000000000000', name: 'Dimas' };

describe('assertUpdatedAtMatches', () => {
  test('lolos bila nilainya sama persis', () => {
    const updatedAt = new Date('2026-09-20T03:15:00.000Z');
    expect(() => {
      assertUpdatedAtMatches({ updatedAt }, updatedAt.toISOString(), 'pesan');
    }).not.toThrow();
  });

  test('melempar EDIT_CONFLICT dengan details kontrak bila baris sudah berubah', () => {
    const updatedAt = new Date('2026-09-20T03:16:00.000Z');
    try {
      assertUpdatedAtMatches(
        { updatedAt, updatedBy: UPDATED_BY },
        '2026-09-20T03:15:00.000Z',
        'Artikel sudah diubah orang lain.',
      );
      expect.unreachable('seharusnya melempar');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (!isAppError(error)) return;
      expect(error.code).toBe('EDIT_CONFLICT');
      expect(error.statusCode).toBe(409);
      expect(error.details).toEqual({
        updatedAt: '2026-09-20T03:16:00.000Z',
        updatedBy: UPDATED_BY,
      });
    }
  });

  test('updatedBy null bila barisnya tidak menyimpan penyunting terakhir', () => {
    const error = editConflict({ updatedAt: new Date(0) }, 'pesan');
    expect(error.details).toEqual({ updatedAt: '1970-01-01T00:00:00.000Z', updatedBy: null });
  });

  test('nilai yang bukan waktu tidak pernah dianggap cocok', () => {
    expect(() => {
      assertUpdatedAtMatches({ updatedAt: new Date('2026-09-20T03:15:00.000Z') }, '', 'pesan');
    }).toThrow();
  });
});
