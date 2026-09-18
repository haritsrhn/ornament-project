/**
 * Endpoint auth admin — kontrak §2.2:
 * `POST /v1/admin/auth/login`, `POST /v1/admin/auth/logout`,
 * `GET /v1/admin/auth/me`.
 *
 * Ganti kata sandi dan undangan (§2.2 baris berikutnya) belum dibangun di PR
 * ini; keduanya sudah punya fondasinya (`revokeAllSessionsForUser`,
 * `hashPassword`) dan menyusul bersama modul pengguna (#16).
 */

import {
  loginBodySchema,
  loginResponseSchema,
  meResponseSchema,
  normalizeEmail,
  type UserRole,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError, rateLimited } from '../../lib/errors.js';
import { ok } from '../../lib/http.js';
import {
  hashPassword,
  needsRehash,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../lib/password.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.js';
import { currentSession } from './guard.js';
import { LoginThrottle } from './login-throttle.js';
import { toMe } from './me.js';
import { createSession, deleteSessionByToken } from './session.js';

/**
 * Satu pesan untuk **semua** sebab kegagalan login (#14): email tidak
 * terdaftar, domain benar tapi user `REVOKED`, atau kata sandi salah. Tidak ada
 * jalan bagi pemanggil untuk menyimpulkan apakah sebuah email punya akun.
 */
const INVALID_CREDENTIALS_MESSAGE = 'Email atau kata sandi salah.';

const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);

/** Batas per IP untuk login (kontrak §2.3): 20 percobaan / 15 menit. */
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_IP_WINDOW = '15 minutes';

/** Batas longgar untuk `logout`/`me`: jaring pengaman, bukan anti-brute-force. */
const ADMIN_IP_LIMIT = 600;
const ADMIN_IP_WINDOW = '1 minute';

export interface AuthRoutesOptions {
  /** Basis URL publik R2 untuk `Me.avatar.url` (ADR K3); belum di-set di fase ini. */
  mediaPublicUrl?: string | undefined;
  /** Injeksi untuk tes; default satu instance per registrasi plugin. */
  loginThrottle?: LoginThrottle;
}

/**
 * `errorResponseBuilder` @fastify/rate-limit **melempar** apa pun yang
 * dikembalikan fungsi ini, jadi mengembalikan `AppError` membuat 429-nya
 * melewati error handler kami dan keluar sebagai envelope kontrak §1.5
 * (`RATE_LIMITED` + `details.retryAfterSeconds` + header `Retry-After`).
 */
const rateLimitErrorResponse = (_request: unknown, context: { ttl: number }) =>
  rateLimited(Math.max(1, Math.ceil(context.ttl / 1000)));

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = (app, options) => {
  const throttle = options.loginThrottle ?? new LoginThrottle();
  const mediaPublicUrl = options.mediaPublicUrl;

  app.post(
    '/admin/auth/login',
    {
      schema: { body: loginBodySchema, response: { 200: loginResponseSchema } },
      config: {
        rateLimit: {
          max: LOGIN_IP_LIMIT,
          timeWindow: LOGIN_IP_WINDOW,
          errorResponseBuilder: rateLimitErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const { password, rememberMe } = request.body;
      // Skema sudah menormalisasi, tapi normalisasi ulang membuat kunci
      // throttle tidak bergantung pada urutan transform skema.
      const email = normalizeEmail(request.body.email);

      // Lockout per email dicek **sebelum** verifikasi: selama terkunci
      // jawabannya 429 walaupun kata sandinya benar (kontrak §2.3).
      const lockedFor = throttle.retryAfterSeconds(email);
      if (lockedFor > 0) {
        request.log.info({ code: 'RATE_LIMITED', scope: 'login-email' }, 'login terkunci');
        throw rateLimited(lockedFor);
      }

      const user = await app.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          passwordHash: true,
          lastActiveAt: true,
          avatar: { select: { id: true, key: true, alt: true, width: true, height: true } },
        },
      });

      if (user === null) {
        // Timing attack: tanpa ini, "email tidak ada" menjawab puluhan
        // milidetik lebih cepat daripada "sandi salah" dan bisa dipakai
        // meng-enumerasi akun. Verifikasi dummy menyamakan biayanya.
        await verifyAgainstDummyHash(password);
        throttle.recordFailure(email);
        throw invalidCredentials();
      }

      const { passwordHash, ...profile } = user;
      const passwordOk = await verifyPassword(passwordHash, password);
      // User `REVOKED` tetap diverifikasi sandinya supaya tidak ada perbedaan
      // waktu antara akun dicabut dan sandi salah.
      if (!passwordOk || profile.status !== 'ACTIVE') {
        throttle.recordFailure(email);
        request.log.info(
          {
            code: 'INVALID_CREDENTIALS',
            userId: profile.id,
            reason: passwordOk ? 'status' : 'password',
          },
          'login gagal',
        );
        throw invalidCredentials();
      }

      throttle.reset(email);

      // Parameter argon2id sudah dinaikkan sejak hash ini dibuat: tulis ulang
      // sekarang, saat kata sandi mentah masih ada. Gagal menulis tidak
      // membatalkan login.
      if (needsRehash(passwordHash)) {
        try {
          await app.prisma.user.update({
            where: { id: profile.id },
            data: { passwordHash: await hashPassword(password) },
            select: { id: true },
          });
        } catch (err) {
          request.log.warn({ err, userId: profile.id }, 'gagal menulis ulang hash kata sandi');
        }
      }

      const created = await createSession(app.prisma, {
        userId: profile.id,
        rememberMe,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      setSessionCookie(reply, created.token, created.maxAgeSeconds);

      const now = new Date();
      await app.prisma.user.update({
        where: { id: profile.id },
        data: { lastActiveAt: now },
        select: { id: true },
      });

      request.log.info(
        { userId: profile.id, sessionId: created.sessionId, rememberMe },
        'login berhasil',
      );
      return ok({ user: toMe({ ...profile, lastActiveAt: now }, mediaPublicUrl) });
    },
  );

  app.post(
    '/admin/auth/logout',
    {
      config: {
        rateLimit: {
          max: ADMIN_IP_LIMIT,
          timeWindow: ADMIN_IP_WINDOW,
          errorResponseBuilder: rateLimitErrorResponse,
        },
      },
    },
    async (request, reply) => {
      // Idempoten (kontrak §2.2): tanpa sesi valid tetap 204, dan cookie
      // tetap dihapus. Tidak memakai `requireSession` supaya tidak pernah 401.
      const token = readSessionCookie(request);
      if (token !== undefined) {
        const deleted = await deleteSessionByToken(app.prisma, token);
        if (deleted) request.log.info('logout: sesi dicabut');
      }
      clearSessionCookie(reply);
      return reply.code(204).send();
    },
  );

  app.get(
    '/admin/auth/me',
    {
      preHandler: app.requireSession,
      schema: { response: { 200: meResponseSchema } },
      config: {
        rateLimit: {
          max: ADMIN_IP_LIMIT,
          timeWindow: ADMIN_IP_WINDOW,
          errorResponseBuilder: rateLimitErrorResponse,
        },
      },
    },
    (request) => {
      const { user } = currentSession(request);
      return ok(toMe(user, mediaPublicUrl));
    },
  );

  return Promise.resolve();
};

/** Peran yang dianggap "boleh masuk admin" — fondasi `requireRole` untuk #15. */
export const ADMIN_ROLES: readonly UserRole[] = ['ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR'];
