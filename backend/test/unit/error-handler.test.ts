import type { ErrorEnvelope } from '@ornament/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { BODY_LIMIT_BYTES } from '../../src/app.js';
import { AppError, rateLimited } from '../../src/lib/errors.js';
import { toContractPath, toValidationDetails } from '../../src/plugins/error-handler.js';
import { REQUEST_ID_HEADER } from '../../src/plugins/logger.js';
import { buildTestApp } from '../helpers/app.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** App tanpa DB + rute uji yang memicu tiap cabang error handler. */
function buildAppWithTestRoutes(): FastifyInstance {
  const app = buildTestApp();
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/test/items',
    {
      schema: {
        body: z.strictObject({
          name: z.string().min(1),
          materials: z.array(z.strictObject({ materialId: z.uuid() })).optional(),
        }),
      },
    },
    (request) => ({ data: request.body }),
  );
  typed.get(
    '/test/query',
    { schema: { querystring: z.object({ page: z.coerce.number().int().min(1) }) } },
    (request) => ({ data: request.query }),
  );
  app.get('/test/app-error', () => {
    throw rateLimited(30);
  });
  app.get('/test/app-error-5xx', () => {
    throw new AppError('UPSTREAM_FAILED', 'Layanan hulu gagal.', {
      cause: new Error('detail hulu rahasia'),
    });
  });
  app.get('/test/crash', () => {
    throw new Error('detail internal rahasia');
  });
  app.get('/test/status-error', () => {
    throw Object.assign(new Error('gone'), { statusCode: 410 });
  });
  typed.get(
    '/test/bad-response',
    { schema: { response: { 200: z.object({ id: z.uuid() }) } } },
    // Sengaja melanggar skema respons.
    () => ({ id: 'bukan-uuid' }),
  );

  return app;
}

function errorOf(body: string): ErrorEnvelope['error'] {
  return (JSON.parse(body) as ErrorEnvelope).error;
}

describe('error handler — validasi', () => {
  test('VALIDATION_FAILED dengan details per field (notasi indeks)', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      payload: { name: '', materials: [{ materialId: 'x' }] },
    });

    expect(res.statusCode).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('Beberapa field tidak valid.');
    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', code: 'too_small' }),
        expect.objectContaining({ path: 'materials[0].materialId', code: 'invalid_format' }),
      ]),
    );
    expect(error.details).toHaveLength(2);
    expect(error.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  test('field tak dikenal → unrecognized_keys, satu entri per field', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      payload: {
        name: 'Lampu',
        extra: 1,
        materials: [{ materialId: '8d1b0c5e-2f1a-4c3b-9d4e-5f6a7b8c9d0e', foo: 2 }],
      },
    });

    expect(res.statusCode).toBe(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual(
      expect.arrayContaining([
        { path: 'extra', code: 'unrecognized_keys', message: 'Field tidak dikenal.' },
        { path: 'materials[0].foo', code: 'unrecognized_keys', message: 'Field tidak dikenal.' },
      ]),
    );
  });

  test('body valid lolos', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      payload: { name: 'Lampu' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { name: 'Lampu' } });
  });

  test('issue di querystring diberi path field', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/query?page=0' });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.body).details).toEqual([
      expect.objectContaining({ path: 'page', code: 'too_small' }),
    ]);
  });

  test('body bukan objek → path akar = nama lokasi', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      headers: { 'content-type': 'application/json' },
      payload: '[]',
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.body).details).toEqual([expect.objectContaining({ path: 'body' })]);
  });
});

describe('error handler — error bawaan Fastify', () => {
  test('rute tak dikenal → 404 NOT_FOUND tanpa query string di pesan', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/v1/tidak-ada?token=abc' });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    const error = errorOf(res.body);
    expect(error).toEqual({
      code: 'NOT_FOUND',
      message: 'Rute GET /v1/tidak-ada tidak ditemukan.',
      requestId: res.headers[REQUEST_ID_HEADER],
    });
    expect(error.requestId).toMatch(UUID_V4);
  });

  test('JSON rusak → 400 BAD_REQUEST', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      headers: { 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.body)).toMatchObject({ code: 'BAD_REQUEST', message: 'Body JSON rusak.' });
  });

  test('body JSON kosong → 400 BAD_REQUEST', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res.body).code).toBe('BAD_REQUEST');
  });

  test('body > 1 MB → 413 PAYLOAD_TOO_LARGE', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({
      method: 'POST',
      url: '/test/items',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(BODY_LIMIT_BYTES) }),
    });
    expect(res.statusCode).toBe(413);
    expect(errorOf(res.body)).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Body melebihi batas 1 MB.',
    });
  });

  test.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'Content-Type %s → 415 UNSUPPORTED_MEDIA_TYPE',
    async (contentType) => {
      const app = buildAppWithTestRoutes();
      const res = await app.inject({
        method: 'POST',
        url: '/test/items',
        headers: { 'content-type': contentType },
        payload: 'name=Lampu',
      });
      expect(res.statusCode).toBe(415);
      expect(errorOf(res.body)).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type harus application/json.',
      });
    },
  );
});

describe('error handler — error aplikasi & tak terduga', () => {
  test('AppError 4xx: kode, details, dan header dari error', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/app-error' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(errorOf(res.body)).toEqual({
      code: 'RATE_LIMITED',
      message: 'Terlalu banyak permintaan. Coba lagi nanti.',
      details: { retryAfterSeconds: 30 },
      requestId: res.headers[REQUEST_ID_HEADER],
    });
  });

  test('AppError 5xx tidak mengirim cause', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/app-error-5xx' });
    expect(res.statusCode).toBe(502);
    expect(errorOf(res.body).code).toBe('UPSTREAM_FAILED');
    expect(res.body).not.toContain('detail hulu rahasia');
  });

  test('error tak terduga → 500 INTERNAL_ERROR tanpa pesan asli maupun stack', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/crash' });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan pada server.',
        requestId: res.headers[REQUEST_ID_HEADER],
      },
    });
    expect(res.body).not.toContain('detail internal rahasia');
    expect(res.body).not.toMatch(/stack|\.ts:\d+/);
  });

  test('error 4xx lain tanpa pemetaan → kode BAD_REQUEST dengan status asli', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/status-error' });
    expect(res.statusCode).toBe(410);
    expect(errorOf(res.body)).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Permintaan tidak valid.',
    });
  });

  test('respons tidak cocok skema → 500 INTERNAL_ERROR', async () => {
    const app = buildAppWithTestRoutes();
    const res = await app.inject({ method: 'GET', url: '/test/bad-response' });
    expect(res.statusCode).toBe(500);
    expect(errorOf(res.body).code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('bukan-uuid');
  });
});

describe('toContractPath / toValidationDetails', () => {
  test.each([
    [[], ''],
    [['name'], 'name'],
    [['materials', '0', 'materialId'], 'materials[0].materialId'],
    [['a', '1', '2', 'b'], 'a[1][2].b'],
  ])('%j → "%s"', (segments, expected) => {
    expect(toContractPath(segments)).toBe(expected);
  });

  test('men-decode JSON pointer dan memakai lokasi untuk path akar', () => {
    const error = {
      validationContext: 'querystring',
      validation: [
        { instancePath: '/a~1b/c~0d', keyword: 'custom', params: {}, message: 'X' },
        { instancePath: '', keyword: 'invalid_type', params: {} },
      ],
    } as unknown as FastifyError;
    expect(toValidationDetails(error)).toEqual([
      { path: 'a/b.c~d', code: 'custom', message: 'X' },
      { path: 'querystring', code: 'invalid_type', message: 'Tidak valid.' },
    ]);
  });
});
