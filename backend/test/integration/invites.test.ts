import { EMAIL_DOMAIN_ISSUE_CODE, type AdminInvite, type Me } from '@ornament/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { EMAIL_NOT_CONFIGURED } from '../../src/modules/email/sender.js';
import { hashInviteToken, INVITE_TTL_MS } from '../../src/modules/invites/token.js';
import { adminRequest, deleteTestInvites, loginToken } from '../helpers/admin.js';
import {
  ADMIN_ORIGIN,
  createTestUser,
  deleteTestUsers,
  errorBody,
  parseSessionCookie,
  type TestUser,
  type TestUserInput,
} from '../helpers/auth.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Alur undangan (#16, kontrak §2.2 + §5.13) terhadap database tes.
 *
 * Yang dibuktikan: token hanya tampil sekali dan hanya hash-nya yang tersimpan,
 * masa berlaku 72 jam, token sekali pakai, dan semua sebab kegagalan dijawab
 * dengan **satu** respons `404` yang sama.
 */

let prisma: PrismaClient;
const createdUserIds: string[] = [];
const createdInviteIds: string[] = [];

async function makeAdmin(input: TestUserInput = {}): Promise<TestUser> {
  const user = await createTestUser(prisma, { role: 'ADMINISTRATOR', ...input });
  createdUserIds.push(user.id);
  return user;
}

function buildTestApp(): FastifyInstance {
  return buildApp({ prisma, logger: false, adminOrigin: ADMIN_ORIGIN });
}

/** Satu pesan untuk semua sebab undangan tidak berlaku (kontrak §2.2). */
const INVITE_NOT_FOUND_MESSAGE = 'Undangan tidak ditemukan atau sudah tidak berlaku.';

function inviteEmail(): string {
  return `undangan-${Math.random().toString(36).slice(2, 10)}@ornament.id`;
}

interface InviteWithToken extends AdminInvite {
  token: string | null;
}

function inviteOf(res: LightMyRequestResponse): InviteWithToken {
  return res.json<{ data: InviteWithToken }>().data;
}

/** Membuat undangan lewat API dan mencatat id-nya untuk pembersihan. */
async function createInvite(
  app: FastifyInstance,
  token: string,
  payload: { email: string; role: string },
): Promise<InviteWithToken> {
  const res = await adminRequest(app, {
    method: 'POST',
    url: '/v1/admin/invites',
    token,
    payload,
  });
  if (res.statusCode !== 201) throw new Error(`gagal membuat undangan: ${res.body}`);
  const invite = inviteOf(res);
  createdInviteIds.push(invite.id);
  return invite;
}

beforeAll(() => {
  prisma = createTestPrisma();
});

afterAll(async () => {
  await deleteTestInvites(prisma, createdInviteIds);
  await deleteTestUsers(prisma, createdUserIds);
  await prisma.$disconnect();
});

describe('POST /v1/admin/invites', () => {
  test('201: token dikembalikan sekali, DB hanya menyimpan hash, kedaluwarsa 72 jam', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin({ name: 'Rani Undang' });
    const session = await loginToken(app, admin.email, admin.password);
    const email = inviteEmail();

    const before = Date.now();
    const invite = await createInvite(app, session, { email, role: 'EDITOR' });

    expect(invite).toMatchObject({
      email,
      role: 'EDITOR',
      status: 'PENDING',
      acceptedAt: null,
      revokedAt: null,
      invitedBy: { id: admin.id, name: 'Rani Undang' },
    });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // 72 jam (toleransi 1 menit untuk waktu eksekusi).
    const ttl = new Date(invite.expiresAt).getTime() - before;
    expect(Math.abs(ttl - INVITE_TTL_MS)).toBeLessThan(60_000);

    const row = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).toBe(hashInviteToken(invite.token ?? ''));
    expect(JSON.stringify(row)).not.toContain(invite.token);

    // Email belum ada modulnya: statusnya ditandai, bukan dipalsukan.
    expect(invite.emailSentAt).toBeNull();
    expect(invite.emailError).toBe(EMAIL_NOT_CONFIGURED);

    // Token tidak pernah muncul lagi di daftar.
    const list = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/invites',
      token: session,
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(invite.token);
    expect(list.json<{ data: AdminInvite[] }>().data.map((i) => i.id)).toContain(invite.id);
    await app.close();
  });

  test('email di luar @ornament.id ditolak 400 dengan code email_domain', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/invites',
      token: session,
      payload: { email: 'orang@gmail.com', role: 'EDITOR' },
    });

    expect(res.statusCode).toBe(400);
    const error = errorBody(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details).toEqual([
      expect.objectContaining({ path: 'email', code: EMAIL_DOMAIN_ISSUE_CODE }),
    ]);
    expect(await prisma.invite.count({ where: { email: 'orang@gmail.com' } })).toBe(0);
    await app.close();
  });

  test('email yang sudah menjadi pengguna → 409 CONFLICT', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);

    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/invites',
      token: session,
      payload: { email: admin.email, role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT');
    expect(errorBody(res).details).toEqual({ fields: ['email'] });
    await app.close();
  });

  test('undangan aktif kedua untuk email yang sama → 409 CONFLICT', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const email = inviteEmail();

    await createInvite(app, session, { email, role: 'CONTRIBUTOR' });
    const res = await adminRequest(app, {
      method: 'POST',
      url: '/v1/admin/invites',
      token: session,
      payload: { email, role: 'EDITOR' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorBody(res).code).toBe('CONFLICT');
    await app.close();
  });
});

describe('GET /v1/admin/auth/invites/:token (tanpa sesi)', () => {
  test('token sah → pratinjau; token salah → 404 dengan pesan yang sama', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin({ name: 'Pengundang' });
    const session = await loginToken(app, admin.email, admin.password);
    const email = inviteEmail();
    const invite = await createInvite(app, session, { email, role: 'CONTRIBUTOR' });

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/admin/auth/invites/${invite.token ?? ''}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ data: unknown }>().data).toEqual({
      email,
      role: 'CONTRIBUTOR',
      expiresAt: invite.expiresAt,
      invitedBy: { name: 'Pengundang' },
    });

    const salah = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/invites/token-yang-salah-sama-sekali',
    });
    expect(salah.statusCode).toBe(404);
    expect(errorBody(salah).message).toBe(INVITE_NOT_FOUND_MESSAGE);
    await app.close();
  });

  test('undangan kedaluwarsa dan dicabut sama-sama 404', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);

    const kedaluwarsa = await createInvite(app, session, {
      email: inviteEmail(),
      role: 'EDITOR',
    });
    await prisma.invite.update({
      where: { id: kedaluwarsa.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const dicabut = await createInvite(app, session, { email: inviteEmail(), role: 'EDITOR' });
    const revoke = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/invites/${dicabut.id}`,
      token: session,
    });
    expect(revoke.statusCode).toBe(200);
    expect(inviteOf(revoke).status).toBe('REVOKED');

    for (const invite of [kedaluwarsa, dicabut]) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/auth/invites/${invite.token ?? ''}`,
      });
      expect(res.statusCode).toBe(404);
      expect(errorBody(res).code).toBe('NOT_FOUND');
      // Pesannya identik untuk kedaluwarsa maupun dicabut: tidak ada sinyal
      // yang bisa dipakai membedakan keduanya dari luar.
      expect(errorBody(res).message).toBe(INVITE_NOT_FOUND_MESSAGE);
    }

    // Status turunan tampil benar di daftar.
    const list = await adminRequest(app, {
      method: 'GET',
      url: '/v1/admin/invites?status=EXPIRED',
      token: session,
    });
    expect(list.json<{ data: AdminInvite[] }>().data.map((i) => i.id)).toContain(kedaluwarsa.id);
    await app.close();
  });
});

describe('POST /v1/admin/auth/invites/accept (tanpa sesi)', () => {
  test('menerima undangan membuat akun, langsung login, dan token tidak bisa dipakai lagi', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const email = inviteEmail();
    const invite = await createInvite(app, session, { email, role: 'EDITOR' });
    const password = 'sandi-undangan-1';

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/invites/accept',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { token: invite.token, name: 'Dimas Baru', password },
    });
    expect(res.statusCode).toBe(201);

    const me = res.json<{ data: { user: Me } }>().data.user;
    expect(me).toMatchObject({ email, name: 'Dimas Baru', role: 'EDITOR' });
    createdUserIds.push(me.id);

    // Sesi 12 jam langsung aktif.
    const cookie = parseSessionCookie(res);
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/auth/me',
      headers: { cookie: `__Host-osa_session=${cookie.value}` },
    });
    expect(meRes.statusCode).toBe(200);

    // Kata sandi tersimpan sebagai argon2id, bukan teks.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row.passwordHash).not.toContain(password);

    // Bisa login dengan sandi yang baru ditetapkan.
    const token = await loginToken(app, email, password);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Sekali pakai: token yang sama ditolak 404.
    const kedua = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/invites/accept',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { token: invite.token, name: 'Orang Lain', password: 'sandi-lain-123' },
    });
    expect(kedua.statusCode).toBe(404);
    expect(errorBody(kedua).code).toBe('NOT_FOUND');

    const accepted = await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(accepted.acceptedAt).not.toBeNull();
    await app.close();
  });

  test('token kedaluwarsa ditolak 404 dan tidak membuat akun', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const email = inviteEmail();
    const invite = await createInvite(app, session, { email, role: 'EDITOR' });
    await prisma.invite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/invites/accept',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { token: invite.token, name: 'Terlambat', password: 'sandi-terlambat-1' },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    await app.close();
  });

  test('kata sandi terlalu pendek → 400 VALIDATION_FAILED', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const invite = await createInvite(app, session, { email: inviteEmail(), role: 'EDITOR' });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/auth/invites/accept',
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      payload: { token: invite.token, name: 'Pendek', password: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    await app.close();
  });

  test('batas 10 / 15 menit per IP berlaku (anti enumerasi token)', async () => {
    const app = buildTestApp();
    let terakhir = 0;
    for (let i = 0; i < 11; i += 1) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/auth/invites/token-palsu-${String(i)}`,
      });
      terakhir = res.statusCode;
      if (i < 10) expect(res.statusCode).toBe(404);
    }
    expect(terakhir).toBe(429);
    await app.close();
  });
});

describe('POST /v1/admin/invites/:id/resend & DELETE /v1/admin/invites/:id', () => {
  test('kirim ulang memberi token baru dan mematikan token lama', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const invite = await createInvite(app, session, { email: inviteEmail(), role: 'EDITOR' });

    const res = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/invites/${invite.id}/resend`,
      token: session,
    });
    expect(res.statusCode).toBe(200);
    const baru = inviteOf(res);
    expect(baru.token).not.toBe(invite.token);
    expect(new Date(baru.expiresAt).getTime()).toBeGreaterThan(
      new Date(invite.expiresAt).getTime() - 1,
    );

    const lama = await app.inject({
      method: 'GET',
      url: `/v1/admin/auth/invites/${invite.token ?? ''}`,
    });
    expect(lama.statusCode).toBe(404);

    const sekarang = await app.inject({
      method: 'GET',
      url: `/v1/admin/auth/invites/${baru.token ?? ''}`,
    });
    expect(sekarang.statusCode).toBe(200);
    await app.close();
  });

  test('mencabut dua kali → 409 INVALID_STATE', async () => {
    const app = buildTestApp();
    const admin = await makeAdmin();
    const session = await loginToken(app, admin.email, admin.password);
    const invite = await createInvite(app, session, { email: inviteEmail(), role: 'EDITOR' });

    const pertama = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/invites/${invite.id}`,
      token: session,
    });
    expect(pertama.statusCode).toBe(200);

    const kedua = await adminRequest(app, {
      method: 'DELETE',
      url: `/v1/admin/invites/${invite.id}`,
      token: session,
    });
    expect(kedua.statusCode).toBe(409);
    expect(errorBody(kedua).code).toBe('INVALID_STATE');

    const resend = await adminRequest(app, {
      method: 'POST',
      url: `/v1/admin/invites/${invite.id}/resend`,
      token: session,
    });
    expect(resend.statusCode).toBe(409);
    await app.close();
  });
});
