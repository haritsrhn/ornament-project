/**
 * Konkurensi optimistis berbasis `expectedUpdatedAt` (kontrak §1.9).
 *
 * `Article`, `Artisan`, `Page`, `SiteSetting`, dan nav tidak menyimpan nomor
 * revisi seperti `Product`, jadi penanda "versi yang saya lihat" adalah
 * `updatedAt`. Perbandingannya dilakukan pada **milidetik**, bukan string:
 * `updatedAt` di Postgres `timestamptz` punya presisi mikrodetik, sedangkan
 * kontrak §1.3 mengirimkannya sebagai ISO 8601 bermilidetik. Membandingkan
 * string mentah akan membuat setiap simpan gagal dengan `409` palsu pada baris
 * yang mikrodetiknya bukan kelipatan 1000.
 */

import { AppError } from './errors.js';

export interface EditConflictSubject {
  updatedAt: Date;
  updatedBy?: { id: string; name: string } | null;
}

export const editConflict = (current: EditConflictSubject, message: string): AppError =>
  new AppError('EDIT_CONFLICT', message, {
    details: {
      updatedAt: current.updatedAt.toISOString(),
      updatedBy: current.updatedBy ?? null,
    },
  });

/**
 * Melempar `409 EDIT_CONFLICT` bila baris sudah berubah sejak klien memuatnya.
 * `expected` sudah lolos `z.iso.datetime()`, jadi ia selalu bisa diurai.
 */
export function assertUpdatedAtMatches(
  current: EditConflictSubject,
  expected: string,
  message: string,
): void {
  const expectedMs = new Date(expected).getTime();
  if (Math.trunc(current.updatedAt.getTime()) !== expectedMs) {
    throw editConflict(current, message);
  }
}
