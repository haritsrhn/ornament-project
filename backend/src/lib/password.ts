/**
 * Hash kata sandi **argon2id** (ADR K7, model domain §3.1 `User.passwordHash`).
 *
 * Implementasi: `@node-rs/argon2` — binding NAPI ke crate `argon2` Rust yang
 * mengirim prebuilt binary per platform, jadi tidak ada kompilasi native di
 * mesin dev maupun di image deploy (keputusan pemilik).
 *
 * ── Parameter biaya (2026) ───────────────────────────────────────────────────
 * `m = 65536` KiB (64 MiB), `t = 3` iterasi, `p = 1` lane, keluaran 32 byte,
 * salt 16 byte acak (dibuat pustaka per hash). Kira-kira 3× lipat dari batas
 * bawah OWASP (m=19456, t=2, p=1) dan masih di bawah 150 ms per hash pada
 * mesin kelas laptop — cukup untuk login admin yang jarang terjadi, dan mahal
 * untuk penyerang yang menebak jutaan kali.
 *
 * `p = 1` disengaja: proses API adalah Node single-threaded dan hash dijalankan
 * di threadpool libuv; menaikkan `p` tidak memberi keuntungan keamanan yang
 * sebanding dan memperbesar kemungkinan starvation saat beberapa login
 * bersamaan. Menaikkan biaya nanti tidak memutus hash lama: `needsRehash()`
 * menandai hash berparameter lama supaya bisa ditulis ulang saat login berikut.
 */

import { hash, parseOptions, verify, type Algorithm, type Version } from '@node-rs/argon2';

/**
 * `Algorithm` dan `Version` adalah *ambient const enum* di typing
 * `@node-rs/argon2`; `verbatimModuleSyntax` melarang membacanya sebagai nilai,
 * jadi anggotanya ditulis sebagai angka literal (persis nilai di typing itu).
 */
const ARGON2ID = 2 as Algorithm;
const ARGON2_VERSION_19 = 1 as Version;

/** Parameter biaya yang dipakai untuk hash **baru**. */
export const PASSWORD_HASH_PARAMS = {
  algorithm: ARGON2ID,
  version: ARGON2_VERSION_19,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Hash argon2id (PHC string, mis. `$argon2id$v=19$m=65536,t=3,p=1$…`). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_PARAMS);
}

/**
 * Memverifikasi kata sandi terhadap hash tersimpan. Parameter biaya dibaca dari
 * hash itu sendiri, jadi hash lama tetap bisa diverifikasi.
 *
 * Hash yang rusak/bukan encoding argon2 (mis. penanda seed lama) mengembalikan
 * `false`, bukan melempar: pemanggil memperlakukannya sama dengan sandi salah.
 */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/**
 * `true` bila hash memakai parameter di bawah kebijakan sekarang (atau bukan
 * argon2id v19 sama sekali) sehingga sebaiknya ditulis ulang. Dipakai setelah
 * verifikasi **berhasil**, saat kata sandi mentah masih ada di memori.
 *
 * Parameter yang lebih *kuat* dari kebijakan tidak dianggap usang — menurunkan
 * biaya hash yang sudah ada tidak masuk akal.
 */
export function needsRehash(hashed: string): boolean {
  let parsed;
  try {
    parsed = parseOptions(hashed);
  } catch {
    // Bukan hash argon2 yang sah: tidak ada yang bisa diselamatkan, tetapi
    // menandainya "usang" tetap benar (verifikasi terhadapnya selalu gagal).
    return true;
  }
  return (
    parsed.algorithm !== PASSWORD_HASH_PARAMS.algorithm ||
    parsed.version !== PASSWORD_HASH_PARAMS.version ||
    parsed.memoryCost < PASSWORD_HASH_PARAMS.memoryCost ||
    parsed.timeCost < PASSWORD_HASH_PARAMS.timeCost ||
    parsed.outputLen < PASSWORD_HASH_PARAMS.outputLen
  );
}

/**
 * Hash dummy untuk melawan timing attack pada login: bila email tidak
 * terdaftar, endpoint tetap memverifikasi kata sandi terhadap hash ini agar
 * durasi respons "email tidak ada" dan "sandi salah" tidak bisa dibedakan.
 *
 * Kata sandinya adalah 32 byte acak dari proses ini, jadi tidak ada sandi nyata
 * yang pernah cocok. Dibuat malas dan hanya sekali: biayanya sama dengan satu
 * hash biasa.
 */
let dummyHashPromise: Promise<string> | undefined;

export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
  );
  return dummyHashPromise;
}

/** Membakar waktu verifikasi yang setara satu login gagal. Hasil selalu diabaikan. */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  await verifyPassword(await dummyPasswordHash(), password);
}
