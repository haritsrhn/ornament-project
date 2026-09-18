/**
 * Lockout login per email (#14, kontrak §2.3: "5 gagal / 15 menit, reset saat
 * sukses, respons tetap 429 walau sandi benar selama terkunci").
 *
 * ── Mengapa di memori, bukan di database ─────────────────────────────────────
 * Batas per IP ditangani `@fastify/rate-limit` dengan store in-memory bawaannya;
 * counter per email memakai mekanisme yang sama supaya keduanya punya sifat
 * (dan batasan) yang identik. Alasan lain:
 * - Tidak butuh kolom baru maupun migrasi, jadi model domain §3.1 tetap apa
 *   adanya, dan tidak ada tulisan ke DB pada jalur yang justru sedang dibanjiri.
 * - Percobaan login yang gagal **tidak** menjadi data yang harus disimpan/
 *   diretensi (state ini murni operasional, bukan jejak audit).
 *
 * **Batasannya, dan kapan harus diganti:** state ini per proses. Begitu API
 * berjalan lebih dari satu instance, batas efektif menjadi `5 × jumlah instance`
 * per email dan hilang setiap restart/deploy. ADR K8 mengasumsikan satu proses
 * hidup lama, jadi hari ini aman; saat scale-out (atau saat lockout perlu
 * terlihat di admin), pindahkan ke store bersama — tabel PostgreSQL
 * `login_attempt` lewat migrasi baru, atau Redis bila sudah ada.
 */

/** Jumlah kegagalan dalam satu jendela sebelum email terkunci (kontrak §2.3). */
export const LOGIN_FAILURE_LIMIT = 5;

/** Panjang jendela hitungan sekaligus lama terkunci (kontrak §2.3: 15 menit). */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Batas entri yang disimpan; melindungi memori dari banjir email acak. */
export const LOGIN_THROTTLE_MAX_ENTRIES = 10_000;

interface Attempt {
  failures: number;
  /** Awal jendela; entri kedaluwarsa pada `windowStartedAt + windowMs`. */
  windowStartedAt: number;
}

export interface LoginThrottleOptions {
  limit?: number;
  windowMs?: number;
  maxEntries?: number;
}

export class LoginThrottle {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxEntries: number;
  private readonly attempts = new Map<string, Attempt>();

  constructor(options: LoginThrottleOptions = {}) {
    this.limit = options.limit ?? LOGIN_FAILURE_LIMIT;
    this.windowMs = options.windowMs ?? LOGIN_FAILURE_WINDOW_MS;
    this.maxEntries = options.maxEntries ?? LOGIN_THROTTLE_MAX_ENTRIES;
  }

  /**
   * Sisa waktu terkunci dalam detik, atau `0` bila email boleh mencoba.
   * Selalu dibulatkan ke atas agar `Retry-After` tidak pernah 0 saat terkunci.
   */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt) return 0;

    const endsAt = attempt.windowStartedAt + this.windowMs;
    if (endsAt <= now) {
      this.attempts.delete(key);
      return 0;
    }
    if (attempt.failures < this.limit) return 0;
    return Math.max(1, Math.ceil((endsAt - now) / 1000));
  }

  isLocked(key: string, now: number = Date.now()): boolean {
    return this.retryAfterSeconds(key, now) > 0;
  }

  /** Mencatat satu kegagalan; mengembalikan jumlah kegagalan dalam jendela ini. */
  recordFailure(key: string, now: number = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.windowStartedAt + this.windowMs <= now) {
      this.evictIfFull(now);
      this.attempts.set(key, { failures: 1, windowStartedAt: now });
      return 1;
    }
    attempt.failures += 1;
    return attempt.failures;
  }

  /** Login sukses → hitungan dibuang (kontrak §2.3: "Reset saat sukses"). */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Untuk tes dan shutdown. */
  clear(): void {
    this.attempts.clear();
  }

  get size(): number {
    return this.attempts.size;
  }

  /**
   * Membuang entri kedaluwarsa bila peta sudah penuh; kalau semuanya masih
   * aktif, entri terlama yang dibuang (`Map` menjaga urutan penyisipan).
   */
  private evictIfFull(now: number): void {
    if (this.attempts.size < this.maxEntries) return;
    for (const [key, attempt] of this.attempts) {
      if (attempt.windowStartedAt + this.windowMs <= now) this.attempts.delete(key);
    }
    while (this.attempts.size >= this.maxEntries) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) break;
      this.attempts.delete(oldest.value);
    }
  }
}
