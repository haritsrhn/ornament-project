/**
 * Pengumpul hasil aksi massal (kontrak §5: sukses parsial, selalu `200`) —
 * dipakai bersama oleh modul produk dan artikel.
 *
 * Alasan berkas ini ada: sebuah error yang bukan `AppError` **tidak boleh**
 * membatalkan seluruh batch. Contoh nyatanya adalah purge yang berjalan
 * bersamaan di antara pemeriksaan kepemilikan dan transaksi service, yang
 * memunculkan `P2025` dari Prisma; dulu error itu lolos dari loop dan mengubah
 * `200` sukses parsial menjadi `500` untuk seratus id sekaligus, termasuk yang
 * sudah terlanjur ditulis.
 *
 * Kegagalan tak terduga dicatat sebagai `INTERNAL_ERROR` dengan pesan generik:
 * detail Prisma (nama tabel, kolom, nilai) tidak boleh bocor ke klien, jadi
 * error aslinya masuk ke log, bukan ke respons.
 */

import type { FastifyBaseLogger } from 'fastify';

import type { BulkResult } from '@ornament/shared';

import { isAppError } from '../../lib/errors.js';

/**
 * Menjalankan `runItem` untuk setiap id secara berurutan, bukan `Promise.all`:
 * aksi massal menulis ke tabel yang sama dan urutan hasil harus bisa diprediksi.
 */
export async function collectBulkResult(
  ids: string[],
  log: FastifyBaseLogger,
  runItem: (id: string) => Promise<void>,
): Promise<BulkResult> {
  const result: BulkResult = { succeeded: [], failed: [] };

  for (const id of ids) {
    try {
      await runItem(id);
      result.succeeded.push(id);
    } catch (error) {
      if (isAppError(error)) {
        result.failed.push({ id, code: error.code, message: error.message });
        continue;
      }
      log.error({ err: error, id }, 'item aksi massal gagal di luar dugaan');
      result.failed.push({
        id,
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan tak terduga pada item ini.',
      });
    }
  }

  return result;
}
