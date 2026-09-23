import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, test, vi } from 'vitest';

import { AppError } from '../../src/lib/errors.js';
import { collectBulkResult } from '../../src/modules/admin/bulk.js';

/**
 * Aksi massal selalu `200` dengan sukses parsial (kontrak §5). Yang dijaga di
 * sini adalah batas itu: satu item yang meledak tidak boleh menjatuhkan 99
 * item lainnya, termasuk ketika error-nya bukan `AppError` — misalnya `P2025`
 * dari Prisma saat baris terhapus di antara pemeriksaan dan transaksi.
 */

const ID = (n: number): string => `0000000${String(n)}-0000-4000-8000-000000000000`;

function fakeLog() {
  return { error: vi.fn() } as unknown as FastifyBaseLogger & { error: ReturnType<typeof vi.fn> };
}

describe('collectBulkResult', () => {
  test('mengumpulkan id yang berhasil, berurutan sesuai input', async () => {
    const ids = [ID(1), ID(2), ID(3)];
    const seen: string[] = [];

    const result = await collectBulkResult(ids, fakeLog(), (id) => {
      seen.push(id);
      return Promise.resolve();
    });

    expect(seen).toEqual(ids);
    expect(result).toEqual({ succeeded: ids, failed: [] });
  });

  test('AppError menjadi satu baris `failed` dengan kode aslinya', async () => {
    const result = await collectBulkResult([ID(1), ID(2)], fakeLog(), (id) => {
      if (id === ID(1)) throw new AppError('FORBIDDEN', 'Bukan milik Anda.');
      return Promise.resolve();
    });

    expect(result.succeeded).toEqual([ID(2)]);
    expect(result.failed).toEqual([{ id: ID(1), code: 'FORBIDDEN', message: 'Bukan milik Anda.' }]);
  });

  test('error non-AppError tidak membatalkan batch, dan pesannya tidak bocor', async () => {
    const log = fakeLog();
    const prismaError = Object.assign(new Error('Record to update not found'), { code: 'P2025' });

    const result = await collectBulkResult([ID(1), ID(2), ID(3)], log, (id) => {
      if (id === ID(2)) throw prismaError;
      return Promise.resolve();
    });

    // Item sesudahnya tetap diproses: batch tidak berhenti di tengah.
    expect(result.succeeded).toEqual([ID(1), ID(3)]);
    expect(result.failed).toEqual([
      {
        id: ID(2),
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan tak terduga pada item ini.',
      },
    ]);
    // Detail Prisma hanya boleh ada di log, tidak di respons.
    expect(JSON.stringify(result)).not.toContain('P2025');
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  test('tanpa id: tidak memanggil apa pun dan mengembalikan hasil kosong', async () => {
    const runItem = vi.fn();
    const result = await collectBulkResult([], fakeLog(), runItem);

    expect(runItem).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: [], failed: [] });
  });
});
