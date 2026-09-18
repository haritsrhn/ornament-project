import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { PASSWORD_CHANGE_LIMIT } from '../../src/modules/auth/login-throttle.js';
import { adminRequest, loginToken } from '../helpers/admin.js';
import {
  ADMIN_ORIGIN,
  createTestUser,
  deleteTestUsers,
  errorBody,
  sessionCookieHeader,
  type TestUser,
  type TestUserInput,
} from '../helpers/auth.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * `POST /v1/admin/auth/password` (kontrak §2.2): verifikasi sandi lama, hash
 * baru argon2id, **semua sesi lain dicabut** dan sesi pemanggil bertahan.
 */

let prisma: PrismaClient;
const createdUserIds: string[] = [];

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
  await deleteTestUsers(prisma, createdUserIds);
  await prisma.$disconnect();
});

function me(app: FastifyInstance, token: string) {
  return app.inject({
    method: 'GET',
    url: '/v1/admin/auth/me',
    headers: { cookie: sessionCookieHeader(token) },
  });
}

describe('POST /v1/admin/auth/password', () => {
  test('sukses: 204, sesi lain dicabut, sesi sendiri bertahan, sandi baru berlaku', async () => {
    const app = buildTestApp();
    const user = await makeUser({ role: 'EDITOR' });

    const sesiIni = await loginToken(app, user.email, user.password);
    const sesiLain = await loginToken(app, user.email, user.password);
    const sesiKetiga = await loginToken(app, user.email, user.password);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3);

    const baru = 'sandi-baru-yang-kuat-1';
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/auth/password',
      token: sesiIni,
      payload: { currentPassword: user.password, newPassword: baru },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    // Sesi pemanggil bertahan …
    expect((await me(app, sesiIni)).statusCode).toBe(200);
    // … sesi lain mati.
    for (const token of [sesiLain, sesiKetiga]) {
      const after = await me(app, token);
      expect(after.statusCode).toBe(401);
      expect(errorBody(after).code).toBe('UNAUTHENTICATED');
    }
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);

    // Hash baru argon2id, bukan sandi mentah.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(baru);

    // Sandi lama tidak berlaku lagi, sandi baru berlaku.
    const loginLama = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/login',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { email: user.email, password: user.password, rememberMe: false },
    });
    expect(loginLama.statusCode).toBe(401);
    await expect(loginToken(app, user.email, baru)).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
    await app.close();
  });

  test('sandi lama salah → 401 INVALID_CREDENTIALS dan tidak ada yang berubah', async () => {
    const app = buildTestApp();
    const user = await makeUser({ role: 'CONTRIBUTOR' });
    const sesiIni = await loginToken(app, user.email, user.password);
    const sesiLain = await loginToken(app, user.email, user.password);
    const sebelum = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/auth/password',
      token: sesiIni,
      payload: { currentPassword: 'jelas-bukan-sandinya', newPassword: 'sandi-baru-1234' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');

    const sesudah = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(sesudah.passwordHash).toBe(sebelum.passwordHash);
    // Sesi lain tidak ikut tercabut karena gagal.
    expect((await me(app, sesiLain)).statusCode).toBe(200);
    await app.close();
  });

  test('tanpa sesi → 401 UNAUTHENTICATED sebelum validasi body', async () => {
    const app = buildTestApp();
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/auth/password',
      payload: { currentPassword: 'x', newPassword: 'y' },
    });
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  test('semua peran boleh mengganti sandinya sendiri', async () => {
    const app = buildTestApp();
    for (const role of ['ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR'] as const) {
      const user = await makeUser({ role });
      const token = await loginToken(app, user.email, user.password);
      const res = await adminRequest(app, {
        method: 'POST',
        url: '/v1/admin/auth/password',
        token,
        payload: { currentPassword: user.password, newPassword: `sandi-${role.toLowerCase()}-1` },
      });
      expect(res.statusCode, role).toBe(204);
    }
    await app.close();
  });

  test(`batas ${String(PASSWORD_CHANGE_LIMIT)} percobaan / 15 menit per pengguna`, async () => {
    const app = buildTestApp();
    const user = await makeUser({ role: 'EDITOR' });
    const token = await loginToken(app, user.email, user.password);

    const attempt = () =>
      adminRequest(app, {
        method: 'POST',
        url: '/v1/admin/auth/password',
        token,
        payload: { currentPassword: 'salah-terus', newPassword: 'sandi-baru-1234' },
      });

    for (let i = 0; i < PASSWORD_CHANGE_LIMIT; i += 1) {
      expect((await attempt()).statusCode).toBe(401);
    }
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(errorBody(limited).code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    await app.close();
  });
});
