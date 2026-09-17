import { describe, expect, test } from 'vitest';

import { REQUEST_ID_HEADER } from '../../src/plugins/logger.js';
import { buildTestApp } from '../helpers/app.js';
import { createTestPrisma } from '../helpers/database.js';

describe('health (database tes nyata)', () => {
  test('terhubung ke database tes, bukan database dev', async () => {
    const app = buildTestApp({ prisma: createTestPrisma() });
    const rows = await app.prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.db).toMatch(/_test$/);
    expect(rows[0]?.db).not.toBe('ornament');
  });

  test('GET /v1/health/ready → 200 saat DB terjangkau', async () => {
    const app = buildTestApp({ prisma: createTestPrisma() });
    const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ok' } });
  });

  test('GET /v1/health/ready → 503 saat DB tidak terjangkau', async () => {
    // Port 1 di loopback: koneksi langsung ditolak, jauh di bawah timeout readiness.
    const prisma = createTestPrisma('postgresql://ornament:ornament@127.0.0.1:1/ornament_test');
    const app = buildTestApp({ prisma });
    const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database tidak dapat dihubungi.',
        requestId: res.headers[REQUEST_ID_HEADER],
      },
    });
    expect(res.body).not.toContain('127.0.0.1');
  });
});
