/**
 * Batas submit publik per `ipHash` (kontrak §2.3).
 *
 * | Rute | Batas |
 * | --- | --- |
 * | `POST /public/inquiries` | 5 / jam **dan** 20 / hari |
 * | `POST /public/inquiry-uploads` | 15 / jam |
 * | `POST /public/articles/:slug/comments` | 5 / 10 menit **dan** 30 / hari |
 *
 * ── Mengapa bukan `@fastify/rate-limit` ──────────────────────────────────────
 * Dua alasan, keduanya mengikat:
 *
 * 1. **Kuncinya `ipHash`, bukan IP koneksi.** Pemanggil rute ini selalu server
 *    Next, jadi `request.ip` sama untuk semua pengunjung; IP pengunjung baru
 *    diketahui setelah `X-Client-Ip` diverifikasi (`client-identity.ts`).
 * 2. **Dua jendela sekaligus.** Batas "5 / jam **dan** 20 / hari" tidak bisa
 *    dinyatakan sebagai satu `max` + satu `timeWindow`; jendela pendek menahan
 *    banjir, jendela panjang menahan penetesan pelan sepanjang hari.
 *
 * `AttemptThrottle` (`lib/attempt-throttle.ts`) sudah menyediakan persis itu,
 * dengan batasan yang sama seperti store bawaan rate limit: **state per proses**,
 * hilang saat restart, dan berlipat bila API di-scale-out. Lihat catatan di
 * `attempt-throttle.ts` untuk kapan ini harus pindah ke store bersama.
 *
 * Jaring pengaman per IP koneksi tetap ada dari `publicWriteAccess()`, jadi
 * pemanggil yang tidak membawa `ipHash` masuk akal pun tetap dibatasi.
 */

import { AttemptThrottle } from '../../lib/attempt-throttle.js';
import { rateLimited } from '../../lib/errors.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Parameter kontrak §2.3; dipisah agar tes bisa memakai jendela pendek. */
export const SUBMIT_LIMITS = {
  inquiryBurst: { limit: 5, windowMs: HOUR },
  inquiryDaily: { limit: 20, windowMs: DAY },
  uploadBurst: { limit: 15, windowMs: HOUR },
  commentBurst: { limit: 5, windowMs: 10 * MINUTE },
  commentDaily: { limit: 30, windowMs: DAY },
} as const;

export type SubmitLimitName = keyof typeof SUBMIT_LIMITS;

export type PublicSubmitThrottles = Record<SubmitLimitName, AttemptThrottle>;

export type SubmitLimitOverrides = Partial<
  Record<SubmitLimitName, { limit: number; windowMs: number }>
>;

/** Satu set throttle per instance app (seperti `LoginThrottle`), supaya tes terisolasi. */
export function createPublicSubmitThrottles(
  overrides: SubmitLimitOverrides = {},
): PublicSubmitThrottles {
  const names = Object.keys(SUBMIT_LIMITS) as SubmitLimitName[];
  return Object.fromEntries(
    names.map((name) => [name, new AttemptThrottle(overrides[name] ?? SUBMIT_LIMITS[name])]),
  ) as PublicSubmitThrottles;
}

/**
 * Memeriksa **semua** jendela lebih dulu, baru mencatat percobaan pada semua
 * jendela. Urutan itu penting: mencatat sambil memeriksa akan membuat request
 * yang sudah ditolak jendela pendek ikut menghabiskan kuota harian.
 *
 * `Retry-After` memakai sisa waktu **terlama**, sehingga klien yang patuh tidak
 * kembali terlalu cepat dan langsung kena jendela yang lain.
 */
export function enforceSubmitThrottles(
  throttles: readonly AttemptThrottle[],
  key: string,
  now: Date = new Date(),
): void {
  const at = now.getTime();
  const retryAfter = Math.max(0, ...throttles.map((t) => t.retryAfterSeconds(key, at)));
  if (retryAfter > 0) throw rateLimited(retryAfter);
  for (const throttle of throttles) throttle.record(key, at);
}
