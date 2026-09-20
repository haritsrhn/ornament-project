/**
 * Idempotensi request tulis (kontrak API §1.8).
 *
 * Header `Idempotency-Key` wajib pada `POST /v1/public/inquiries` dan
 * `POST /v1/public/articles/:slug/comments`: Server Action membuat kunci saat
 * form dirender, jadi klik ganda, submit ganda, dan retry jaringan harus
 * menghasilkan **satu** baris dan respons yang sama persis.
 *
 * ── Penyimpanan ──────────────────────────────────────────────────────────────
 * Tabel `idempotency_record` (migrasi `20260920100000_idempotensi_submit_publik`),
 * bukan kolom di `inquiry`/`comment` dan bukan peta di memori:
 *
 * - **Bukan kolom di tabel domain**, karena penguncinya harus ada *sebelum*
 *   baris domain dibuat — indeks unik `(scope, actor, key)`-lah yang memutuskan
 *   siapa yang menang saat dua request tiba bersamaan.
 * - **Bukan memori proses** (berbeda dengan `AttemptThrottle`), karena di sini
 *   yang hilang saat restart bukan sekadar hitungan percobaan melainkan
 *   jaminan "tidak ada baris ganda", dan karena respons tersimpan harus
 *   bertahan 24 jam penuh.
 *
 * ── Alur ─────────────────────────────────────────────────────────────────────
 * 1. Buang baris kedaluwarsa untuk kunci ini (retensi 24 jam, §1.8).
 * 2. `INSERT` baris `IN_PROGRESS`. Berhasil → kita pemenangnya, jalankan handler.
 * 3. Gagal unik → baca baris yang ada:
 *    - `COMPLETED` + body sama → putar ulang respons + `Idempotent-Replayed: true`;
 *    - body berbeda (apa pun statusnya) → `422 IDEMPOTENCY_KEY_REUSED`;
 *    - `IN_PROGRESS` + body sama → `409 IDEMPOTENCY_IN_PROGRESS`.
 * 4. Handler sukses → simpan `status + body` respons.
 *    Handler gagal → **hapus** barisnya, supaya kegagalan sementara (mis. DB
 *    sedang tidak tersedia) tidak mengunci kunci itu selama 24 jam.
 */

import { createHash } from 'node:crypto';

import { AppError } from './errors.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/** Retensi respons tersimpan (kontrak §1.8: 24 jam). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Kode unik Prisma untuk pelanggaran constraint unik. */
const UNIQUE_VIOLATION = 'P2002';

export interface IdempotencyOutcome {
  statusCode: number;
  body: unknown;
}

export interface IdempotencyKeyParts {
  /** `POST /v1/public/inquiries` — memisahkan kunci yang sama antar rute. */
  scope: string;
  /** 🔒 `ipHash` pemanggil (kontrak §1.8: "actor/ipHash"). */
  actor: string;
  key: string;
}

/**
 * Sidik jari body permintaan. Dihitung dari JSON yang **sudah divalidasi**
 * (bukan byte mentah), sehingga perbedaan spasi/urutan field tidak dianggap
 * "body berbeda", sementara perbedaan nilai tetap terdeteksi.
 */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/** JSON dengan kunci objek terurut, supaya sidik jari stabil. */
function stableStringify(value: unknown): string {
  // `JSON.stringify(undefined)` menghasilkan `undefined`, bukan string.
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

export const idempotencyKeyReused = () =>
  new AppError(
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency-Key ini sudah dipakai untuk permintaan dengan isi berbeda.',
  );

export const idempotencyInProgress = () =>
  new AppError(
    'IDEMPOTENCY_IN_PROGRESS',
    'Permintaan dengan Idempotency-Key ini masih diproses. Coba lagi sebentar lagi.',
  );

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export interface IdempotencyResult extends IdempotencyOutcome {
  /** `true` bila respons datang dari simpanan (header `Idempotent-Replayed`). */
  replayed: boolean;
}

/**
 * Menjalankan `run` paling banyak sekali per `(scope, actor, key)` dalam 24 jam.
 *
 * `run` harus mengembalikan respons **lengkap** (status + body) karena itulah
 * yang disimpan dan diputar ulang apa adanya.
 */
export async function withIdempotency(
  prisma: PrismaClient,
  parts: IdempotencyKeyParts,
  body: unknown,
  run: () => Promise<IdempotencyOutcome>,
  now: Date = new Date(),
): Promise<IdempotencyResult> {
  const where = { scope: parts.scope, actor: parts.actor, key: parts.key };
  const requestHash = requestFingerprint(body);

  // Kunci yang TTL-nya sudah lewat boleh dipakai ulang seolah baru (§1.8).
  await prisma.idempotencyRecord.deleteMany({ where: { ...where, expiresAt: { lte: now } } });

  let recordId: string;
  try {
    const created = await prisma.idempotencyRecord.create({
      data: {
        ...where,
        requestHash,
        status: 'IN_PROGRESS',
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    recordId = created.id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return replay(prisma, where, requestHash);
  }

  let outcome: IdempotencyOutcome;
  try {
    outcome = await run();
  } catch (error) {
    // Kegagalan tidak boleh mengunci kunci ini selama 24 jam.
    await prisma.idempotencyRecord.deleteMany({ where: { id: recordId } });
    throw error;
  }

  await prisma.idempotencyRecord.update({
    where: { id: recordId },
    data: {
      status: 'COMPLETED',
      responseStatus: outcome.statusCode,
      responseBody: outcome.body as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { ...outcome, replayed: false };
}

/** Membaca baris yang sudah ada saat `INSERT` kalah lomba. */
async function replay(
  prisma: PrismaClient,
  where: { scope: string; actor: string; key: string },
  requestHash: string,
): Promise<IdempotencyResult> {
  const existing = await prisma.idempotencyRecord.findUnique({
    where: { scope_actor_key: where },
    select: { requestHash: true, status: true, responseStatus: true, responseBody: true },
  });

  // Barisnya hilang di antara `create` dan `findUnique` (dibersihkan proses
  // lain). Pemanggil boleh mencoba lagi; ini bukan duplikat yang terbukti.
  if (existing === null) throw idempotencyInProgress();

  // Key sama + body berbeda → 422, baik yang pertama sudah selesai maupun belum.
  if (existing.requestHash !== requestHash) throw idempotencyKeyReused();

  if (existing.status !== 'COMPLETED' || existing.responseStatus === null) {
    throw idempotencyInProgress();
  }
  return { statusCode: existing.responseStatus, body: existing.responseBody, replayed: true };
}
