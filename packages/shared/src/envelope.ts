import { z } from 'zod';

/**
 * Envelope sukses kontrak API §1.4: `{ data }` atau `{ data, meta }`.
 *
 * `DataEnvelope<T>` → `{ data: T }`; `DataEnvelope<T, M>` → `{ data: T; meta: M }`.
 */
export type DataEnvelope<T, M = never> = [M] extends [never] ? { data: T } : { data: T; meta: M };

/** Skema `{ data: T }` — dipakai backend di `schema.response`, frontend untuk parse respons. */
export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

/** Skema `{ data: T, meta: M }` (daftar ber-halaman/kursor, §1.6). */
export function dataMetaEnvelope<T extends z.ZodType, M extends z.ZodType>(data: T, meta: M) {
  return z.object({ data, meta });
}
