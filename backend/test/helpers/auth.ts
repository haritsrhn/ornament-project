import type { ErrorBody, ErrorEnvelope, LoginResponse, Me, MeResponse } from '@ornament/shared';
import type { LightMyRequestResponse } from 'fastify';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/lib/password.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/cookie.js';

/**
 * Fixture pengguna untuk tes integrasi. Email dibuat bersufiks acak supaya dua
 * berkas tes tidak pernah bentrok di `user.email` (unik) dan supaya tes **tidak
 * bergantung pada data seed dev** — `cleanupUsers()` hanya menghapus baris yang
 * dibuatnya sendiri (sesi ikut terhapus lewat `onDelete: Cascade`).
 */

export const ADMIN_ORIGIN = 'https://admin.ornament.id';

/** Kata sandi fixture; sengaja bukan nilai yang dipakai seed. */
export const TEST_PASSWORD = 'kata-sandi-tes-1';

export interface TestUserInput {
  password?: string;
  role?: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
  status?: 'ACTIVE' | 'REVOKED';
  name?: string;
  /** Bagian lokal email; sufiks acak selalu ditambahkan. */
  localPart?: string;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export async function createTestUser(
  prisma: PrismaClient,
  input: TestUserInput = {},
): Promise<TestUser> {
  const password = input.password ?? TEST_PASSWORD;
  const suffix = Math.random().toString(36).slice(2, 10);
  const email = `${input.localPart ?? 'tes'}-${suffix}@ornament.id`;

  const user = await prisma.user.create({
    data: {
      email,
      name: input.name ?? 'Pengguna Tes',
      passwordHash: await hashPassword(password),
      role: input.role ?? 'ADMINISTRATOR',
      status: input.status ?? 'ACTIVE',
    },
    select: { id: true },
  });

  return { id: user.id, email, password };
}

/** Menghapus fixture (dan sesinya, lewat cascade). Aman dipanggil berulang. */
export async function deleteTestUsers(prisma: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Header wajib untuk non-GET admin: `Origin` yang diizinkan + JSON (ADR K7). */
export function adminPostHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { origin: ADMIN_ORIGIN, 'content-type': 'application/json', ...extra };
}

export interface ParsedCookie {
  value: string;
  attributes: Record<string, string>;
  raw: string;
}

/**
 * Mengambil cookie sesi dari `Set-Cookie`. Atribut boolean (`HttpOnly`,
 * `Secure`) disimpan sebagai string kosong sehingga keberadaannya bisa diuji
 * dengan `'httponly' in attributes`.
 */
export function parseSessionCookie(res: LightMyRequestResponse): ParsedCookie {
  const header = res.headers['set-cookie'];
  const all = Array.isArray(header) ? header : header === undefined ? [] : [header];
  const raw = all.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (raw === undefined) {
    throw new Error(`respons tidak memuat Set-Cookie ${SESSION_COOKIE_NAME}: ${String(header)}`);
  }

  const [pair, ...rest] = raw.split(';');
  const attributes: Record<string, string> = {};
  for (const part of rest) {
    const [name, ...valueParts] = part.trim().split('=');
    attributes[(name ?? '').toLowerCase()] = valueParts.join('=');
  }
  return { value: (pair ?? '').slice(SESSION_COOKIE_NAME.length + 1), attributes, raw };
}

/** Header `cookie` untuk request berikutnya. */
export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

// ── Pembaca respons bertipe ──────────────────────────────────────────────────
// `res.json()` bersifat `any`; helper ini memberi tipe kontrak supaya tes ikut
// memverifikasi bentuk respons (dan ESLint tidak perlu dikecualikan).

export function errorBody(res: LightMyRequestResponse): ErrorBody {
  return res.json<ErrorEnvelope>().error;
}

export function loginUser(res: LightMyRequestResponse): Me {
  return res.json<LoginResponse>().data.user;
}

export function meBody(res: LightMyRequestResponse): Me {
  return res.json<MeResponse>().data;
}

/** `details.retryAfterSeconds` pada `429 RATE_LIMITED` (kontrak §1.10). */
export function retryAfterSeconds(res: LightMyRequestResponse): number {
  const details = errorBody(res).details;
  if (typeof details !== 'object' || details === null) return -1;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' ? value : -1;
}
