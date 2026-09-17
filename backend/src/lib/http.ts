import { z } from 'zod';

/** Envelope sukses kontrak §1.4: `{ data }` atau `{ data, meta }`. */
export type DataEnvelope<T, M = never> = [M] extends [never] ? { data: T } : { data: T; meta: M };

export function ok<T>(data: T): { data: T };
export function ok<T, M>(data: T, meta: M): { data: T; meta: M };
export function ok(data: unknown, meta?: unknown) {
  return meta === undefined ? { data } : { data, meta };
}

/** Skema respons Zod untuk `{ data: T }` — dipakai di `schema.response`. */
export function dataEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data });
}

/** Skema respons Zod untuk `{ data: T, meta: M }`. */
export function dataMetaEnvelope<T extends z.ZodType, M extends z.ZodType>(data: T, meta: M) {
  return z.object({ data, meta });
}
