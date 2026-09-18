import { permissionsForRole } from '@ornament/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/cookie.js';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.js';
import { hashSessionToken, REMEMBER_ME_TTL, SESSION_TTL } from '../../src/modules/auth/session.js';
import {
  ADMIN_ORIGIN,
  adminPostHeaders,
  createTestUser,
  deleteTestUsers,
  parseSessionCookie,
  sessionCookieHeader,
  errorBody,
  loginUser,
  meBody,
  retryAfterSeconds,
  TEST_PASSWORD,
  type TestUser,
  type TestUserInput,
} from '../helpers/auth.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Auth admin terhadap database tes nyata (`ornament_test`).
 *
 * Berkas ini membuat fixture-nya sendiri (email bersufiks acak) dan
 * menghapusnya di `afterAll`; ia tidak membaca satu pun baris seed, jadi hasil
 * tes tidak bergantung pada apakah `npm run db:seed` pernah dijalankan.
 */

let prisma: PrismaClient;
const createdUserIds: string[] = [];

async function makeUser(input: TestUserInput = {}): Promise<TestUser> {
  const user = await createTestUser(prisma, input);
  createdUserIds.push(user.id);
  return user;
}

function buildAuthApp(options: { loginThrottle?: LoginThrottle } = {}) {
  return buildApp({
    prisma,
    logger: false,
    adminOrigin: ADMIN_ORIGIN,
    ...(options.loginThrottle === undefined ? {} : { loginThrottle: options.loginThrottle }),
  });
}

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await deleteTestUsers(prisma, createdUserIds);
  await prisma.$disconnect();
});

async function login(
  app: ReturnType<typeof buildAuthApp>,
  email: string,
  password: string,
  rememberMe = false,
) {
  return app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    headers: adminPostHeaders(),
    payload: { email, password, rememberMe },
  });
}

describe('POST /v1/admin/auth/login', () => {
  test('sukses: 200 + Me + cookie sesi beratribut lengkap, hash tersimpan di DB', async () => {
    const app = buildAuthApp();
    const user = await makeUser({ role: 'EDITOR', name: 'Sekar Ayu' });

    const res = await login(app, user.email, user.password);
    expect(res.statusCode).toBe(200);

    const me = loginUser(res);
    expect(me).toMatchObject({
      id: user.id,
      email: user.email,
      name: 'Sekar Ayu',
      role: 'EDITOR',
      avatar: null,
    });
    expect(me.permissions).toEqual(permissionsForRole('EDITOR'));
    // DTO tidak boleh membocorkan kolom internal.
    expect(Object.keys(me)).not.toContain('passwordHash');
    expect(res.body).not.toContain(user.password);

    const cookie = parseSessionCookie(res);
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.attributes).toHaveProperty('httponly');
    expect(cookie.attributes).toHaveProperty('secure');
    expect(cookie.attributes.samesite).toBe('Strict');
    expect(cookie.attributes.path).toBe('/');
    // Prefiks `__Host-` melarang atribut Domain.
    expect(cookie.attributes).not.toHaveProperty('domain');
    expect(Number(cookie.attributes['max-age'])).toBe(SESSION_TTL.idleMs / 1000);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    // Hanya hash yang disimpan; token mentah tidak ada di baris mana pun.
    expect(session?.tokenHash).toBe(hashSessionToken(cookie.value));
    expect(JSON.stringify(session)).not.toContain(cookie.value);
    expect(session?.userAgent).toBeDefined();

    const stored = await prisma.session.findFirst({ where: { tokenHash: cookie.value } });
    expect(stored).toBeNull();

    // `lastActiveAt` ikut terisi (model domain §3.1).
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.lastActiveAt).not.toBeNull();
  });

  test('"Ingat saya" memperpanjang cookie ke 30 hari dan batas mutlak ke 90 hari', async () => {
    const app = buildAuthApp();
    const user = await makeUser();

    const res = await login(app, user.email, user.password, true);
    expect(res.statusCode).toBe(200);

    const cookie = parseSessionCookie(res);
    expect(Number(cookie.attributes['max-age'])).toBe(REMEMBER_ME_TTL.idleMs / 1000);

    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const idleMs = session.expiresAt.getTime() - session.createdAt.getTime();
    const absoluteMs = session.absoluteExpiresAt.getTime() - session.createdAt.getTime();
    expect(idleMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(absoluteMs).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
  });

  test('sandi salah, email tak terdaftar, dan user REVOKED → respons identik', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const revoked = await makeUser({ status: 'REVOKED' });

    const wrongPassword = await login(app, user.email, 'sandi-yang-salah-1');
    const unknownEmail = await login(app, 'tidak-ada-sama-sekali@ornament.id', TEST_PASSWORD);
    const revokedUser = await login(app, revoked.email, revoked.password);

    for (const res of [wrongPassword, unknownEmail, revokedUser]) {
      expect(res.statusCode).toBe(401);
      expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');
      expect(errorBody(res).message).toBe('Email atau kata sandi salah.');
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    // Tidak ada perbedaan selain requestId yang memang unik per request.
    const withoutRequestId = (res: typeof wrongPassword) => {
      const error = errorBody(res);
      return { code: error.code, message: error.message, details: error.details };
    };
    expect(withoutRequestId(unknownEmail)).toEqual(withoutRequestId(wrongPassword));
    expect(withoutRequestId(revokedUser)).toEqual(withoutRequestId(wrongPassword));

    // Tidak ada sesi yang terbentuk untuk siapa pun.
    expect(await prisma.session.count({ where: { userId: { in: [user.id, revoked.id] } } })).toBe(
      0,
    );
  });

  test('email di luar @ornament.id ditolak sebelum menyentuh database', async () => {
    const app = buildAuthApp();
    const res = await login(app, 'orang@gmail.com', TEST_PASSWORD);
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    expect(errorBody(res).details).toEqual([
      { path: 'email', code: 'email_domain', message: 'Gunakan email @ornament.id.' },
    ]);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('email diperlakukan case-insensitive (kolom citext)', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const res = await login(app, user.email.toUpperCase(), user.password);
    expect(res.statusCode).toBe(200);
  });

  test('hash usang (penanda seed lama) ditolak tanpa melempar 500', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: 'seed-only$no-login$bukan-hash-argon2id-yang-sah' },
    });

    const res = await login(app, user.email, user.password);
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /v1/admin/auth/me', () => {
  test('sesi valid membuka rute terproteksi', async () => {
    const app = buildAuthApp();
    const user = await makeUser({ role: 'CONTRIBUTOR' });
    const cookie = parseSessionCookie(await login(app, user.email, user.password));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(200);
    expect(meBody(res)).toMatchObject({ id: user.id, role: 'CONTRIBUTOR' });
    expect(meBody(res).permissions).toEqual(permissionsForRole('CONTRIBUTOR'));
  });

  test('tanpa cookie → 401 envelope kontrak', async () => {
    const app = buildAuthApp();
    const res = await app.inject({ method: 'GET', url: '/v1/admin/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sesi tidak ada atau sudah berakhir.',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  test('cookie rusak → 401 + cookie penghapus, tanpa membuat sesi', async () => {
    const app = buildAuthApp();
    for (const value of ['bukan-token', '', 'a'.repeat(43), `${'a'.repeat(42)}+`]) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/auth/me',
        headers: { cookie: sessionCookieHeader(value) },
      });
      expect(res.statusCode, value).toBe(401);
      expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    }
    // Token berbentuk sah tapi tak dikenal juga dapat cookie penghapus.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader('b'.repeat(43)) },
    });
    expect(String(res.headers['set-cookie'])).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });

  test('sesi kedaluwarsa ditolak dan barisnya dibersihkan', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));

    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  test('batas mutlak berlaku walau expiresAt masih jauh', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));

    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(401);
  });

  test('user dinonaktifkan setelah login → 401 dan semua sesinya dicabut', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const first = parseSessionCookie(await login(app, user.email, user.password));
    const second = parseSessionCookie(await login(app, user.email, user.password));
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(first.value) },
    });
    expect(res.statusCode).toBe(401);
    expect(errorBody(res).code).toBe('UNAUTHENTICATED');
    // Bukan hanya sesi yang dipakai: semua sesi user ikut hilang (ADR K7).
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    const withSecond = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(second.value) },
    });
    expect(withSecond.statusCode).toBe(401);
  });

  test('sliding expiry memperbarui lastSeenAt/expiresAt dan menyegarkan cookie', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));
    const before = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    // Request kedua dalam menit yang sama: tidak menulis apa pun.
    const quick = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(quick.statusCode).toBe(200);
    expect(quick.headers['set-cookie']).toBeUndefined();
    const unchanged = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(unchanged.lastSeenAt.getTime()).toBe(before.lastSeenAt.getTime());

    // Mundurkan lastSeenAt 2 menit → request berikutnya memperpanjang sesi.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.session.update({
      where: { id: before.id },
      data: { lastSeenAt: twoMinutesAgo, expiresAt: new Date(Date.now() + 60 * 1000) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.session.findFirstOrThrow({ where: { id: before.id } });
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(twoMinutesAgo.getTime());
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60 * 60 * 1000);
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(after.absoluteExpiresAt.getTime());

    // Cookie ikut disegarkan dengan token yang **sama** (bukan rotasi).
    const refreshed = parseSessionCookie(res);
    expect(refreshed.value).toBe(cookie.value);
    expect(Number(refreshed.attributes['max-age'])).toBeGreaterThan(11 * 60 * 60);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.lastActiveAt?.getTime()).toBeGreaterThan(twoMinutesAgo.getTime());
  });

  test('sliding refresh tidak pernah melewati batas mutlak', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    const absoluteExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.session.update({
      where: { id: session.id },
      data: { absoluteExpiresAt, lastSeenAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.session.findFirstOrThrow({ where: { id: session.id } });
    expect(after.expiresAt.getTime()).toBe(absoluteExpiresAt.getTime());
  });
});

describe('POST /v1/admin/auth/logout', () => {
  test('mencabut sesi: 204, cookie dihapus, dan cookie lama tidak bisa dipakai lagi', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));

    // Logout tidak ber-body, jadi `Content-Type` tidak dikirim (kontrak §1.2
    // mewajibkannya hanya untuk non-GET **yang ber-body**).
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: { origin: ADMIN_ORIGIN, cookie: sessionCookieHeader(cookie.value) },
    });
    expect(res.statusCode).toBe(204);

    const cleared = parseSessionCookie(res);
    expect(cleared.value).toBe('');
    expect(Number(cleared.attributes['max-age'])).toBe(0);
    expect(cleared.attributes).toHaveProperty('httponly');
    expect(cleared.attributes).toHaveProperty('secure');

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    const reuse = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(cookie.value) },
    });
    expect(reuse.statusCode).toBe(401);
  });

  test('idempoten: tanpa sesi valid tetap 204', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: { origin: ADMIN_ORIGIN },
    });
    expect(res.statusCode).toBe(204);
  });

  test('body JSON kosong (`{}`) juga diterima', async () => {
    const app = buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: adminPostHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(204);
  });

  test('logout hanya mencabut sesi ini, bukan perangkat lain', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const first = parseSessionCookie(await login(app, user.email, user.password));
    const second = parseSessionCookie(await login(app, user.email, user.password));

    await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: { origin: ADMIN_ORIGIN, cookie: sessionCookieHeader(first.value) },
    });

    const stillValid = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: sessionCookieHeader(second.value) },
    });
    expect(stillValid.statusCode).toBe(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  test('logout dari origin asing ditolak 403 dan sesi tetap hidup', async () => {
    const app = buildAuthApp();
    const user = await makeUser();
    const cookie = parseSessionCookie(await login(app, user.email, user.password));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/logout',
      headers: {
        origin: 'https://penyerang.example',
        cookie: sessionCookieHeader(cookie.value),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(errorBody(res).code).toBe('ORIGIN_NOT_ALLOWED');
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('rate limit & lockout login (#14, kontrak §2.3)', () => {
  test('lockout per email: 429 + Retry-After setelah 5 gagal, walau sandi benar', async () => {
    const throttle = new LoginThrottle({ windowMs: 60_000 });
    const app = buildAuthApp({ loginThrottle: throttle });
    const user = await makeUser();

    for (let i = 0; i < 5; i += 1) {
      const res = await login(app, user.email, 'sandi-salah-1');
      expect(res.statusCode, `percobaan ${String(i + 1)}`).toBe(401);
    }

    // Sandi BENAR, tapi email sedang terkunci → tetap 429 (kontrak §2.3).
    const locked = await login(app, user.email, user.password);
    expect(locked.statusCode).toBe(429);
    const error = errorBody(locked);
    expect(error.code).toBe('RATE_LIMITED');
    // Pesan tidak menyebut email/akun sama sekali.
    expect(error.message).toBe('Terlalu banyak permintaan. Coba lagi nanti.');
    expect(retryAfterSeconds(locked)).toBeGreaterThan(0);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(locked.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);

    // Email lain tidak terkena imbasnya.
    const other = await makeUser();
    expect((await login(app, other.email, other.password)).statusCode).toBe(200);
  });

  test('lockout pulih setelah jendelanya lewat', async () => {
    const throttle = new LoginThrottle({ windowMs: 700 });
    const app = buildAuthApp({ loginThrottle: throttle });
    const user = await makeUser();

    for (let i = 0; i < 5; i += 1) await login(app, user.email, 'sandi-salah-1');
    expect((await login(app, user.email, user.password)).statusCode).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 800));

    const after = await login(app, user.email, user.password);
    expect(after.statusCode).toBe(200);
    expect(parseSessionCookie(after).value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('login sukses mereset hitungan kegagalan', async () => {
    const throttle = new LoginThrottle({ windowMs: 60_000 });
    const app = buildAuthApp({ loginThrottle: throttle });
    const user = await makeUser();

    for (let i = 0; i < 4; i += 1) await login(app, user.email, 'sandi-salah-1');
    expect((await login(app, user.email, user.password)).statusCode).toBe(200);

    // Hitungan kembali nol: empat kegagalan lagi masih 401, bukan 429.
    for (let i = 0; i < 4; i += 1) {
      expect((await login(app, user.email, 'sandi-salah-1')).statusCode).toBe(401);
    }
  });

  test('batas per IP: percobaan ke-21 → 429 walau setiap email berbeda', async () => {
    // Jendela lockout email dibuat 1 ms supaya tidak ikut memicu 429; yang
    // diuji di sini murni batas per IP dari @fastify/rate-limit.
    const app = buildAuthApp({ loginThrottle: new LoginThrottle({ windowMs: 1 }) });

    for (let i = 0; i < 20; i += 1) {
      const res = await login(app, `tidak-ada-${String(i)}@ornament.id`, TEST_PASSWORD);
      expect(res.statusCode, `percobaan ${String(i + 1)}`).toBe(401);
    }

    const blocked = await login(app, 'tidak-ada-21@ornament.id', TEST_PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(errorBody(blocked).code).toBe('RATE_LIMITED');
    expect(retryAfterSeconds(blocked)).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Header draft IETF (kontrak §1.2).
    expect(blocked.headers['ratelimit-limit']).toBe('20');
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });
});
