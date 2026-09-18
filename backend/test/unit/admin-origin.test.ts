import { describe, expect, test } from 'vitest';

import {
  ADMIN_CORS_HEADERS,
  ADMIN_CORS_METHODS,
  isAdminPath,
  normalizeOrigin,
} from '../../src/plugins/admin-origin.js';
import { buildTestApp } from '../helpers/app.js';
import { errorBody } from '../helpers/auth.js';

const ADMIN_ORIGIN = 'https://admin.ornament.id';

const loginBody = { email: 'rani@ornament.id', password: 'kata-sandi-1', rememberMe: false };

describe('isAdminPath / normalizeOrigin', () => {
  test('hanya /v1/admin dan turunannya', () => {
    expect(isAdminPath('/v1/admin')).toBe(true);
    expect(isAdminPath('/v1/admin/auth/login')).toBe(true);
    expect(isAdminPath('/v1/admin/products?page=2')).toBe(true);
    expect(isAdminPath('/v1/health')).toBe(false);
    expect(isAdminPath('/v1/public/products')).toBe(false);
    // Bukan prefiks: jangan tertipu path yang hanya mirip.
    expect(isAdminPath('/v1/administrator')).toBe(false);
  });

  test('origin dinormalisasi ke skema+host+port, trailing slash diabaikan', () => {
    expect(normalizeOrigin('https://admin.ornament.id/')).toBe('https://admin.ornament.id');
    expect(normalizeOrigin('https://admin.ornament.id/masuk')).toBe('https://admin.ornament.id');
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });
});

describe('cek Origin non-GET (ADR K7, kontrak §1.2)', () => {
  test('POST dari origin lain → 403 ORIGIN_NOT_ALLOWED', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: 'https://penyerang.example', 'content-type': 'application/json' },
      payload: loginBody,
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res)).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  test('POST tanpa header Origin juga ditolak', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: loginBody,
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('host yang mirip tapi beda (subdomain/port/skema) ditolak', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    for (const origin of [
      'https://admin.ornament.id.penyerang.example',
      'http://admin.ornament.id',
      'https://admin.ornament.id:8443',
      'https://ornament.id',
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/auth/login',
        headers: { origin, 'content-type': 'application/json' },
        payload: loginBody,
      });
      expect(res.statusCode, origin).toBe(403);
    }
  });

  test('tanpa ADMIN_ORIGIN, semua non-GET admin ditolak (fail-closed)', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: loginBody,
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('Origin ditolak SEBELUM validasi body (kontrak §1.10: 403 dulu)', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: 'https://penyerang.example', 'content-type': 'application/json' },
      payload: { email: 'bukan-email', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('Origin yang benar lolos guard dan lanjut ke validasi', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { email: 'rani@gmail.com', password: 'kata-sandi-1' },
    });
    expect(res.statusCode).toBe(400);
    const error = errorBody(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    // Kode issue kustom kontrak §1.5, bukan `custom` bawaan Zod.
    expect(error.details).toEqual([
      { path: 'email', code: 'email_domain', message: 'Gunakan email @ornament.id.' },
    ]);
  });

  test('GET admin tidak butuh Origin (tetap kena guard sesi)', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('UNAUTHENTICATED');
  });

  test('rute non-admin tidak tersentuh guard Origin', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://penyerang.example' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('CORS admin (kontrak §2.1)', () => {
  test('preflight dari ADMIN_ORIGIN diizinkan dengan credentials', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/admin/auth/login',
      headers: {
        origin: ADMIN_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    for (const method of ADMIN_CORS_METHODS) {
      expect(String(res.headers['access-control-allow-methods'])).toContain(method);
    }
    for (const header of ADMIN_CORS_HEADERS) {
      expect(String(res.headers['access-control-allow-headers'])).toContain(header);
    }
  });

  test('tidak ada wildcard, dan origin lain tidak mendapat izin', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/v1/admin/auth/login',
      headers: { origin: 'https://penyerang.example', 'access-control-request-method': 'POST' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('respons admin selalu no-store (kontrak §1.2)', async () => {
    const app = buildTestApp({ adminOrigin: ADMIN_ORIGIN });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/auth/me' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
