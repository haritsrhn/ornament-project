import { permissionsForRole, rolesWithPermission, type AdminUser } from '@ornament/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminRequest, deleteTestInvites, loginToken } from '../helpers/admin.js';
import {
  ADMIN_ORIGIN,
  createTestUser,
  deleteTestUsers,
  errorBody,
  meBody,
  sessionCookieHeader,
  type TestUser,
  type TestUserInput,
} from '../helpers/auth.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Pengguna admin (#16) + matriks izin per endpoint (#15) terhadap database tes.
 *
 * Fixture dibuat sendiri (email bersufiks acak) dan dibersihkan di `afterAll`;
 * tidak ada satu pun assertion yang bergantung pada data seed.
 */

let prisma: PrismaClient;
const createdUserIds: string[] = [];
const createdInviteIds: string[] = [];

async function makeUser(input: TestUserInput = {}): Promise<TestUser> {
  const user = await createTestUser(prisma, input);
  createdUserIds.push(user.id);
  return user;
}

function buildTestApp(): FastifyInstance {
  return buildApp({ prisma, logger: false, adminOrigin: ADMIN_ORIGIN });
}

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await deleteTestInvites(prisma, createdInviteIds);
  await deleteTestUsers(prisma, createdUserIds);
  await prisma.$disconnect();
});

function dataOf(res: LightMyRequestResponse): AdminUser {
  return res.json<{ data: AdminUser }>().data;
}

// ── Matriks izin per endpoint (#15) ──────────────────────────────────────────

describe('matriks izin /v1/admin/users/* dan /v1/admin/invites/*', () => {
  const endpoints = [
    { method: 'GET' as const, url: () => '/v1/admin/users' },
    { method: 'GET' as const, url: (id: string) => `/v1/admin/users/${id}` },
    {
      method: 'PATCH' as const,
      url: (id: string) => `/v1/admin/users/${id}`,
      payload: { name: 'X' },
    },
    { method: 'POST' as const, url: (id: string) => `/v1/admin/users/${id}/revoke` },
    { method: 'POST' as const, url: (id: string) => `/v1/admin/users/${id}/reactivate` },
    { method: 'GET' as const, url: () => '/v1/admin/invites' },
    {
      method: 'POST' as const,
      url: () => '/v1/admin/invites',
      payload: { email: 'x@ornament.id', role: 'EDITOR' },
    },
    {
      method: 'POST' as const,
      url: (id: string) => `/v1/admin/invites/${id}/resend`,
    },
    { method: 'DELETE' as const, url: (id: string) => `/v1/admin/invites/${id}` },
  ];

  test.each(['EDITOR', 'CONTRIBUTOR'] as const)(
    '%s ditolak 403 FORBIDDEN di semua endpoint pengguna & undangan',
    async (role) => {
      const app = buildTestApp();
      const user = await makeUser({ role });
      const token = await loginToken(app, user.email, user.password);

      for (const endpoint of endpoints) {
        const res = await adminRequest(app, {
          method: endpoint.method,
          url: endpoint.url(user.id),
          token,
          payload: endpoint.payload,
        });

        const label = `${endpoint.method} ${endpoint.url(user.id)}`;
        expect(res.statusCode, label).toBe(403);
        const error = errorBody(res);
        expect(error.code, label).toBe('FORBIDDEN');
        expect(error.details).toEqual({
          requiredPermission: 'user.manage',
          requiredRoles: rolesWithPermission('user.manage'),
        });
      }

      // Peran ini memang tidak punya `user.manage` di `Me.permissions`.
      expect(permissionsForRole(role)).not.toContain('user.manage');
      await app.close();
    },
  );

  test('tanpa sesi menjawab 401 UNAUTHENTICATED (sebelum 403 dan sebelum validasi)', async () => {
    const app = buildTestApp();
    const user = await makeUser({ role: 'ADMINISTRATOR' });

    for (const endpoint of endpoints) {
      const res = await adminRequest(app, {
        method: endpoint.method,
        url: endpoint.url(user.id),
        payload: endpoint.payload,
      });
      const label = `${endpoint.method} ${endpoint.url(user.id)}`;
      expect(res.statusCode, label).toBe(401);
      expect(errorBody(res).code, label).toBe('UNAUTHENTICATED');
    }
    await app.close();
  });

  test('403 mendahului validasi body: Editor dengan body rusak tetap 403', async () => {
    const app = buildTestApp();
    const editor = await makeUser({ role: 'EDITOR' });
    const token = await loginToken(app, editor.email, editor.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${editor.id}`,
      token,
      payload: { role: 'BUKAN_PERAN', fieldAsing: 1 },
    });

    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('FORBIDDEN');
    await app.close();
  });

  test('Administrator boleh: list pengguna 200 + meta pagination & counts', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, { method: 'GET', url: '/v1/admin/users', token });
    expect(res.statusCode).toBe(200);

    const body = res.json<{ data: AdminUser[]; meta: Record<string, unknown> }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.meta.counts).toBeDefined();
    // DTO whitelist: hash kata sandi tidak mungkin ikut.
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('$argon2');
    await app.close();
  });
});

// ── CRUD & filter ────────────────────────────────────────────────────────────

describe('GET /v1/admin/users', () => {
  test('filter q + role, sort, dan pagination bekerja', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR', name: 'Zulfa Pencari' });
    const editor = await makeUser({ role: 'EDITOR', name: 'Adi Pencari' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users?q=Pencari&sort=name&pageSize=50',
      token,
    });
    expect(res.statusCode).toBe(200);
    const names = res.json<{ data: AdminUser[] }>().data.map((u) => u.name);
    expect(names).toContain('Adi Pencari');
    expect(names).toContain('Zulfa Pencari');
    expect(names.indexOf('Adi Pencari')).toBeLessThan(names.indexOf('Zulfa Pencari'));

    const filtered = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users?q=Pencari&role=EDITOR',
      token,
    });
    const ids = filtered.json<{ data: AdminUser[] }>().data.map((u) => u.id);
    expect(ids).toContain(editor.id);
    expect(ids).not.toContain(admin.id);

    // `counts` mengabaikan filter tab (`role`) tetapi tetap memakai `q`.
    const counts = filtered.json<{ meta: { counts?: Record<string, number> } }>().meta.counts;
    expect(counts?.ADMINISTRATOR).toBeGreaterThanOrEqual(1);
    expect(counts?.EDITOR).toBeGreaterThanOrEqual(1);
    await app.close();
  });

  test('sort di luar allowlist → 400 VALIDATION_FAILED', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users?sort=passwordHash',
      token,
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  test('default status=ACTIVE menyembunyikan user yang dicabut', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const revoked = await makeUser({ role: 'EDITOR', status: 'REVOKED', name: 'Sudah Dicabut' });
    const token = await loginToken(app, admin.email, admin.password);

    const active = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users?q=Sudah%20Dicabut',
      token,
    });
    expect(active.json<{ data: AdminUser[] }>().data).toHaveLength(0);

    const all = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users?q=Sudah%20Dicabut&status=REVOKED',
      token,
    });
    expect(all.json<{ data: AdminUser[] }>().data.map((u) => u.id)).toEqual([revoked.id]);
    await app.close();
  });
});

describe('GET/PATCH /v1/admin/users/:id', () => {
  test('detail 200 dengan contentCount, id tak dikenal 404', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'GET',
      url: `/v1/admin/users/${admin.id}`,
      token,
    });
    expect(res.statusCode).toBe(200);
    expect(dataOf(res)).toMatchObject({
      id: admin.id,
      email: admin.email,
      status: 'ACTIVE',
      contentCount: { articles: 0, products: 0, revisions: 0 },
    });

    const missing = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/users/00000000-0000-4000-8000-000000000000',
      token,
    });
    expect(missing.statusCode).toBe(404);
    expect(errorBody(missing).code).toBe('NOT_FOUND');
    await app.close();
  });

  test('ubah nama & peran pengguna lain', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const target = await makeUser({ role: 'CONTRIBUTOR', name: 'Nama Lama' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}`,
      token,
      payload: { name: 'Nama Baru', role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(200);
    expect(dataOf(res)).toMatchObject({ name: 'Nama Baru', role: 'EDITOR' });
    await app.close();
  });

  test('body kosong → 400 VALIDATION_FAILED', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const target = await makeUser({ role: 'EDITOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${target.id}`,
      token,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    await app.close();
  });
});

// ── Aturan anti-lockout ──────────────────────────────────────────────────────

describe('aturan "tidak boleh mengunci diri sendiri"', () => {
  test('Administrator tidak bisa mengubah perannya sendiri', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${admin.id}`,
      token,
      payload: { role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).code).toBe('BUSINESS_RULE_VIOLATION');
    expect(errorBody(res).details).toEqual({ rule: 'CANNOT_CHANGE_OWN_ROLE' });

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(unchanged.role).toBe('ADMINISTRATOR');
    await app.close();
  });

  test('UUID diri sendiri dalam huruf besar tidak melewati aturan itu', async () => {
    // Postgres membandingkan tipe uuid tanpa peduli huruf besar/kecil, jadi cek
    // diri sendiri harus memakai id hasil DB, bukan string dari path.
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${admin.id.toUpperCase()}`,
      token,
      payload: { role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CANNOT_CHANGE_OWN_ROLE' });

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(unchanged.role).toBe('ADMINISTRATOR');
    await app.close();
  });

  test('mengubah nama sendiri tetap boleh', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'PATCH',
      url: `/v1/admin/users/${admin.id}`,
      token,
      payload: { name: 'Nama Sendiri' },
    });
    expect(res.statusCode).toBe(200);
    expect(dataOf(res).name).toBe('Nama Sendiri');
    await app.close();
  });

  test('Administrator tidak bisa mencabut akses dirinya sendiri', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${admin.id}/revoke`,
      token,
    });
    expect(res.statusCode).toBe(422);
    expect(errorBody(res).details).toEqual({ rule: 'CANNOT_REVOKE_SELF' });

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(unchanged.status).toBe('ACTIVE');
    await app.close();
  });
});

// ── Cabut & aktifkan kembali ─────────────────────────────────────────────────

describe('POST /v1/admin/users/:id/revoke & /reactivate', () => {
  test('mencabut akses menghapus seluruh sesi pengguna itu', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const target = await makeUser({ role: 'EDITOR' });

    const adminToken = await loginToken(app, admin.email, admin.password);
    const targetToken = await loginToken(app, target.email, target.password);
    const targetToken2 = await loginToken(app, target.email, target.password);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(2);

    const before = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(targetToken) },
    });
    expect(before.statusCode).toBe(200);
    expect(meBody(before).id).toBe(target.id);

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${target.id}/revoke`,
      token: adminToken,
    });
    expect(res.statusCode).toBe(200);
    expect(dataOf(res)).toMatchObject({ status: 'REVOKED' });
    expect(dataOf(res).revokedAt).not.toBeNull();

    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    for (const token of [targetToken, targetToken2]) {
      const after = await app.inject({
        method: 'GET',
        url: '/v1/admin/auth/me',
        headers: { cookie: sessionCookieHeader(token) },
      });
      expect(after.statusCode).toBe(401);
      expect(errorBody(after).code).toBe('UNAUTHENTICATED');
    }

    // Login pun ditolak selama dicabut, dengan pesan login gagal biasa.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { email: target.email, password: target.password, rememberMe: false },
    });
    expect(login.statusCode).toBe(401);
    expect(errorBody(login).code).toBe('INVALID_CREDENTIALS');
    await app.close();
  });

  test('mencabut dua kali → 409 INVALID_STATE; aktifkan kembali memulihkan login', async () => {
    const app = buildTestApp();
    const admin = await makeUser({ role: 'ADMINISTRATOR' });
    const target = await makeUser({ role: 'CONTRIBUTOR' });
    const token = await loginToken(app, admin.email, admin.password);

    const first = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${target.id}/revoke`,
      token,
    });
    expect(first.statusCode).toBe(200);

    const second = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${target.id}/revoke`,
      token,
    });
    expect(second.statusCode).toBe(409);
    expect(errorBody(second).code).toBe('INVALID_STATE');

    const reactivate = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${target.id}/reactivate`,
      token,
    });
    expect(reactivate.statusCode).toBe(200);
    expect(dataOf(reactivate)).toMatchObject({ status: 'ACTIVE', revokedAt: null });

    // Kontrak §5.13: login kembali dengan kata sandi lama.
    const relogin = await loginToken(app, target.email, target.password);
    expect(relogin).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const again = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/users/${target.id}/reactivate`,
      token,
    });
    expect(again.statusCode).toBe(409);
    await app.close();
  });
});
