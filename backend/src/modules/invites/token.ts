/**
 * Token undangan (ADR K7: "token sekali pakai, hash di DB, kedaluwarsa 72 jam").
 *
 * Sama persis dengan token sesi (`modules/auth/session.ts`): 32 byte dari
 * CSPRNG, dikodekan base64url, dan **hanya SHA-256-nya** yang masuk kolom
 * `invite.token_hash`. Dump database karena itu tidak bisa dipakai menerima
 * undangan orang lain, dan pencarian tetap satu lookup indeks unik.
 *
 * SHA-256 tanpa KDF disengaja: nilainya 256 bit acak, jadi tidak ada ruang
 * tebakan — berbeda dari kata sandi (argon2id, `lib/password.ts`).
 */

import { createHash, randomBytes } from 'node:crypto';

import { INVITE_TOKEN_BYTES, INVITE_TOKEN_PATTERN } from '@ornament/shared';

const HOUR_MS = 60 * 60 * 1000;

/** Masa berlaku undangan: 72 jam (ADR K7, kontrak §5.13). */
export const INVITE_TTL_MS = 72 * HOUR_MS;

export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Menolak token yang bentuknya tidak mungkin milik kami tanpa menyentuh DB. */
export function isWellFormedInviteToken(token: string): boolean {
  return INVITE_TOKEN_PATTERN.test(token);
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}
