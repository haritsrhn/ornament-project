import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import type { Env } from '../config/env.js';

export type LoggerOption = Exclude<FastifyServerOptions['logger'], undefined>;

/** Header request ID (kontrak §1.2). Node menormalkan nama header masuk ke huruf kecil. */
export const REQUEST_ID_HEADER = 'x-request-id';

/** ID dari klien hanya dipakai bila aman untuk log/header: pendek dan tanpa karakter aneh. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Memakai `X-Request-Id` masuk bila valid, selain itu membuat UUID v4.
 * (Opsi bawaan `requestIdHeader` Fastify menerima nilai apa pun tanpa validasi.)
 */
export function genReqId(req: IncomingMessage): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) return incoming;
  return randomUUID();
}

/** Path yang disensor pino. Header masuk dicatat lewat serializer `req` di bawah. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-internal-key"]',
  'req.headers["x-revalidate-secret"]',
  // PII: API hanya boleh menyimpan hash IP pengunjung (kontrak §1.2).
  'req.headers["x-client-ip"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
  'headers["x-internal-key"]',
  'headers["x-revalidate-secret"]',
  'headers["set-cookie"]',
  'password',
  '*.password',
  'body.password',
  'req.body.password',
  '*.newPassword',
  '*.currentPassword',
];

function isPrettyAvailable(): boolean {
  try {
    import.meta.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Opsi logger Fastify/pino. `pino-pretty` hanya devDependency: dipakai bila
 * `NODE_ENV=development` dan paketnya terpasang; production selalu JSON.
 */
export function buildLoggerOptions(config: Env | undefined): LoggerOption {
  const level = config?.LOG_LEVEL ?? 'info';
  const pretty = config?.NODE_ENV === 'development' && isPrettyAvailable();

  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          host: request.host,
          remoteAddress: request.ip,
          headers: request.headers,
        };
      },
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

/** Memantulkan request ID ke header respons pada setiap request (termasuk 404 & error). */
export function registerRequestId(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
}
