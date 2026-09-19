/**
 * Penanda akses + header rute `/v1/public/*` (ADR K7/A9, kontrak §1.2 dan §2.3).
 *
 * ── Mengapa ada penanda ──────────────────────────────────────────────────────
 * Rute admin wajib menyatakan `config.adminAccess` (`modules/auth/guard.ts`)
 * supaya tidak ada rute yang diam-diam terbuka. Rute publik punya risiko
 * cerminannya: ia memang **boleh** dipanggil tanpa auth (A9), jadi yang harus
 * dipastikan bukan "siapa yang boleh", melainkan bahwa setiap rute
 *
 *   1. dibatasi rate limit (§2.3) — tanpa itu satu rute publik yang lupa
 *      menyatakannya menjadi satu-satunya rute API tanpa batas apa pun, dan
 *   2. mendapat `Cache-Control` yang benar (§1.2): GET boleh di-cache edge,
 *      POST tidak pernah.
 *
 * Karena itu setiap rute di bawah `/v1/public/` wajib memakai
 * `config: publicReadAccess()` atau `publicWriteAccess("alasan")`, yang
 * membawa penanda **dan** batasnya sekaligus. Rute yang lupa **gagal saat
 * registrasi** (`MissingPublicAccessError`), bukan tayang tanpa batas.
 *
 * ── X-Internal-Key pada GET ──────────────────────────────────────────────────
 * Kontrak §1.2: GET publik **tidak** mewajibkan `X-Internal-Key`. Bila dikirim
 * dan valid (server Next), batas rate limit lebih longgar; key yang salah
 * diperlakukan seperti tanpa key (bukan `401`), agar pemanggil langsung tidak
 * bisa dibedakan perlakuannya dari pengunjung biasa.
 */

import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';

import { AppError } from '../../lib/errors.js';
import { rateLimitErrorResponse } from '../../lib/rate-limit.js';

/** Prefiks rute publik (kontrak §1.1). */
export const PUBLIC_PATH_PREFIX = '/v1/public';

/** Kontrak §1.2: GET publik boleh di-cache edge Cloudflare 60 detik. */
export const PUBLIC_GET_CACHE_CONTROL =
  'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

/** Kontrak §2.3: GET publik 1200/menit dengan key internal valid, 120/menit tanpa. */
export const PUBLIC_RATE_LIMIT_TRUSTED_MAX = 1200;
export const PUBLIC_RATE_LIMIT_ANONYMOUS_MAX = 120;
export const PUBLIC_RATE_LIMIT_WINDOW = '1 minute';

/** Penanda akses sebuah rute publik. */
export type PublicAccess =
  /** GET konten terbit; tanpa auth (A9), boleh di-cache CDN. */
  | { readonly kind: 'read' }
  /** POST publik; `X-Internal-Key` wajib, tidak pernah di-cache. */
  | { readonly kind: 'write'; readonly reason: string };

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Wajib pada setiap rute `/v1/public/*`; lihat dokumentasi modul ini. */
    publicAccess?: PublicAccess;
  }

  interface FastifyRequest {
    /** `true` bila request membawa `X-Internal-Key` yang cocok (server Next). */
    isTrustedInternalCaller: boolean;
  }
}

/**
 * Batas §2.3 dipasang lewat `config.rateLimit` saat rute didefinisikan (bukan
 * lewat hook `onRoute` modul ini), karena `@fastify/rate-limit` membaca config
 * itu di hook `onRoute`-nya sendiri yang terdaftar lebih dulu di instance akar.
 */
function publicRateLimit() {
  return {
    // Kunci memisahkan pemanggil tepercaya dari anonim, supaya kuota longgar
    // server Next tidak bisa "dipinjam" dengan mengirim key yang salah.
    keyGenerator: (request: FastifyRequest) =>
      `${request.isTrustedInternalCaller ? 'internal' : 'anon'}:${request.ip}`,
    max: (request: FastifyRequest) =>
      request.isTrustedInternalCaller
        ? PUBLIC_RATE_LIMIT_TRUSTED_MAX
        : PUBLIC_RATE_LIMIT_ANONYMOUS_MAX,
    timeWindow: PUBLIC_RATE_LIMIT_WINDOW,
    errorResponseBuilder: rateLimitErrorResponse,
  };
}

/** `config` untuk GET publik: penanda baca + rate limit §2.3. */
export const publicReadAccess = () => ({
  publicAccess: { kind: 'read' } as const satisfies PublicAccess,
  rateLimit: publicRateLimit(),
});

/** `config` untuk POST publik; `reason` wajib supaya pilihannya terbaca di review. */
export const publicWriteAccess = (reason: string) => ({
  publicAccess: { kind: 'write', reason } as const satisfies PublicAccess,
  rateLimit: publicRateLimit(),
});

export class MissingPublicAccessError extends Error {
  constructor(method: string, url: string) {
    super(
      `Rute publik ${method} ${url} tidak menyatakan config.publicAccess + rateLimit. ` +
        'Pakai config: publicReadAccess() atau publicWriteAccess("alasan").',
    );
    this.name = 'MissingPublicAccessError';
  }
}

export function isPublicPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path === PUBLIC_PATH_PREFIX || path.startsWith(`${PUBLIC_PATH_PREFIX}/`);
}

/** Perbandingan waktu konstan; panjang berbeda langsung gagal tanpa membandingkan isi. */
function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function readInternalKey(request: FastifyRequest): string | undefined {
  const header = request.headers['x-internal-key'];
  if (typeof header === 'string') return header;
  return Array.isArray(header) ? header[0] : undefined;
}

export const invalidInternalKey = () =>
  new AppError('INVALID_INTERNAL_KEY', 'Header X-Internal-Key tidak valid.');

export interface PublicGuardOptions {
  /** `INTERNAL_API_KEY`; tanpa nilai ini tidak ada pemanggil yang dianggap tepercaya. */
  internalApiKey?: string | undefined;
}

/**
 * Dipasang di instance **akar** (`buildApp`), sehingga rute `/v1/public/*` yang
 * didaftarkan di mana pun — termasuk di luar plugin publik — tetap wajib
 * menyatakan penanda dan batasnya.
 */
export function enforcePublicRouteConfig(app: FastifyInstance): void {
  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (!isPublicPath(routeOptions.url)) return;
    const config = routeOptions.config;
    if (config?.publicAccess === undefined || config.rateLimit === undefined) {
      throw new MissingPublicAccessError(
        Array.isArray(routeOptions.method) ? routeOptions.method.join('|') : routeOptions.method,
        routeOptions.url,
      );
    }
  });
}

/**
 * Memasang header cache dan flag `isTrustedInternalCaller` pada seluruh rute di
 * dalam plugin ini (enkapsulasi Fastify: hook di sini tidak bocor ke rute admin).
 */
export function registerPublicGuard(app: FastifyInstance, options: PublicGuardOptions = {}): void {
  const internalApiKey =
    options.internalApiKey === undefined || options.internalApiKey === ''
      ? undefined
      : options.internalApiKey;

  if (!app.hasRequestDecorator('isTrustedInternalCaller')) {
    app.decorateRequest('isTrustedInternalCaller', false);
  }

  app.addHook('onRequest', (request, reply, done) => {
    const key = readInternalKey(request);
    request.isTrustedInternalCaller =
      internalApiKey !== undefined && key !== undefined && secretEquals(key, internalApiKey);

    const access = request.routeOptions.config.publicAccess;
    void reply.header(
      'cache-control',
      access?.kind === 'read' ? PUBLIC_GET_CACHE_CONTROL : 'no-store',
    );

    // POST publik: key wajib (kontrak §1.2). GET tidak pernah menolak karena key.
    if (access?.kind === 'write' && !request.isTrustedInternalCaller) {
      done(invalidInternalKey());
      return;
    }
    done();
  });
}
