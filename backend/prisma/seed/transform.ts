/**
 * Pengubah teks mockup → nilai bertipe untuk model Prisma (T2.4).
 *
 * Mockup menyimpan hampir semuanya sebagai teks siap tampil ("50 pcs",
 * "mitra sejak 2018", "3 jam lalu", "26 Agu 2026"). Fungsi di sini yang
 * memecahnya menjadi kolom, sesuai tabel pemetaan di `docs/domain-model.md` §7.
 *
 * ── Waktu ────────────────────────────────────────────────────────────────────
 * Ada dua bentuk waktu di mockup, dan keduanya digeser ke waktu seed supaya
 * database hasil seed selalu terasa "baru":
 *
 * - **Relatif** ("18 mnt", "3 jam lalu", "Kemarin", "2 hari", "Baru saja") →
 *   `now - offset`.
 * - **Absolut** ("26 Agu 2026", "23 Agu 2026") → digeser dengan selisih yang
 *   sama terhadap `MOCKUP_REFERENCE`, yaitu "sekarang"-nya mockup. Nilai itu
 *   (24 Agu 2026, 00:00 WIB) dipilih karena konsisten dengan seluruh mockup:
 *   halaman terbaru diperbarui 23 Agu, artikel berstatus `Scheduled`
 *   dijadwalkan 26 Agu (masih di depan), dan artikel `Published` terakhir
 *   14 Agu (sudah lewat). Dengan pergeseran ini artikel terjadwal tetap
 *   terjadwal (`publishAt` di masa depan) berapa pun kapan seed dijalankan.
 *
 * Tanggal absolut yang berupa **periode target kirim** inquiry ("Nov 2026",
 * "Mar 2027") sengaja TIDAK digeser: presisinya bulan dan §6.5 meminta awal
 * periode, jadi nilainya dipakai apa adanya.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "Sekarang"-nya data mockup; lihat catatan di atas. */
export const MOCKUP_REFERENCE = new Date('2026-08-24T00:00:00+07:00');

/** Jam tampil default untuk tanggal mockup tanpa jam: 09:00 WIB. */
const DISPLAY_HOUR_UTC = 2;

const MONTHS_ID: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  mei: 4,
  jun: 5,
  jul: 6,
  agu: 7,
  sep: 8,
  okt: 9,
  nov: 10,
  des: 11,
};

function monthIndex(text: string): number {
  const key = text.slice(0, 3).toLowerCase();
  const index = MONTHS_ID[key];
  if (index === undefined) throw new Error(`Bulan tidak dikenal: "${text}"`);
  return index;
}

/** "26 Agu 2026" → Date (09:00 WIB pada tanggal itu), belum digeser. */
export function parseMockupDate(text: string): Date {
  const match = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text.trim());
  if (!match) throw new Error(`Tanggal mockup tidak dikenal: "${text}"`);
  const [, day, month, year] = match;
  return new Date(
    Date.UTC(Number(year), monthIndex(month ?? ''), Number(day), DISPLAY_HOUR_UTC, 0, 0),
  );
}

/** "26 Agu 2026" → tanggal yang sama relatif terhadap waktu seed. */
export function shiftMockupDate(text: string, now: Date): Date {
  return new Date(now.getTime() + (parseMockupDate(text).getTime() - MOCKUP_REFERENCE.getTime()));
}

/** "3 jam lalu" / "18 mnt" / "Kemarin" / "Baru saja" → Date sebelum `now`. */
export function parseRelativeWhen(text: string, now: Date): Date {
  const value = text.trim().toLowerCase();
  if (value === 'baru saja') return now;
  if (value === 'kemarin') return new Date(now.getTime() - DAY_MS);

  const match = /^(\d+)\s*(mnt|menit|jam|hari)\b/.exec(value);
  if (!match) throw new Error(`Waktu relatif tidak dikenal: "${text}"`);
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 'mnt' || unit === 'menit' ? 60_000 : unit === 'jam' ? HOUR_MS : DAY_MS;
  return new Date(now.getTime() - amount * factor);
}

/** "Nov 2026" → 1 Nov 2026 (awal periode, §6.5). Tidak digeser. */
export function parseTargetShipDate(text: string): Date | null {
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(text.trim());
  if (!match) return null;
  try {
    return new Date(Date.UTC(Number(match[2]), monthIndex(match[1] ?? ''), 1));
  } catch {
    return null;
  }
}

/** "50 pcs" → { quantity: 50, unit: "pcs" }. */
export function parseQuantityWithUnit(text: string): { quantity: number; unit: string } {
  const match = /^([\d.]+)\s+(\S+)$/.exec(text.trim());
  if (!match) throw new Error(`Jumlah + satuan tidak dikenal: "${text}"`);
  return { quantity: parseIndonesianInt(match[1] ?? ''), unit: match[2] ?? 'pcs' };
}

/** "1.200" → 1200 (titik = pemisah ribuan di mockup). */
export function parseIndonesianInt(text: string): number {
  const value = Number(text.replace(/\./g, ''));
  if (!Number.isInteger(value)) throw new Error(`Bukan bilangan bulat: "${text}"`);
  return value;
}

/**
 * Teks stok → jumlah unit. "84 unit siap kirim" → 84, "12 set tersisa" → 12.
 * Teks tanpa angka di depan ("Lead time 45 hari", "Menunggu foto produk") →
 * null: produk itu tidak punya stok tercatat (§6.3 A11).
 */
export function parseStockQuantity(text: string): number | null {
  const match = /^(\d+)\b/.exec(text.trim());
  return match ? Number(match[1]) : null;
}

/** "Lead time 45 hari" / "30 hari" → 45 / 30. */
export function parseLeadTimeDays(text: string): number | null {
  const match = /(\d+)\s*hari/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** "mitra sejak 2018" → 2018. */
export function parseSinceYear(text: string): number | null {
  const match = /(\d{4})/.exec(text);
  return match ? Number(match[1]) : null;
}

/** "Bangunjiwo, Bantul" → { village, regency }. */
export function parsePlace(text: string): { village: string; regency: string } {
  const [village, regency] = text.split(',').map((part) => part.trim());
  if (village === undefined || regency === undefined) {
    throw new Error(`Lokasi tidak dikenal: "${text}"`);
  }
  return { village, regency };
}

/** "45 × 45 × 38 cm" → { lengthCm, widthCm, heightCm }. */
export function parseDimensions(
  text: string,
): { lengthCm: number; widthCm: number; heightCm: number } | null {
  const match = /^([\d.]+)\s*×\s*([\d.]+)\s*×\s*([\d.]+)\s*cm$/.exec(text.trim());
  if (!match) return null;
  return {
    lengthCm: Number(match[1]),
    widthCm: Number(match[2]),
    heightCm: Number(match[3]),
  };
}

/** "USD 42.00 / pcs" → 42. */
export function parseUsdPrice(text: string): number | null {
  const match = /USD\s*([\d.]+)/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Slug sesuai §6.1: huruf kecil, non-alfanumerik → "-", maks 80 karakter. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Jumlah kata untuk `Article.wordCount` (diturunkan saat simpan). */
export function countWords(paragraphs: string[]): number {
  return paragraphs.reduce(
    (total, paragraph) => total + paragraph.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** Blok `ArticleBlock` (domain model §3.6) dari paragraf mockup. */
export function paragraphsToArticleBlocks(
  slug: string,
  paragraphs: string[],
): { id: string; type: 'paragraph'; text: { text: string }[] }[] {
  return paragraphs.map((paragraph, index) => ({
    id: `${slug}-p${String(index + 1)}`,
    type: 'paragraph',
    text: [{ text: paragraph }],
  }));
}

/**
 * `stockStatus` turunan (§6.3 Q13) — aturan yang sama dengan yang nanti dipakai
 * modul produk: override → jumlah null → di bawah/sama dengan ambang → sisanya.
 */
export function computeStockStatus(input: {
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  globalLowStockThreshold: number;
  override?: 'IN_STOCK' | 'LOW_STOCK' | 'MADE_TO_ORDER' | null;
}): 'IN_STOCK' | 'LOW_STOCK' | 'MADE_TO_ORDER' {
  if (input.override != null) return input.override;
  if (input.stockQuantity === null) return 'MADE_TO_ORDER';
  const threshold = input.lowStockThreshold ?? input.globalLowStockThreshold;
  return input.stockQuantity <= threshold ? 'LOW_STOCK' : 'IN_STOCK';
}
