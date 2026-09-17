import { describe, expect, test } from 'vitest';

import { REQUEST_ID_HEADER } from '../../src/plugins/logger.js';
import { buildTestApp } from '../helpers/app.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('X-Request-Id', () => {
  test('dibuat UUID v4 bila klien tidak mengirim', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4);
  });

  test('setiap request mendapat id berbeda', async () => {
    const app = buildTestApp();
    const a = await app.inject({ method: 'GET', url: '/v1/health' });
    const b = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(a.headers[REQUEST_ID_HEADER]).not.toBe(b.headers[REQUEST_ID_HEADER]);
  });

  test.each(['abc-123', 'trace.id:01_A', 'x'.repeat(128)])(
    'id aman "%s" dipantulkan ke header dan envelope error',
    async (id) => {
      const app = buildTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/tidak-ada',
        headers: { [REQUEST_ID_HEADER]: id },
      });
      expect(res.headers[REQUEST_ID_HEADER]).toBe(id);
      expect(res.json<{ error: { requestId: string } }>().error.requestId).toBe(id);
    },
  );

  test.each([
    ['mengandung spasi', 'abc 123'],
    ['karakter tidak diizinkan', '<script>'],
    ['baris baru (injeksi log)', 'abc%0Adef'],
    ['terlalu panjang', 'x'.repeat(129)],
  ])('id tidak aman (%s) diganti UUID baru', async (_label, id) => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { [REQUEST_ID_HEADER]: id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID_V4);
    expect(res.headers[REQUEST_ID_HEADER]).not.toBe(id);
  });
});
