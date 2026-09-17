import type { ErrorCode, ErrorEnvelope, ValidationDetail } from '@ornament/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ERROR_STATUS, isAppError } from '../lib/errors.js';

/** Pemetaan error bawaan Fastify (kode `FST_ERR_*`) ke kode kontrak §1.10. */
const FASTIFY_CODE_MAP: Record<string, { code: ErrorCode; message: string }> = {
  FST_ERR_CTP_INVALID_JSON_BODY: { code: 'BAD_REQUEST', message: 'Body JSON rusak.' },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    code: 'BAD_REQUEST',
    message: 'Body JSON kosong padahal Content-Type application/json.',
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {
    code: 'BAD_REQUEST',
    message: 'Content-Length tidak sesuai dengan body.',
  },
  FST_ERR_CTP_BODY_TOO_LARGE: { code: 'PAYLOAD_TOO_LARGE', message: 'Body melebihi batas 1 MB.' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Content-Type harus application/json.',
  },
  FST_ERR_CTP_INVALID_TYPE: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Content-Type harus application/json.',
  },
};

/** Fallback untuk error 4xx lain yang membawa `statusCode` (mis. dari plugin pihak ketiga). */
const STATUS_FALLBACK: Partial<Record<number, { code: ErrorCode; message: string }>> = {
  400: { code: 'BAD_REQUEST', message: 'Permintaan tidak valid.' },
  401: { code: 'UNAUTHENTICATED', message: 'Sesi tidak ada atau sudah berakhir.' },
  403: { code: 'FORBIDDEN', message: 'Anda tidak memiliki izin untuk aksi ini.' },
  404: { code: 'NOT_FOUND', message: 'Data tidak ditemukan.' },
  409: { code: 'CONFLICT', message: 'Data bentrok dengan data yang sudah ada.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Body melebihi batas 1 MB.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type harus application/json.' },
  429: { code: 'RATE_LIMITED', message: 'Terlalu banyak permintaan. Coba lagi nanti.' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Layanan sedang tidak tersedia.' },
};

const INTERNAL = { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server.' } as const;

/** `/materials/0/materialId` → `materials[0].materialId`. */
export function toContractPath(segments: readonly string[]): string {
  return segments.reduce(
    (path, segment) =>
      /^\d+$/.test(segment) ? `${path}[${segment}]` : path ? `${path}.${segment}` : segment,
    '',
  );
}

function splitInstancePath(instancePath: string): string[] {
  return instancePath
    .split('/')
    .filter((s) => s !== '')
    .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/**
 * Mengubah `error.validation` (dari validatorCompiler Zod maupun Ajv) menjadi
 * `details[]` kontrak §1.5. `unrecognized_keys` dipecah satu entri per field agar
 * `path` menunjuk field yang ditolak. Path kosong (akar) diisi nama lokasi
 * (`body`/`querystring`/`params`/`headers`) supaya tidak pernah kosong.
 */
export function toValidationDetails(error: FastifyError): ValidationDetail[] {
  const location = error.validationContext ?? 'body';
  const details: ValidationDetail[] = [];

  for (const issue of error.validation ?? []) {
    const base = splitInstancePath(issue.instancePath);
    const code = issue.keyword;
    const params = issue.params as { keys?: unknown };

    if (code === 'unrecognized_keys' && Array.isArray(params.keys)) {
      for (const key of params.keys) {
        details.push({
          path: toContractPath([...base, String(key)]),
          code,
          message: 'Field tidak dikenal.',
        });
      }
      continue;
    }

    details.push({
      path: toContractPath(base) || location,
      code,
      message: issue.message ?? 'Tidak valid.',
    });
  }
  return details;
}

function send(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  const body: ErrorEnvelope = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: request.id,
    },
  };
  return reply.code(statusCode).type('application/json; charset=utf-8').send(body);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : undefined;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    send(
      request,
      reply,
      404,
      'NOT_FOUND',
      `Rute ${request.method} ${request.url.split('?', 1)[0] ?? ''} tidak ditemukan.`,
    ),
  );

  app.setErrorHandler((error: unknown, request, reply) => {
    // 1. Error aplikasi bertipe.
    if (isAppError(error)) {
      if (error.isServerError) {
        request.log.error({ err: error }, 'error aplikasi 5xx');
      } else {
        request.log.info({ code: error.code, statusCode: error.statusCode }, 'error aplikasi');
      }
      if (error.headers) void reply.headers(error.headers);
      // Pesan 5xx tetap aman karena ditulis developer, tetapi `cause` tidak pernah dikirim.
      return send(request, reply, error.statusCode, error.code, error.message, error.details);
    }

    const fastifyError = error as Partial<FastifyError>;

    // 2. Gagal skema (body/querystring/params/headers).
    if (Array.isArray(fastifyError.validation)) {
      const details = toValidationDetails(error as FastifyError);
      request.log.info(
        { code: 'VALIDATION_FAILED', location: fastifyError.validationContext },
        'validasi gagal',
      );
      return send(request, reply, 400, 'VALIDATION_FAILED', 'Beberapa field tidak valid.', details);
    }

    // 3. Error bawaan Fastify yang dikenal.
    const mapped =
      typeof fastifyError.code === 'string' ? FASTIFY_CODE_MAP[fastifyError.code] : undefined;
    const status = statusOf(error);
    if (mapped) {
      request.log.info({ code: mapped.code, fastifyCode: fastifyError.code }, 'request ditolak');
      return send(request, reply, ERROR_STATUS[mapped.code], mapped.code, mapped.message);
    }

    // 4. Error 4xx lain dengan statusCode, dan 503.
    const fallback = status === undefined ? undefined : STATUS_FALLBACK[status];
    if (status !== undefined && fallback && (status < 500 || status === 503)) {
      request.log.info({ code: fallback.code, statusCode: status }, 'request ditolak');
      return send(request, reply, status, fallback.code, fallback.message);
    }
    if (status !== undefined && status < 500) {
      request.log.info({ statusCode: status }, 'request ditolak');
      return send(request, reply, status, 'BAD_REQUEST', 'Permintaan tidak valid.');
    }

    // 5. Tak terduga → 500. Stack hanya ke log, tidak ke respons.
    request.log.error({ err: error }, 'error tak terduga');
    return send(request, reply, 500, INTERNAL.code, INTERNAL.message);
  });
}
