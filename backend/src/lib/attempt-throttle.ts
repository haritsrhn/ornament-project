/**
 * Penghitung percobaan berjendela tetap, di memori proses.
 *
 * Dipakai untuk batas yang **tidak** bisa dikunci per IP oleh
 * `@fastify/rate-limit`, yaitu batas per identitas yang baru diketahui di dalam
 * handler: email pada login (kontrak §2.3: 5 gagal / 15 menit) dan userId pada
 * ganti kata sandi (5 / 15 menit).
 *
 * ── Mengapa di memori, bukan di database ─────────────────────────────────────
 * Sama dengan store bawaan `@fastify/rate-limit` yang sudah dipakai untuk batas
 * per IP, jadi keduanya punya sifat (dan batasan) identik; tidak butuh kolom
 * baru maupun migrasi; dan tidak ada tulisan ke DB di jalur yang justru sedang
 * dibanjiri. Percobaan gagal juga bukan jejak audit yang harus diretensi.
 *
 * **Batasannya, dan kapan harus diganti:** state ini per proses. Begitu API
 * berjalan lebih dari satu instance, batas efektif menjadi `batas × jumlah
 * instance` dan hilang setiap restart/deploy. ADR K8 mengasumsikan satu proses
 * hidup lama; saat scale-out, pindahkan ke store bersama (tabel PostgreSQL
 * lewat migrasi baru, atau Redis bila sudah ada).
 */

interface Attempt {
  count: number;
  /** Awal jendela; entri kedaluwarsa pada `windowStartedAt + windowMs`. */
  windowStartedAt: number;
}

export interface AttemptThrottleOptions {
  limit: number;
  windowMs: number;
  /** Batas entri yang disimpan; melindungi memori dari banjir kunci acak. */
  maxEntries?: number;
}

/** Default batas entri untuk semua throttle. */
export const THROTTLE_MAX_ENTRIES = 10_000;

export class AttemptThrottle {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxEntries: number;
  private readonly attempts = new Map<string, Attempt>();

  constructor(options: AttemptThrottleOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxEntries = options.maxEntries ?? THROTTLE_MAX_ENTRIES;
  }

  /**
   * Sisa waktu terkunci dalam detik, atau `0` bila kunci boleh mencoba.
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
    if (attempt.count < this.limit) return 0;
    return Math.max(1, Math.ceil((endsAt - now) / 1000));
  }

  isLocked(key: string, now: number = Date.now()): boolean {
    return this.retryAfterSeconds(key, now) > 0;
  }

  /** Mencatat satu percobaan; mengembalikan jumlah percobaan dalam jendela ini. */
  record(key: string, now: number = Date.now()): number {
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.windowStartedAt + this.windowMs <= now) {
      this.evictIfFull(now);
      this.attempts.set(key, { count: 1, windowStartedAt: now });
      return 1;
    }
    attempt.count += 1;
    return attempt.count;
  }

  /** Membuang hitungan sebuah kunci (mis. login sukses). */
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
