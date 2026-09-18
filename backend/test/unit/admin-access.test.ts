import type { FastifyInstance, RouteOptions } from 'fastify';
import { describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import { ADMIN_PATH_PREFIX } from '../../src/plugins/admin-origin.js';
import { adminPermission, MissingAdminAccessError } from '../../src/modules/auth/guard.js';

/**
 * Pengaman rute admin (#15): **setiap** rute `/v1/admin/*` harus menyatakan
 * izinnya lewat `config.adminAccess`, dan yang tidak publik harus benar-benar
 * memasang guard sesi.
 *
 * Pemeriksaan utamanya ada di runtime (`registerAuthGuard` melempar saat
 * registrasi). Berkas ini menyisir daftar rute yang benar-benar terdaftar,
 * sehingga modul Tahap 4+ tidak bisa lolos hanya karena tidak pernah diuji.
 */

/** Mengumpulkan semua rute yang didaftarkan `buildApp`. */
async function collectRoutes(app: FastifyInstance): Promise<RouteOptions[]> {
  const routes: RouteOptions[] = [];
  app.addHook('onRoute', (route) => {
    routes.push(route);
  });
  await app.ready();
  return routes;
}

function hookArray(hook: RouteOptions['onRequest']): unknown[] {
  if (hook === undefined) return [];
  return Array.isArray(hook) ? hook : [hook];
}

/**
 * Rute admin yang memang berjalan **tanpa sesi**, beserta alasannya. Daftar ini
 * sengaja ditulis ulang di tes: menambah rute admin tanpa sesi berarti harus
 * menyentuh berkas ini, jadi keputusannya selalu terlihat saat review.
 */
const EXPECTED_PUBLIC_ADMIN_ROUTES = new Set([
  'POST /v1/admin/auth/login',
  'POST /v1/admin/auth/logout',
  'GET /v1/admin/auth/invites/:token',
  'HEAD /v1/admin/auth/invites/:token',
  'POST /v1/admin/auth/invites/accept',
]);

describe('penanda izin rute admin', () => {
  test('setiap rute /v1/admin/* menyatakan config.adminAccess', async () => {
    const app = buildApp({ logger: false });
    const routes = await collectRoutes(app);
    await app.close();

    const adminRoutes = routes.filter((route) => route.url.startsWith(ADMIN_PATH_PREFIX));
    expect(adminRoutes.length).toBeGreaterThan(0);

    const tanpaPenanda = adminRoutes
      .filter((route) => route.config?.adminAccess === undefined)
      .map((route) => `${String(route.method)} ${route.url}`);
    expect(tanpaPenanda).toEqual([]);
  });

  test('rute admin bersesi/berizin benar-benar memasang guard sesi', async () => {
    const app = buildApp({ logger: false });
    const routes = await collectRoutes(app);
    const requireSession: unknown = app.requireSession;
    await app.close();

    const berizin = routes.filter(
      (route) =>
        route.url.startsWith(ADMIN_PATH_PREFIX) && route.config?.adminAccess?.kind !== 'public',
    );
    expect(berizin.length).toBeGreaterThan(0);

    for (const route of berizin) {
      const hooks = hookArray(route.onRequest);
      expect(
        hooks.includes(requireSession),
        `${String(route.method)} ${route.url} tidak memasang requireSession`,
      ).toBe(true);
      // Rute berizin memasang satu hook tambahan (cek izin) di depan yang lain.
      if (route.config?.adminAccess?.kind === 'permission') {
        expect(hooks.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('daftar rute admin tanpa sesi persis seperti yang diizinkan kontrak §2.2', async () => {
    const app = buildApp({ logger: false });
    const routes = await collectRoutes(app);
    await app.close();

    const publik = routes
      .filter(
        (route) =>
          route.url.startsWith(ADMIN_PATH_PREFIX) && route.config?.adminAccess?.kind === 'public',
      )
      .map((route) => `${String(route.method)} ${route.url}`);

    expect(new Set(publik)).toEqual(EXPECTED_PUBLIC_ADMIN_ROUTES);
  });

  test('rute admin baru tanpa penanda gagal saat registrasi, bukan diam-diam terbuka', async () => {
    const app = buildApp({ logger: false });
    // Hook `onRoute` melempar, jadi kegagalannya terjadi persis saat rute
    // didaftarkan — sebelum ada satu pun request yang bisa masuk.
    expect(() => app.get('/v1/admin/lupa-izin', () => ({ data: null }))).toThrow(
      MissingAdminAccessError,
    );
    await app.close();
  });

  test('rute non-admin tidak butuh penanda', async () => {
    const app = buildApp({ logger: false });
    app.get('/v1/public/apa-saja', () => ({ data: null }));
    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });

  test('penanda izin memakai kode Permission kontrak §3.3', () => {
    expect(adminPermission('user.manage')).toEqual({
      kind: 'permission',
      permission: 'user.manage',
    });
  });
});
