/**
 * Helper envelope sukses kontrak §1.4 di sisi server. Tipe `DataEnvelope` dan
 * skema `dataEnvelope()` / `dataMetaEnvelope()` ada di `@ornament/shared`.
 */
export function ok<T>(data: T): { data: T };
export function ok<T, M>(data: T, meta: M): { data: T; meta: M };
export function ok(data: unknown, meta?: unknown) {
  return meta === undefined ? { data } : { data, meta };
}
