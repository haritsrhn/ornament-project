/**
 * Error aplikasi bertipe sesuai kontrak API §1.5 (envelope) dan §1.10 (katalog).
 *
 * Modul cukup `throw notFound()` / `throw new AppError(...)`; error handler global
 * (`src/plugins/error-handler.ts`) mengubahnya menjadi
 * `{ error: { code, message, details, requestId } }`.
 */

import type { ErrorCode, ValidationDetail } from '@ornament/shared';

/**
 * Status HTTP default per kode katalog §1.10. Daftar kode (`ErrorCode`) dan
 * bentuk envelope milik kontrak di `@ornament/shared`; status HTTP adalah
 * urusan server, jadi tetap di sini. `satisfies` memastikan setiap kode punya
 * status dan tidak ada kode di luar katalog.
 */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  INVALID_CURSOR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVALID_INTERNAL_KEY: 401,
  FORBIDDEN: 403,
  FORBIDDEN_FIELD: 403,
  ORIGIN_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EDIT_CONFLICT: 409,
  INVALID_STATE: 409,
  IN_USE: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PUBLISH_REQUIREMENTS_NOT_MET: 422,
  BUSINESS_RULE_VIOLATION: 422,
  UPLOAD_INVALID: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  UPSTREAM_FAILED: 502,
  SERVICE_UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, number>;

export interface AppErrorOptions {
  details?: unknown;
  /** Status HTTP; default dari katalog untuk `code`. */
  statusCode?: number;
  /** Header tambahan pada respons (mis. `Retry-After`). */
  headers?: Record<string, string>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = options.statusCode ?? ERROR_STATUS[code];
    this.details = options.details;
    this.headers = options.headers;
  }

  /** Error 5xx dianggap tak terduga: dicatat lengkap, pesan tidak dikirim apa adanya. */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

// ── Helper untuk kode yang sering dipakai ────────────────────────────────────

export const badRequest = (message = 'Permintaan tidak valid.', details?: unknown) =>
  new AppError('BAD_REQUEST', message, { details });

export const validationFailed = (
  details: ValidationDetail[],
  message = 'Beberapa field tidak valid.',
) => new AppError('VALIDATION_FAILED', message, { details });

export const unauthenticated = (message = 'Sesi tidak ada atau sudah berakhir.') =>
  new AppError('UNAUTHENTICATED', message);

export const forbidden = (
  message = 'Anda tidak memiliki izin untuk aksi ini.',
  details?: unknown,
) => new AppError('FORBIDDEN', message, { details });

export const notFound = (message = 'Data tidak ditemukan.') => new AppError('NOT_FOUND', message);

export const conflict = (fields: string[], message = 'Data bentrok dengan data yang sudah ada.') =>
  new AppError('CONFLICT', message, { details: { fields } });

export const businessRuleViolation = (rule: string, message: string) =>
  new AppError('BUSINESS_RULE_VIOLATION', message, { details: { rule } });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi nanti.', {
    details: { retryAfterSeconds },
    headers: { 'retry-after': String(retryAfterSeconds) },
  });

export const serviceUnavailable = (message = 'Layanan sedang tidak tersedia.', cause?: unknown) =>
  new AppError('SERVICE_UNAVAILABLE', message, { cause });
