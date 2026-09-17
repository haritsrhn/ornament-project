import { z } from 'zod';

/**
 * Katalog kode error stabil — persis kontrak API §1.10, urut sesuai tabel.
 * Klien bercabang berdasarkan `code`, bukan `message`. Status HTTP per kode
 * adalah urusan backend (`ERROR_STATUS` di `backend/src/lib/errors.ts`).
 *
 * Menambah kode = perubahan kontrak: koordinasikan lewat paket ini (§1.1).
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'INVALID_CURSOR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVALID_INTERNAL_KEY',
  'FORBIDDEN',
  'FORBIDDEN_FIELD',
  'ORIGIN_NOT_ALLOWED',
  'NOT_FOUND',
  'CONFLICT',
  'EDIT_CONFLICT',
  'INVALID_STATE',
  'IN_USE',
  'IDEMPOTENCY_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PUBLISH_REQUIREMENTS_NOT_MET',
  'BUSINESS_RULE_VIOLATION',
  'UPLOAD_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'UPSTREAM_FAILED',
  'SERVICE_UNAVAILABLE',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Satu entri `details[]` untuk `VALIDATION_FAILED` (kontrak §1.5). */
export const validationDetailSchema = z.object({
  /** Notasi titik/indeks, mis. `materials[0].materialId`. */
  path: z.string(),
  /** Kode issue Zod (`too_small`, `invalid_type`, `unrecognized_keys`, …) atau kode kustom. */
  code: z.string(),
  message: z.string(),
});
export type ValidationDetail = z.infer<typeof validationDetailSchema>;

/**
 * Isi `error` pada envelope error (kontrak §1.5). `details` opsional dan
 * bentuknya bergantung pada `code` (validasi: `ValidationDetail[]`; error
 * domain: objek per error, didokumentasikan per endpoint).
 */
export const errorBodySchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Envelope error kontrak §1.5: `{ error: { code, message, details?, requestId } }`. */
export const errorEnvelopeSchema = z.object({ error: errorBodySchema });
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
