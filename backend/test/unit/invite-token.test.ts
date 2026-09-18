import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { NoopEmailSender, EMAIL_NOT_CONFIGURED } from '../../src/modules/email/sender.js';
import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_MS,
  inviteExpiresAt,
  isWellFormedInviteToken,
} from '../../src/modules/invites/token.js';

describe('token undangan (ADR K7)', () => {
  test('32 byte base64url, acak, dan tidak pernah berulang', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = generateInviteToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedInviteToken(token)).toBe(true);
      tokens.add(token);
    }
    expect(tokens.size).toBe(200);
  });

  test('yang disimpan adalah SHA-256 token, bukan tokennya', () => {
    const token = generateInviteToken();
    const hash = hashInviteToken(token);
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
  });

  test('bentuk token asing ditolak tanpa menyentuh database', () => {
    for (const bad of ['', 'pendek', `${generateInviteToken()}x`, '../../etc/passwd']) {
      expect(isWellFormedInviteToken(bad)).toBe(false);
    }
  });

  test('masa berlaku 72 jam', () => {
    expect(INVITE_TTL_MS).toBe(72 * 60 * 60 * 1000);
    const now = new Date('2026-09-18T00:00:00.000Z');
    expect(inviteExpiresAt(now).toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });
});

describe('NoopEmailSender', () => {
  test('melaporkan "belum terkirim" alih-alih berpura-pura sukses', async () => {
    const result = await new NoopEmailSender().sendInvite();
    expect(result).toEqual({ sentAt: null, messageId: null, error: EMAIL_NOT_CONFIGURED });
  });
});
