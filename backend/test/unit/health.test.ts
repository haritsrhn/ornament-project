import { describe, expect, test } from 'vitest';

import { REQUEST_ID_HEADER } from '../../src/plugins/logger.js';
import { buildTestApp } from '../helpers/app.js';

describe('health (tanpa database)', () => {
  test('GET /v1/health → 200 liveness', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json()).toEqual({ data: { status: 'ok' } });
  });

  test('GET /v1/health/ready → 503 bila app dibangun tanpa DB', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database tidak dikonfigurasi.',
        requestId: res.headers[REQUEST_ID_HEADER],
      },
    });
  });

  test('metode lain pada rute health → 404 NOT_FOUND', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/health' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});
