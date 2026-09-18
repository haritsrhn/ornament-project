/**
 * Endpoint auth admin — kontrak §2.2:
 * `POST /v1/admin/auth/login`, `POST /v1/admin/auth/logout`,
 * `GET /v1/admin/auth/me`, `POST /v1/admin/auth/password`,
 * `GET /v1/admin/auth/invites/:token`, `POST /v1/admin/auth/invites/accept`.
 *
 * Empat rute pertama menyangkut sesi pemanggil sendiri, dua terakhir adalah
 * pintu masuk undangan **tanpa sesi** (pembuatan undangan ada di
 * `modules/invites/routes.ts`). Setiap rute menyatakan aksesnya lewat
 * `config.adminAccess`; lihat `guard.ts`.
 */

import {
  acceptInviteBodySchema,
  acceptInviteResponseSchema,
  changePasswordBodySchema,
  invitePreviewResponseSchema,
  inviteTokenParamsSchema,
  loginBodySchema,
  loginResponseSchema,
  meResponseSchema,
  normalizeEmail,
  type UserRole,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError, conflict, notFound, rateLimited } from '../../lib/errors.js';
import { ok } from '../../lib/http.js';
import {
  hashPassword,
  needsRehash,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../lib/password.js';
import { adminRateLimit, invitePublicRateLimit, rateLimitConfig } from '../../lib/rate-limit.js';
import { findUsableInvite } from '../invites/service.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookie.js';
import { adminPublic, adminSession, currentSession } from './guard.js';
import { LoginThrottle, PasswordChangeThrottle } from './login-throttle.js';
import { toMe } from './me.js';
import { createSession, deleteSessionByToken, revokeAllSessionsForUser } from './session.js';

/**
 * Satu pesan untuk **semua** sebab kegagalan login (#14): email tidak
 * terdaftar, domain benar tapi user `REVOKED`, atau kata sandi salah. Tidak ada
 * jalan bagi pemanggil untuk menyimpulkan apakah sebuah email punya akun.
 */
const INVALID_CREDENTIALS_MESSAGE = 'Email atau kata sandi salah.';

const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);

/**
 * Satu respons untuk semua sebab undangan tidak bisa dipakai: token salah,
 * kedaluwarsa, dicabut, atau sudah diterima (kontrak §2.2). Endpoint ini tanpa
 * sesi, jadi pesannya tidak boleh membocorkan apakah sebuah undangan pernah ada.
 */
const inviteNotFound = () => notFound('Undangan tidak ditemukan atau sudah tidak berlaku.');

/** Batas per IP untuk login (kontrak §2.3): 20 percobaan / 15 menit. */
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_IP_WINDOW = '15 minutes';

export interface AuthRoutesOptions {
  /** Basis URL publik R2 untuk `Me.avatar.url` (ADR K3); belum di-set di fase ini. */
  mediaPublicUrl?: string | undefined;
  /** Injeksi untuk tes; default satu instance per registrasi plugin. */
  loginThrottle?: LoginThrottle;
  passwordThrottle?: PasswordChangeThrottle;
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = (app, options) => {
  const throttle = options.loginThrottle ?? new LoginThrottle();
  const passwordThrottle = options.passwordThrottle ?? new PasswordChangeThrottle();
  const mediaPublicUrl = options.mediaPublicUrl;

  app.post(
    '/admin/auth/login',
    {
      schema: { body: loginBodySchema, response: { 200: loginResponseSchema } },
      config: {
        adminAccess: adminPublic('login: justru rute yang membuat sesi'),
        ...rateLimitConfig(LOGIN_IP_LIMIT, LOGIN_IP_WINDOW),
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
        adminAccess: adminPublic('logout idempoten: tanpa sesi valid pun menjawab 204'),
        ...adminRateLimit(),
      },
    },
    async (request, reply) => {
      // Idempoten (kontrak §2.2): tanpa sesi valid tetap 204, dan cookie
      // tetap dihapus. Tidak memakai guard sesi supaya tidak pernah 401.
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
      schema: { response: { 200: meResponseSchema } },
      config: { adminAccess: adminSession(), ...adminRateLimit() },
    },
    (request) => {
      const { user } = currentSession(request);
      return ok(toMe(user, mediaPublicUrl));
    },
  );

  app.post(
    '/admin/auth/password',
    {
      schema: { body: changePasswordBodySchema },
      config: { adminAccess: adminSession(), ...adminRateLimit() },
    },
    async (request, reply) => {
      const { session, user } = currentSession(request);
      const { currentPassword, newPassword } = request.body;

      // Batas per **user** (kontrak §2.3: 5 / 15 menit); batas per IP sudah
      // ditangani `adminRateLimit()`.
      const lockedFor = passwordThrottle.retryAfterSeconds(user.id);
      if (lockedFor > 0) {
        request.log.info({ code: 'RATE_LIMITED', scope: 'password', userId: user.id }, 'terkunci');
        throw rateLimited(lockedFor);
      }
      passwordThrottle.record(user.id);

      const row = await app.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!(await verifyPassword(row.passwordHash, currentPassword))) {
        request.log.info({ code: 'INVALID_CREDENTIALS', userId: user.id }, 'sandi lama salah');
        // Kode yang sama dengan login gagal (kontrak §2.2), bukan
        // `UNAUTHENTICATED`, supaya admin tidak ikut logout di klien.
        throw new AppError('INVALID_CREDENTIALS', 'Kata sandi saat ini salah.');
      }

      const passwordHash = await hashPassword(newPassword);
      await app.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
        select: { id: true },
      });

      // ADR K7: ganti sandi mencabut semua sesi **lain**; sesi pemanggil tetap
      // hidup supaya ia tidak terlempar keluar dari halaman yang sedang dibuka.
      const revoked = await revokeAllSessionsForUser(app.prisma, user.id, {
        exceptSessionId: session.id,
      });
      request.log.info({ userId: user.id, revokedSessions: revoked }, 'kata sandi diganti');

      return reply.code(204).send();
    },
  );

  // ── Undangan tanpa sesi (kontrak §2.2) ─────────────────────────────────────

  app.get(
    '/admin/auth/invites/:token',
    {
      schema: {
        params: inviteTokenParamsSchema,
        response: { 200: invitePreviewResponseSchema },
      },
      config: {
        adminAccess: adminPublic('pratinjau undangan: penerima belum punya akun'),
        ...invitePublicRateLimit(),
      },
    },
    async (request) => {
      const invite = await findUsableInvite(app.prisma, request.params.token);
      if (invite === null) throw inviteNotFound();
      return ok({
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
        invitedBy: { name: invite.invitedBy.name },
      });
    },
  );

  app.post(
    '/admin/auth/invites/accept',
    {
      schema: { body: acceptInviteBodySchema, response: { 201: acceptInviteResponseSchema } },
      config: {
        adminAccess: adminPublic('terima undangan: justru rute yang membuat akun'),
        ...invitePublicRateLimit(),
      },
    },
    async (request, reply) => {
      const { token, name, password } = request.body;
      const now = new Date();

      const invite = await findUsableInvite(app.prisma, token, now);
      if (invite === null) throw inviteNotFound();

      // Hash dulu (argon2id ~85 ms) supaya transaksi di bawah sesingkat mungkin.
      const passwordHash = await hashPassword(password);

      const created = await app.prisma.$transaction(async (tx) => {
        // Sekali pakai: `updateMany` dengan syarat "belum diterima, belum
        // dicabut, belum kedaluwarsa" mengunci baris undangan. Dua request
        // bersamaan dengan token yang sama → hanya satu yang mendapat
        // `count === 1`.
        const claimed = await tx.invite.updateMany({
          where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { acceptedAt: now },
        });
        if (claimed.count === 0) throw inviteNotFound();

        const existing = await tx.user.findUnique({
          where: { email: invite.email },
          select: { id: true },
        });
        if (existing !== null) {
          // Kontrak §2.2: email sudah menjadi User → 409 CONFLICT. Transaksi
          // di-rollback, jadi undangan tidak ikut tertandai diterima.
          throw conflict(['email'], 'Email ini sudah menjadi pengguna.');
        }

        return tx.user.create({
          data: {
            email: invite.email,
            name,
            passwordHash,
            role: invite.role,
            status: 'ACTIVE',
            lastActiveAt: now,
          },
          select: { id: true, email: true, name: true, role: true, status: true },
        });
      });

      // Sesi 12 jam (kontrak §2.2: penerimaan undangan langsung login, tanpa
      // opsi "Ingat saya").
      const session = await createSession(app.prisma, {
        userId: created.id,
        rememberMe: false,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      setSessionCookie(reply, session.token, session.maxAgeSeconds);

      request.log.info(
        { userId: created.id, inviteId: invite.id, sessionId: session.sessionId },
        'undangan diterima',
      );
      return reply.code(201).send(
        ok({
          user: toMe({ ...created, lastActiveAt: now, avatar: null }, mediaPublicUrl),
        }),
      );
    },
  );

  return Promise.resolve();
};

/** Peran yang dianggap "boleh masuk admin". */
export const ADMIN_ROLES: readonly UserRole[] = ['ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR'];
