import type { FastifyInstance, RouteOptions } from 'fastify';
import { describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import {
  MissingPublicAccessError,
  PUBLIC_GET_CACHE_CONTROL,
  PUBLIC_PATH_PREFIX,
  PUBLIC_RATE_LIMIT_ANONYMOUS_MAX,
  PUBLIC_RATE_LIMIT_TRUSTED_MAX,
  isPublicPath,
  publicReadAccess,
  publicWriteAccess,
} from '../../src/modules/public/guard.js';

/**
 * Cerminan `admin-access.test.ts` untuk rute publik: setiap rute
 * `/v1/public/*` harus menyatakan `config.publicAccess` **dan** batas rate
 * limit-nya (kontrak §2.3), dan GET publik harus membawa `Cache-Control` §1.2.
 */

async function collectRoutes(app: FastifyInstance): Promise<RouteOptions[]> {
  const routes: RouteOptions[] = [];
  app.addHook('onRoute', (route) => {
    routes.push(route);
  });
  await app.ready();
  return routes;
}

/** Rute publik yang memang **menulis**, beserta alasannya. Ditulis ulang di sini supaya penambahannya terlihat saat review. */
const EXPECTED_PUBLIC_WRITE_ROUTES = new Set<string>([
  // Submit form "Konsultasikan Proyek" (kontrak §5.4, #21).
  'POST /v1/public/inquiries',
  // Presign lampiran inquiry (A5); presign-nya sendiri ditunda ke Tahap 7.
  'POST /v1/public/inquiry-uploads',
  // Submit komentar journal, masuk antrean moderasi (kontrak §5.3, #22).
  'POST /v1/public/articles/:slug/comments',
]);

describe('penanda rute publik', () => {
  test('setiap rute /v1/public/* menyatakan publicAccess dan rateLimit', async () => {
    const app = buildApp({ logger: false });
    const routes = await collectRoutes(app);
    await app.close();

    const publicRoutes = routes.filter((route) => route.url.startsWith(PUBLIC_PATH_PREFIX));
    expect(publicRoutes.length).toBeGreaterThan(0);

    const tanpaPenanda = publicRoutes
      .filter(
        (route) => route.config?.publicAccess === undefined || route.config.rateLimit === undefined,
      )
      .map((route) => `${String(route.method)} ${route.url}`);
    expect(tanpaPenanda).toEqual([]);
  });

  test('daftar rute publik yang menulis persis seperti yang diizinkan kontrak', async () => {
    const app = buildApp({ logger: false });
    const routes = await collectRoutes(app);
    await app.close();

    const menulis = routes
      .filter(
        (route) =>
          route.url.startsWith(PUBLIC_PATH_PREFIX) && route.config?.publicAccess?.kind === 'write',
      )
      .map((route) => `${String(route.method)} ${route.url}`);

    expect(new Set(menulis)).toEqual(EXPECTED_PUBLIC_WRITE_ROUTES);
  });

  test('rute publik baru tanpa penanda gagal saat registrasi, bukan tanpa batas', async () => {
    const app = buildApp({ logger: false });
    expect(() => app.get('/v1/public/lupa-penanda', () => ({ data: null }))).toThrow(
      MissingPublicAccessError,
    );
    await app.close();
  });

  test('isPublicPath hanya cocok pada prefiks publik', () => {
    expect(isPublicPath('/v1/public')).toBe(true);
    expect(isPublicPath('/v1/public/products?category=x')).toBe(true);
    expect(isPublicPath('/v1/publication')).toBe(false);
    expect(isPublicPath('/v1/admin/users')).toBe(false);
  });

  test('penanda baca & tulis membawa batas kontrak §2.3', () => {
    const baca = publicReadAccess();
    expect(baca.publicAccess).toEqual({ kind: 'read' });
    expect(baca.rateLimit.timeWindow).toBe('1 minute');
    expect(baca.rateLimit.max({ isTrustedInternalCaller: true } as never)).toBe(
      PUBLIC_RATE_LIMIT_TRUSTED_MAX,
    );
    expect(baca.rateLimit.max({ isTrustedInternalCaller: false } as never)).toBe(
      PUBLIC_RATE_LIMIT_ANONYMOUS_MAX,
    );
    // Kuota tepercaya dan anonim disimpan di kunci yang berbeda.
    expect(
      baca.rateLimit.keyGenerator({ isTrustedInternalCaller: true, ip: '10.0.0.1' } as never),
    ).not.toBe(
      baca.rateLimit.keyGenerator({ isTrustedInternalCaller: false, ip: '10.0.0.1' } as never),
    );

    expect(publicWriteAccess('kirim inquiry').publicAccess).toEqual({
      kind: 'write',
      reason: 'kirim inquiry',
    });
  });
});

describe('header & X-Internal-Key rute publik', () => {
  test('GET publik memakai Cache-Control edge, bukan no-store', async () => {
    const app = buildApp({ logger: false });
    // Tanpa Prisma: rutenya tetap terdaftar, jadi header sudah dipasang
    // sebelum handler menyentuh database.
    const res = await app.inject({ url: '/v1/public/products' });
    expect(res.headers['cache-control']).toBe(PUBLIC_GET_CACHE_CONTROL);
    await app.close();
  });

  test('X-Internal-Key yang salah pada GET tidak menghasilkan 401 (A9)', async () => {
    const app = buildApp({ logger: false, internalApiKey: 'kunci-yang-benar' });
    const res = await app.inject({
      url: '/v1/public/products',
      headers: { 'x-internal-key': 'kunci-yang-salah' },
    });
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });

  test('rute admin tidak ikut memakai Cache-Control publik', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ url: '/v1/admin/auth/me' });
    expect(res.headers['cache-control']).toBe('no-store');
    await app.close();
  });
});
