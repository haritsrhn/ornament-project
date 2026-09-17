import { errorEnvelopeSchema, type ErrorCode, type ErrorEnvelope } from '@ornament/shared';

/**
 * Membaca body respons error API (kontrak §1.5). Mengembalikan `null` bila body
 * bukan envelope error yang dikenal (mis. HTML dari proxy, atau kode di luar
 * katalog `@ornament/shared`).
 */
export function parseErrorEnvelope(body: unknown): ErrorEnvelope | null {
  const result = errorEnvelopeSchema.safeParse(body);
  return result.success ? result.data : null;
}

/** Bercabang berdasarkan `code`, bukan `message` (kontrak §1.5). */
export function hasErrorCode(body: unknown, code: ErrorCode): boolean {
  return parseErrorEnvelope(body)?.error.code === code;
}
