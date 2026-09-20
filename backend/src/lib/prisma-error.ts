/**
 * Menerjemahkan pelanggaran constraint unik Postgres menjadi `409 CONFLICT`
 * beserta `details.fields` sesuai kontrak §1.10 (mis. `["slug"]`, `["sku"]`,
 * `["skuCode"]`).
 *
 * Kenapa perlu berkas tersendiri: dengan **driver adapter** (`@prisma/adapter-pg`,
 * ADR K1) Prisma tidak lagi mengisi `meta.target`. Yang tersedia hanyalah nama
 * indeks Postgres di `meta.driverAdapterError.cause.constraint.index`, mis.
 * `material_sku_code_key`. Tanpa pemetaan di sini setiap konflik akan jatuh ke
 * tebakan default dan UI menyorot field yang salah.
 */

/** Kode Prisma untuk pelanggaran constraint unik. */
export const UNIQUE_VIOLATION = 'P2002';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** `sku_code` → `skuCode`. Nama kolom di DB snake_case (konvensi skema). */
function toCamelCase(column: string): string {
  return column.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

interface AdapterConstraint {
  index?: unknown;
  fields?: unknown;
}

function adapterConstraint(
  error: unknown,
): { constraint: AdapterConstraint; table: string } | null {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } }).meta;
  const cause = meta?.driverAdapterError?.cause;
  if (typeof cause !== 'object' || cause === null) return null;

  const constraint = (cause as { constraint?: unknown }).constraint;
  if (typeof constraint !== 'object' || constraint === null) return null;

  const table = (cause as { table?: unknown }).table;
  return { constraint, table: typeof table === 'string' ? table : '' };
}

/**
 * Nama field yang bentrok, atau `fallback` bila tidak bisa disimpulkan.
 *
 * Urutan sumber: `meta.target` (Prisma tanpa adapter) → `constraint.fields` →
 * nama indeks (`<tabel>_<kolom>_key`). Nama indeks dipakai terakhir karena ia
 * konvensi Postgres, bukan janji Prisma.
 */
export function uniqueConflictFields(error: unknown, fallback: readonly string[]): string[] {
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String).map(toCamelCase);
  if (typeof target === 'string') return [toCamelCase(target)];

  const adapter = adapterConstraint(error);
  if (adapter !== null) {
    if (Array.isArray(adapter.constraint.fields)) {
      return adapter.constraint.fields.map(String).map(toCamelCase);
    }
    const index = adapter.constraint.index;
    if (typeof index === 'string') {
      const column = index
        .replace(/_(key|unique|pkey)$/, '')
        .replace(adapter.table === '' ? /^$/ : new RegExp(`^${adapter.table}_`), '');
      if (column !== '' && column !== index) return [toCamelCase(column)];
    }
  }
  return [...fallback];
}
