/**
 * Service sesi admin (ADR K7, kontrak §2.1, model domain §3.1 `Session`).
 *
 * Token acak 32 byte hanya pernah ada di cookie klien; database menyimpan
 * **SHA-256**-nya. Akibatnya dump database tidak bisa dipakai membajak sesi,
 * dan pencarian sesi tetap satu lookup indeks unik.
 *
 * SHA-256 tanpa salt/KDF disengaja: token sudah 256 bit acak dari CSPRNG, jadi
 * tidak ada ruang tebakan untuk brute force — berbeda dari kata sandi, yang
 * memakai argon2id (`src/lib/password.ts`).
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { PrismaClient, Session, User } from '../../generated/prisma/client.js';

/** Panjang token mentah sebelum dikodekan base64url. */
export const SESSION_TOKEN_BYTES = 32;

/** 32 byte base64url = 43 karakter tanpa padding. */
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface SessionTtl {
  /** Jendela idle: umur cookie dan `expiresAt` awal, diperpanjang tiap request. */
  idleMs: number;
  /** Batas atas mutlak (`absoluteExpiresAt`); sliding refresh tidak boleh melewatinya. */
  absoluteMs: number;
}

/**
 * Masa berlaku sesi (kontrak §2.1).
 *
 * `idleMs` = 12 jam / 30 hari sesuai radio "Ingat saya" di layar login.
 * `absoluteMs` adalah batas yang ADR K7 minta untuk sliding refresh: tanpa itu
 * satu cookie yang dipakai terus-menerus akan berlaku selamanya. Dipilih ~14×
 * jendela idle (7 hari / 90 hari) sehingga pengguna aktif tidak terganggu
 * setiap hari, tetapi sesi pasti berakhir dan harus login ulang.
 */
export const SESSION_TTL: SessionTtl = { idleMs: 12 * HOUR_MS, absoluteMs: 7 * DAY_MS };
export const REMEMBER_ME_TTL: SessionTtl = { idleMs: 30 * DAY_MS, absoluteMs: 90 * DAY_MS };

export function sessionTtl(rememberMe: boolean): SessionTtl {
  return rememberMe ? REMEMBER_ME_TTL : SESSION_TTL;
}

/**
 * "Ingat saya" tidak disimpan sebagai kolom tersendiri (model domain §3.1 tidak
 * memilikinya): ia dibaca kembali dari **rentang mutlak** sesi, yaitu
 * `absoluteExpiresAt - createdAt`, yang di-set sekali saat login dan tidak
 * pernah berubah (7 hari vs 90 hari). Batas pemisah diambil di tengah kedua
 * nilai itu, jadi jitter beberapa milidetik tidak pernah mengubah kesimpulan.
 *
 * Alternatif yang ditolak: menurunkan jendela idle dari `expiresAt - lastSeenAt`
 * (salah begitu `expiresAt` mentok di batas mutlak, karena jendelanya akan
 * menyusut di setiap refresh berikutnya) dan menambah kolom `remember_me`
 * (migrasi + drift dari dokumen model domain tanpa informasi baru).
 */
const REMEMBER_ME_ABSOLUTE_THRESHOLD_MS = (SESSION_TTL.absoluteMs + REMEMBER_ME_TTL.absoluteMs) / 2;

export function isRememberMeSession(session: {
  createdAt: Date;
  absoluteExpiresAt: Date;
}): boolean {
  return (
    session.absoluteExpiresAt.getTime() - session.createdAt.getTime() >
    REMEMBER_ME_ABSOLUTE_THRESHOLD_MS
  );
}

/**
 * Sliding refresh dibatasi 1×/menit (kontrak §2.1): satu `UPDATE` per menit per
 * sesi, bukan per request, sehingga halaman admin yang memanggil banyak
 * endpoint sekaligus tidak menulis berulang kali.
 */
export const SESSION_TOUCH_INTERVAL_MS = MINUTE_MS;

/** Token acak untuk cookie. Hanya nilai ini yang bisa membuka sesi. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Menolak cookie yang bentuknya tidak mungkin token kami tanpa menyentuh DB. */
export function isWellFormedSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

/**
 * Perbandingan hash token dengan waktu konstan. Dipakai di jalur yang sudah
 * memegang dua hash (mis. verifikasi sesi saat ini vs sesi lain); pencarian
 * utama tetap lewat indeks unik `token_hash`.
 */
export function sessionTokenHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `User` + avatar yang dibutuhkan DTO `Me`; sengaja bukan tipe Prisma penuh. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  status: User['status'];
  lastActiveAt: Date | null;
  avatar: {
    id: string;
    key: string;
    alt: string | null;
    width: number | null;
    height: number | null;
  } | null;
}

export interface AuthSession {
  session: Pick<
    Session,
    'id' | 'userId' | 'expiresAt' | 'absoluteExpiresAt' | 'lastSeenAt' | 'createdAt'
  >;
  user: SessionUser;
}

const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  lastActiveAt: true,
  avatar: { select: { id: true, key: true, alt: true, width: true, height: true } },
} as const;

export interface CreateSessionInput {
  userId: string;
  rememberMe: boolean;
  userAgent?: string | undefined;
  ip?: string | undefined;
  now?: Date;
}

export interface CreatedSession {
  /** Token mentah — satu-satunya tempat ia ada. Kirim ke cookie, jangan di-log. */
  token: string;
  sessionId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  /** `Max-Age` cookie dalam detik. */
  maxAgeSeconds: number;
}

export async function createSession(
  prisma: PrismaClient,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const now = input.now ?? new Date();
  const ttl = sessionTtl(input.rememberMe);
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + ttl.idleMs);
  const absoluteExpiresAt = new Date(now.getTime() + ttl.absoluteMs);

  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      absoluteExpiresAt,
      lastSeenAt: now,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    },
    select: { id: true },
  });

  return {
    token,
    sessionId: session.id,
    expiresAt,
    absoluteExpiresAt,
    maxAgeSeconds: Math.floor(ttl.idleMs / 1000),
  };
}

/**
 * Mencari sesi dari token cookie dan memvalidasinya:
 * kedaluwarsa idle (`expiresAt`), batas mutlak (`absoluteExpiresAt`), dan status
 * user. Sesi yang tidak sah dihapus supaya tidak menumpuk, lalu `null`.
 */
export async function resolveSession(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<AuthSession | null> {
  if (!isWellFormedSessionToken(token)) return null;

  const found = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      lastSeenAt: true,
      createdAt: true,
      user: { select: sessionUserSelect },
    },
  });
  if (!found) return null;

  const { user, ...session } = found;
  const expired = session.expiresAt <= now || session.absoluteExpiresAt <= now;
  if (expired || user.status !== 'ACTIVE') {
    // Sesi mati atau akses dicabut: buang jejaknya. Untuk user `REVOKED`,
    // semua sesinya dibuang sekaligus (ADR K7: penonaktifan menghapus sesi).
    if (user.status === 'ACTIVE') {
      await prisma.session.deleteMany({ where: { id: session.id } });
    } else {
      await revokeAllSessionsForUser(prisma, user.id);
    }
    return null;
  }

  return { session, user };
}

export interface TouchedSession {
  expiresAt: Date;
  maxAgeSeconds: number;
}

/**
 * Sliding refresh: memperpanjang `expiresAt` (dibatasi `absoluteExpiresAt`) dan
 * menyegarkan `lastSeenAt` + `User.lastActiveAt`. Mengembalikan `null` bila
 * belum waktunya (kurang dari `SESSION_TOUCH_INTERVAL_MS` sejak `lastSeenAt`),
 * sehingga pemanggil tahu kapan perlu mengirim ulang cookie.
 */
export async function touchSession(
  prisma: PrismaClient,
  authSession: AuthSession,
  now: Date = new Date(),
): Promise<TouchedSession | null> {
  const { session } = authSession;
  if (now.getTime() - session.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return null;

  const ttl = sessionTtl(isRememberMeSession(session));
  const proposed = new Date(now.getTime() + ttl.idleMs);
  const expiresAt = proposed > session.absoluteExpiresAt ? session.absoluteExpiresAt : proposed;

  await prisma.$transaction([
    prisma.session.update({
      where: { id: session.id },
      data: { expiresAt, lastSeenAt: now },
      select: { id: true },
    }),
    prisma.user.update({
      where: { id: session.userId },
      data: { lastActiveAt: now },
      select: { id: true },
    }),
  ]);

  return {
    expiresAt,
    maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Logout: menghapus **satu** sesi. Idempoten — token tak dikenal → `false`. */
export async function deleteSessionByToken(prisma: PrismaClient, token: string): Promise<boolean> {
  if (!isWellFormedSessionToken(token)) return false;
  const { count } = await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
  return count > 0;
}

/**
 * Mencabut semua sesi seorang user (ADR K7: ganti kata sandi, penonaktifan,
 * "cabut akses"). `exceptSessionId` dipakai oleh ganti kata sandi, yang
 * mempertahankan sesi pemanggil (kontrak §2.2).
 */
export async function revokeAllSessionsForUser(
  prisma: PrismaClient,
  userId: string,
  options: { exceptSessionId?: string } = {},
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: {
      userId,
      ...(options.exceptSessionId === undefined ? {} : { id: { not: options.exceptSessionId } }),
    },
  });
  return count;
}

/** Sesi yang sudah kedaluwarsa, untuk job pembersih nanti. */
export async function deleteExpiredSessions(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] },
  });
  return count;
}
