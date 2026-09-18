import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify, { LogController, type FastifyInstance } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { EmailSender } from './modules/email/sender.js';
import { registerAuthGuard } from './modules/auth/guard.js';
import type { LoginThrottle, PasswordChangeThrottle } from './modules/auth/login-throttle.js';
import { authRoutes } from './modules/auth/routes.js';
import { invitesRoutes } from './modules/invites/routes.js';
import { usersRoutes } from './modules/users/routes.js';
import { registerAdminOrigin } from './plugins/admin-origin.js';
import { registerErrorHandling } from './plugins/error-handler.js';
import {
  buildLoggerOptions,
  genReqId,
  registerRequestId,
  type LoggerOption,
} from './plugins/logger.js';
import { registerPrisma } from './plugins/prisma.js';
import { registerValidation } from './plugins/validation.js';
import { healthRoutes } from './routes/health.js';

/** Batas body JSON (kontrak §1.10: `413 PAYLOAD_TOO_LARGE` untuk body > 1 MB). */
export const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Jumlah kunci rate limit yang disimpan di memori per rute (LRU bawaan
 * `@fastify/rate-limit`). Cukup untuk ribuan IP tanpa membebani heap.
 */
export const RATE_LIMIT_CACHE_ENTRIES = 10_000;

export interface BuildAppOptions {
  /** Config hasil `loadEnv()`. Bila ada, `app.prisma` dibuat dari `config.DATABASE_URL`. */
  config?: Env;
  /** Client Prisma siap pakai (mis. tes ke `ornament_test`); menang atas `config`. */
  prisma?: PrismaClient;
  /** Override logger Fastify; default dari `config` (level, redaksi, pretty di dev). */
  logger?: LoggerOption;
  /**
   * Origin admin untuk CORS + guard CSRF (ADR K7). Default `config.ADMIN_ORIGIN`;
   * dipisah agar tes bisa mengatur origin tanpa membangun seluruh `Env`.
   */
  adminOrigin?: string | undefined;
  /**
   * Lockout login (#14). Default: instance baru per app dengan parameter
   * kontrak §2.3. Tes memakai jendela pendek supaya "pulih setelah jendela
   * lewat" bisa dibuktikan tanpa menunggu 15 menit.
   */
  loginThrottle?: LoginThrottle;
  /** Batas ganti kata sandi per user (#16); default parameter kontrak §2.3. */
  passwordThrottle?: PasswordChangeThrottle;
  /**
   * Pengirim email undangan (ADR K4). Default `NoopEmailSender`: modul Resend
   * baru dibangun di tahap berikutnya, jadi undangan tersimpan dan statusnya
   * ditandai "belum terkirim" alih-alih berpura-pura sukses.
   */
  emailSender?: EmailSender;
}

/**
 * Membangun instance Fastify tanpa memanggil `listen`, supaya bisa dipakai
 * ulang oleh server maupun tes (`app.inject`).
 *
 * Urutan: infrastruktur (validasi, request ID, error handler) → cookie & rate
 * limit → CORS/guard Origin → dekorator (`prisma`, guard sesi) → rute. Tanpa
 * `config` maupun `prisma`, app dibangun tanpa database: semua rute tetap
 * terdaftar, readiness menjawab 503.
 */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? buildLoggerOptions(config),
    genReqId,
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
    // `request.ip` dipakai sebagai kunci rate limit dan disimpan di `Session.ip`.
    // Header `X-Forwarded-For` hanya dipercaya bila API memang di belakang
    // proxy/CDN yang menulisnya; di fase ini tidak, jadi tetap IP koneksi.
    trustProxy: false,
  });

  registerValidation(app);
  registerRequestId(app);
  registerErrorHandling(app);

  // Cookie sesi (ADR K7). Tanpa `secret`: cookie sesi tidak ditandatangani,
  // keabsahannya dibuktikan lewat lookup SHA-256 di tabel `Session`.
  void app.register(fastifyCookie);

  // Rate limit (kontrak §2.3). `global: false` — hanya rute yang memasang
  // `config.rateLimit` yang dibatasi, sehingga health check tetap bebas.
  //
  // Store: **in-memory** bawaan plugin (tanpa Redis; ADR K7 sengaja tidak
  // menambah infrastruktur). Konsekuensinya sama dengan lockout login: batas
  // berlaku per proses, jadi bila API di-scale-out batas efektifnya menjadi
  // `max × jumlah instance` dan hilang saat restart. Cukup untuk satu proses
  // hidup lama (ADR K8); saat scale-out, pasang `redis` di opsi ini.
  void app.register(fastifyRateLimit, {
    global: false,
    cache: RATE_LIMIT_CACHE_ENTRIES,
    // Header `RateLimit-*` (kontrak §1.2) memakai nama draft IETF.
    enableDraftSpec: true,
    // Store gagal tidak boleh membuka pintu: tetap batasi, jangan lewati.
    skipOnError: false,
  });

  registerAdminOrigin(app, { adminOrigin: options.adminOrigin ?? config?.ADMIN_ORIGIN });

  if (options.prisma) {
    registerPrisma(app, { client: options.prisma });
  } else if (config) {
    registerPrisma(app, { databaseUrl: config.DATABASE_URL });
  }

  registerAuthGuard(app);

  void app.register(healthRoutes, { prefix: '/v1' });
  const mediaPublicUrl =
    config?.R2_PUBLIC_URL === undefined ? {} : { mediaPublicUrl: config.R2_PUBLIC_URL };

  void app.register(authRoutes, {
    prefix: '/v1',
    ...mediaPublicUrl,
    ...(options.loginThrottle === undefined ? {} : { loginThrottle: options.loginThrottle }),
    ...(options.passwordThrottle === undefined
      ? {}
      : { passwordThrottle: options.passwordThrottle }),
  });
  void app.register(usersRoutes, { prefix: '/v1', ...mediaPublicUrl });
  void app.register(invitesRoutes, {
    prefix: '/v1',
    ...(options.emailSender === undefined ? {} : { emailSender: options.emailSender }),
  });

  return app;
}
