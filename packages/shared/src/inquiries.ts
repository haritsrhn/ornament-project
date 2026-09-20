import { z } from 'zod';

import { honeypotSchema, moneyInputSchema } from './common.js';
import { dataEnvelope } from './envelope.js';

/**
 * Kontrak inquiry publik — kontrak API §5.4
 * (`POST /v1/public/inquiry-uploads`, `POST /v1/public/inquiries`).
 *
 * **Privasi (kontrak §4, model §3.7):** seluruh isi `Inquiry` 🔒. Tidak ada
 * endpoint baca publik dan respons submit hanya `{ reference }` — karena itu
 * berkas ini tidak punya DTO keluaran selain itu.
 *
 * Nilai turunan (`number`, `reference`, `subject`, `categoryLabel`,
 * `materialLabel`, `targetShipDate`, `status`, `ipHash`, `userAgent`) diisi
 * server dan **tidak** ada di skema input: `strictObject` menolaknya sebagai
 * `unrecognized_keys` (kontrak §1.3).
 */

// ── Nomor referensi (model §6.5) ─────────────────────────────────────────────

export const INQUIRY_REFERENCE_PREFIX = 'INQ-';
/** `INQ-0001`; setelah 9999 panjangnya bertambah tanpa dipotong (§6.5). */
export const INQUIRY_REFERENCE_DIGITS = 4;

export function formatInquiryReference(number: number): string {
  return `${INQUIRY_REFERENCE_PREFIX}${String(number).padStart(INQUIRY_REFERENCE_DIGITS, '0')}`;
}

// ── Subjek turunan (model §6.5) ──────────────────────────────────────────────

/** Dipakai saat kategori dan material sama-sama kosong (§6.5). */
export const INQUIRY_SUBJECT_FALLBACK = 'Permintaan produk';

/**
 * `subject` dihasilkan saat submit dan tidak bisa diedit (§6.5):
 * keduanya terisi → `"<kategori> <material> — <n> pcs"`; selain itu
 * `"<material ?? kategori ?? 'Permintaan produk'> — <n> pcs"`.
 */
export function buildInquirySubject(input: {
  categoryLabel: string | null;
  materialLabel: string | null;
  volumeQuantity: number;
}): string {
  const { categoryLabel, materialLabel } = input;
  const head =
    categoryLabel !== null && materialLabel !== null
      ? `${categoryLabel} ${materialLabel}`
      : (materialLabel ?? categoryLabel ?? INQUIRY_SUBJECT_FALLBACK);
  return `${head} — ${String(input.volumeQuantity)} pcs`;
}

// ── Target kirim: teks bebas → tanggal (Q10, model §6.5) ─────────────────────

/**
 * Nama bulan yang dikenali. Kontrak menyebut "Nov 2026"/"November 2026";
 * karena `SiteSetting.siteLanguage` bisa `ID`, nama bulan Indonesia ikut
 * dikenali agar "Nov 2026" dan "November 2026" tidak berperilaku beda dari
 * "Nopember"/"Agustus" yang ditulis pengunjung Indonesia.
 */
const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  pebruari: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  agu: 8,
  ags: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  nopember: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};

/** `YYYY-MM-DD` dari komponen UTC, tanpa melewati `Date` (tanpa zona waktu). */
function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Tanggal kalender yang benar-benar ada (menolak `2026-02-31`). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Menurunkan `targetShipDate` dari `targetShipText` (model §6.5, Q10), memakai
 * **awal periode**:
 *
 * | Teks | Hasil |
 * | --- | --- |
 * | `2026-11-17` | `2026-11-17` |
 * | `2026-11`, `Nov 2026`, `November 2026` | `2026-11-01` |
 * | `Q3 2026` | `2026-07-01` |
 * | `ASAP`, `Flexible`, `Early next month` | `null` |
 *
 * Murni (tanpa `Date.now()`, tanpa zona waktu) supaya hasilnya sama di server,
 * di form, dan di tes. Mengembalikan string `YYYY-MM-DD` (kontrak §1.3).
 */
export function parseTargetShipDate(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const value = text.trim();
  if (value === '') return null;

  const full = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (full) {
    const [year, month, day] = [Number(full[1]), Number(full[2]), Number(full[3])];
    return isRealDate(year, month, day) ? isoDate(year, month, day) : null;
  }

  const yearMonth = /^(\d{4})[-/](\d{1,2})$/.exec(value);
  if (yearMonth) {
    const [year, month] = [Number(yearMonth[1]), Number(yearMonth[2])];
    return month >= 1 && month <= 12 ? isoDate(year, month, 1) : null;
  }

  // "Q3 2026" dan "2026 Q3" → tanggal 1 kuartal itu.
  const quarter = /^q([1-4])[\s-]*(\d{4})$/i.exec(value) ?? /^(\d{4})[\s-]*q([1-4])$/i.exec(value);
  if (quarter) {
    const [a, b] = [quarter[1] ?? '', quarter[2] ?? ''];
    const [q, year] = a.length === 4 ? [Number(b), Number(a)] : [Number(a), Number(b)];
    return isoDate(year, (q - 1) * 3 + 1, 1);
  }

  // "Nov 2026", "November 2026", "2026 November" → tanggal 1 bulan itu.
  const named =
    /^([A-Za-z]{3,12})\.?[\s,-]+(\d{4})$/.exec(value) ??
    /^(\d{4})[\s,-]+([A-Za-z]{3,12})\.?$/.exec(value);
  if (named) {
    const [a, b] = [named[1] ?? '', named[2] ?? ''];
    const [name, year] = /^\d{4}$/.test(a) ? [b, Number(a)] : [a, Number(b)];
    const month = MONTH_NAMES[name.toLowerCase()];
    if (month !== undefined) return isoDate(year, month, 1);
  }

  // Teks relatif/tidak jelas ("ASAP", "Flexible", "Early next month") → null.
  return null;
}

// ── Lampiran (A5, kontrak §5.4) ──────────────────────────────────────────────

/** Maks 3 berkas per inquiry (A5). */
export const INQUIRY_ATTACHMENTS_MAX = 3;
/** 10 MB per berkas (A5). */
export const INQUIRY_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const INQUIRY_UPLOAD_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const inquiryUploadMimeTypeSchema = z.enum(INQUIRY_UPLOAD_MIME_TYPES);
export type InquiryUploadMimeType = z.infer<typeof inquiryUploadMimeTypeSchema>;

/**
 * Body `POST /v1/public/inquiry-uploads`.
 *
 * MIME dan ukuran divalidasi di sini **dan** dipetakan server ke kode kontrak
 * yang lebih spesifik daripada `VALIDATION_FAILED` (§5.4:
 * `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`), jadi skema ini
 * sengaja menerima `mimeType: string` dan `sizeBytes: int` apa adanya.
 */
export const publicInquiryUploadInputSchema = z.strictObject({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.int().positive(),
});
export type PublicInquiryUploadInput = z.infer<typeof publicInquiryUploadInputSchema>;

export const publicInquiryUploadSchema = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.object({ 'Content-Type': z.string(), 'Content-Length': z.string() }),
  expiresAt: z.iso.datetime(),
});
export type PublicInquiryUpload = z.infer<typeof publicInquiryUploadSchema>;

export const publicInquiryUploadResponseSchema = dataEnvelope(publicInquiryUploadSchema);

// ── Submit inquiry (kontrak §5.4) ────────────────────────────────────────────

/**
 * `PublicInquiryInput` kontrak §5.4. Wajib minimal `name`, `email`, dan
 * `volumeQuantity` (model §6.5).
 *
 * `strictObject`: field turunan read-only (kontrak §1.3) dan field yang tidak
 * dikenal ditolak `400 VALIDATION_FAILED` dengan `code: "unrecognized_keys"`.
 */
export const publicInquiryInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(120),
  company: z.string().trim().max(120).nullish(),
  email: z.email('Email tidak valid.').max(255),
  country: z.string().trim().max(80).nullish(),
  /** `null` = "Belum menentukan"; uuid tak dikenal → `400` (`details.code: "not_found"`). */
  categoryId: z.uuid().nullish(),
  /** `null` = "Terbuka untuk saran". */
  materialId: z.uuid().nullish(),
  volumeQuantity: z
    .int('Volume harus bilangan bulat.')
    .min(1, 'Volume minimal 1 pcs.')
    .max(1_000_000, 'Volume maksimal 1.000.000 pcs.'),
  /** Teks bebas (Q10); server menurunkan `targetShipDate` bila terbaca. */
  targetShipText: z.string().trim().max(80).nullish(),
  destinationPort: z.string().trim().max(80).nullish(),
  budgetPerUnitUsd: moneyInputSchema.nullish(),
  message: z.string().trim().max(5000).nullish(),
  attachmentUploadIds: z
    .array(z.string().min(1).max(200))
    .max(INQUIRY_ATTACHMENTS_MAX, `Maksimal ${String(INQUIRY_ATTACHMENTS_MAX)} lampiran.`)
    .refine((ids) => new Set(ids).size === ids.length, 'Lampiran tidak boleh duplikat.')
    .optional(),
  website: honeypotSchema,
});
export type PublicInquiryInput = z.infer<typeof publicInquiryInputSchema>;

/** Respons submit: **hanya** `reference` (kontrak §4 baris Inquiry). */
export const publicInquirySubmitSchema = z.object({ reference: z.string() });
export type PublicInquirySubmit = z.infer<typeof publicInquirySubmitSchema>;

export const publicInquirySubmitResponseSchema = dataEnvelope(publicInquirySubmitSchema);
