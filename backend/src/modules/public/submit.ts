/**
 * Kerangka bersama untuk **submit publik** (`POST /v1/public/*`), yaitu tiga
 * lapis proteksi kontrak §1.8/§2.3 dan keputusan A6 yang harus berlaku sama di
 * setiap rute tulis publik:
 *
 * 1. **Identitas** — IP pengunjung diturunkan menjadi `ipHash`
 *    (`client-identity.ts`); IP mentah tidak pernah keluar dari fungsi ini.
 * 2. **Rate limit per `ipHash`** (`submit-throttle.ts`).
 * 3. **Honeypot (A6)** — field yang harus kosong. Terisi → respons **sukses
 *    palsu** tanpa menyimpan apa pun dan tanpa menyentuh idempotensi, sehingga
 *    bot tidak mendapat sinyal apa pun: bukan kode error, bukan selisih waktu
 *    yang mencurigakan, dan bukan pula kunci idempotensi yang "terpakai".
 * 4. **Idempotensi** (`lib/idempotency.ts`) — baru setelah tiga lapis di atas,
 *    karena kunci idempotensi hanya boleh dipakai oleh request yang memang
 *    akan dikerjakan.
 *
 * Urutan `401 → 400 validasi → 429/409/422` mengikuti §1.10: `X-Internal-Key`
 * sudah dicek `registerPublicGuard` di `onRequest`, dan skema Zod rute sudah
 * berjalan sebelum handler, jadi di sini yang tersisa tinggal 2–4.
 */

import { isHoneypotFilled, IDEMPOTENT_REPLAYED_HEADER } from '@ornament/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AttemptThrottle } from '../../lib/attempt-throttle.js';
import { withIdempotency, type IdempotencyOutcome } from '../../lib/idempotency.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { readClientIdentity, type ClientIdentity } from './client-identity.js';
import { enforceSubmitThrottles } from './submit-throttle.js';

export interface PublicSubmitOptions<TBody> {
  prisma: PrismaClient;
  request: FastifyRequest;
  reply: FastifyReply;
  /** `POST /v1/public/inquiries` — ruang nama kunci idempotensi (§1.8). */
  scope: string;
  /** Rahasia untuk `ipHash`; `INTERNAL_API_KEY` (lihat `client-identity.ts`). */
  ipHashSecret: string;
  throttles: readonly AttemptThrottle[];
  /** Body yang **sudah** divalidasi skema rute. */
  body: TBody;
  /** Nilai honeypot dari body (A6). */
  honeypot: string | undefined;
  /** Respons sukses palsu saat honeypot terisi; tidak menyimpan apa pun. */
  fakeSuccess: () => IdempotencyOutcome;
  /** Pekerjaan sebenarnya; dijalankan paling banyak sekali per kunci. */
  run: (identity: ClientIdentity) => Promise<IdempotencyOutcome>;
}

/**
 * Menjalankan satu submit publik dan **mengirim** responsnya lewat `reply`.
 *
 * Responsnya dikirim di sini (bukan dikembalikan ke Fastify) karena status
 * suksesnya ikut disimpan dan diputar ulang oleh idempotensi: `201`/`202` asli
 * dan replay-nya harus keluar persis sama, lengkap dengan header
 * `Idempotent-Replayed`.
 */
export async function handlePublicSubmit<TBody>(
  options: PublicSubmitOptions<TBody>,
): Promise<void> {
  const { request, reply } = options;
  const identity = readClientIdentity(request, options.ipHashSecret);

  enforceSubmitThrottles(options.throttles, identity.ipHash);

  if (isHoneypotFilled(options.honeypot)) {
    // Dicatat supaya efektivitas honeypot terlihat di log; tanpa isi body.
    request.log.info({ scope: options.scope }, 'submit publik ditolak honeypot');
    const fake = options.fakeSuccess();
    await reply.code(fake.statusCode).send(fake.body);
    return;
  }

  const key = readIdempotencyKey(request);
  const outcome = await withIdempotency(
    options.prisma,
    { scope: options.scope, actor: identity.ipHash, key },
    options.body,
    () => options.run(identity),
  );

  if (outcome.replayed) void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'true');
  await reply.code(outcome.statusCode).send(outcome.body);
}

/**
 * Nilai `Idempotency-Key`. Keberadaan dan panjangnya sudah dijamin
 * `idempotencyHeadersSchema` di `schema.headers` rute, jadi di sini tidak ada
 * jalur "tanpa kunci" yang bisa diam-diam melewati penguncian.
 */
function readIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  /* c8 ignore next */
  throw new Error('Idempotency-Key tidak tervalidasi di schema.headers rute ini.');
}
