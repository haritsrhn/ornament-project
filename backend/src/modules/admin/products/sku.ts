/**
 * Saran SKU (model domain §6.2, kontrak §5.6).
 *
 * Server **tidak pernah** mengisi `sku` diam-diam: endpoint ini hanya
 * mengusulkan nilai yang lalu ditaruh UI di field yang kosong, dan pengguna
 * bebas menggantinya (Q6). Karena itu `POST`, bukan `GET` — mengambil nomor
 * sequence mengubah state server meski tidak ada baris yang disimpan.
 */

import { SKU_SEQUENCE_PAD, SKU_SUGGESTION_PREFIX } from '@ornament/shared';

import type { PrismaClient } from '../../../generated/prisma/client.js';

/** Sequence global dari migrasi awal; nomornya tidak pernah dipakai ulang (§6.2). */
export const SKU_SEQUENCE_NAME = 'product_sku_seq';

/** Zona waktu default bila baris `SiteSetting` belum ada (model §3.8). */
export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

/**
 * `YYMM` pada zona `SiteSetting.timezone` (§6.2). Dipakai saat material primer
 * belum dipilih atau tidak punya `skuCode`.
 *
 * `Intl` dipakai alih-alih aritmetika offset supaya pergantian bulan mengikuti
 * zona waktu sungguhan, bukan UTC — sebuah saran yang dibuat 1 September pukul
 * 06.00 WIB tidak boleh berkode `08`.
 */
export function yearMonthCode(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '00';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  return `${year}${month}`;
}

export function formatSkuSuggestion(code: string, sequence: number): string {
  return `${SKU_SUGGESTION_PREFIX}-${code}-${String(sequence).padStart(SKU_SEQUENCE_PAD, '0')}`;
}

/**
 * Nomor berikutnya dari sequence Postgres. Sengaja **tidak** transaksional:
 * saran yang tidak jadi dipakai meninggalkan lubang nomor, dan itu memang yang
 * diinginkan — nomor tidak pernah dipakai dua kali, sehingga saran praktis
 * tidak pernah bentrok dengan SKU yang sudah tersimpan.
 */
export async function nextSkuSequence(prisma: PrismaClient): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ value: number }[]>(
    `SELECT nextval('${SKU_SEQUENCE_NAME}')::int AS value`,
  );
  /* c8 ignore next */
  if (row === undefined) throw new Error('Sequence saran SKU tidak mengembalikan nilai.');
  return row.value;
}

export interface SkuSuggestionInput {
  /** `Material.skuCode` material primer yang sedang dipilih, bila ada. */
  materialSkuCode: string | null;
  timezone: string;
  now?: Date;
}

export function buildSkuSuggestion(sequence: number, input: SkuSuggestionInput): string {
  const code =
    input.materialSkuCode === null || input.materialSkuCode === ''
      ? yearMonthCode(input.now ?? new Date(), input.timezone)
      : input.materialSkuCode;
  return formatSkuSuggestion(code, sequence);
}
