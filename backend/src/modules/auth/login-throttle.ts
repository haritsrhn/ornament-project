/**
 * Lockout login per email (#14, kontrak §2.3: "5 gagal / 15 menit, reset saat
 * sukses, respons tetap 429 walau sandi benar selama terkunci").
 *
 * Mekanismenya generik dan dipakai bersama ganti kata sandi; lihat
 * `src/lib/attempt-throttle.ts` untuk alasan "di memori, bukan di database"
 * beserta batasannya saat scale-out.
 */

import { AttemptThrottle, type AttemptThrottleOptions } from '../../lib/attempt-throttle.js';

/** Jumlah kegagalan dalam satu jendela sebelum email terkunci (kontrak §2.3). */
export const LOGIN_FAILURE_LIMIT = 5;

/** Panjang jendela hitungan sekaligus lama terkunci (kontrak §2.3: 15 menit). */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Batas entri yang disimpan; melindungi memori dari banjir email acak. */
export const LOGIN_THROTTLE_MAX_ENTRIES = 10_000;

export type LoginThrottleOptions = Partial<AttemptThrottleOptions>;

export class LoginThrottle extends AttemptThrottle {
  constructor(options: LoginThrottleOptions = {}) {
    super({
      limit: options.limit ?? LOGIN_FAILURE_LIMIT,
      windowMs: options.windowMs ?? LOGIN_FAILURE_WINDOW_MS,
      maxEntries: options.maxEntries ?? LOGIN_THROTTLE_MAX_ENTRIES,
    });
  }

  /** Alias yang menyebut hal yang dihitung di login: percobaan yang **gagal**. */
  recordFailure(key: string, now: number = Date.now()): number {
    return this.record(key, now);
  }
}

/** Batas ganti kata sandi (kontrak §2.3: 5 / 15 menit per user, semua percobaan). */
export const PASSWORD_CHANGE_LIMIT = 5;
export const PASSWORD_CHANGE_WINDOW_MS = 15 * 60 * 1000;

export class PasswordChangeThrottle extends AttemptThrottle {
  constructor(options: LoginThrottleOptions = {}) {
    super({
      limit: options.limit ?? PASSWORD_CHANGE_LIMIT,
      windowMs: options.windowMs ?? PASSWORD_CHANGE_WINDOW_MS,
      maxEntries: options.maxEntries ?? LOGIN_THROTTLE_MAX_ENTRIES,
    });
  }
}
