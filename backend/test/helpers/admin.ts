import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { adminPostHeaders, ADMIN_ORIGIN, parseSessionCookie, sessionCookieHeader } from './auth.js';

/**
 * Helper request admin untuk tes integrasi #15/#16: login sungguhan lewat
 * `/v1/admin/auth/login` (bukan menyuntik baris `Session` langsung), lalu
 * memakai cookie hasilnya seperti browser admin.
 */

export async function loginToken(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/admin/auth/login',
    headers: adminPostHeaders(),
    payload: { email, password, rememberMe: false },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login fixture gagal (${String(res.statusCode)}): ${res.body}`);
  }
  return parseSessionCookie(res).value;
}

export interface AdminRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  /** Token sesi; tanpa ini request dikirim tanpa cookie (untuk menguji 401). */
  token?: string | undefined;
  payload?: unknown;
}

export function adminRequest(
  app: FastifyInstance,
  { method, url, token, payload }: AdminRequest,
): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {
    origin: ADMIN_ORIGIN,
    // `Content-Type` hanya dikirim bila memang ada body — aksi tanpa body
    // (mis. `/revoke`) juga tidak mengirimnya dari browser, dan body JSON
    // kosong ditolak `400 BAD_REQUEST`.
    ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    ...(token === undefined ? {} : { cookie: sessionCookieHeader(token) }),
  };
  return app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/**
 * Menghapus undangan fixture. Relasi `Invite.invitedById` memakai `Restrict`,
 * jadi ini harus dijalankan **sebelum** pengguna pembuatnya dihapus.
 */
export async function deleteTestInvites(prisma: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.invite.deleteMany({ where: { id: { in: ids } } });
}
