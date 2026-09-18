/**
 * Service undangan (kontrak §2.2 + §5.13, ADR K7).
 *
 * Aturan yang dijaga di satu tempat:
 * - token hanya dicari lewat **hash**-nya (`token_hash`, indeks unik);
 * - undangan hanya bisa dipakai bila belum diterima, belum dicabut, dan belum
 *   kedaluwarsa — ketiganya dijawab dengan **satu** hasil `null`, supaya
 *   endpoint tanpa sesi tidak bisa membedakan "token salah", "kedaluwarsa",
 *   "dicabut", dan "sudah dipakai" (kontrak §2.2: satu respons `404`);
 * - hasil kirim email disimpan apa adanya dan tidak pernah membuat request
 *   gagal (ADR K4).
 */

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { EmailSender, InviteEmail } from '../email/sender.js';
import { hashInviteToken, isWellFormedInviteToken } from './token.js';

/** Baris undangan yang cukup untuk pratinjau & penerimaan; tanpa `tokenHash`. */
export interface UsableInvite {
  id: string;
  email: string;
  role: 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR';
  expiresAt: Date;
  invitedBy: { name: string };
}

/**
 * Undangan yang **masih bisa dipakai** untuk token ini, atau `null` untuk semua
 * sebab kegagalan. Pemanggil menjawab `404 NOT_FOUND` tanpa detail.
 */
export async function findUsableInvite(
  prisma: PrismaClient,
  token: string,
  now: Date = new Date(),
): Promise<UsableInvite | null> {
  // Bentuk token salah: tidak mungkin ada di DB, jadi tidak perlu query.
  if (!isWellFormedInviteToken(token)) return null;

  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      invitedBy: { select: { name: true } },
    },
  });
  if (invite === null) return null;

  const { acceptedAt, revokedAt, ...usable } = invite;
  if (acceptedAt !== null || revokedAt !== null) return null;
  if (usable.expiresAt.getTime() <= now.getTime()) return null;
  return usable;
}

/**
 * Mengirim email undangan lalu menyimpan hasilnya di baris undangan.
 *
 * Dipanggil **setelah** undangan tersimpan (kontrak §5.13: "email Resend
 * setelah commit"). Kegagalan apa pun — termasuk pengirim yang melempar —
 * hanya menjadi `emailError`, tidak pernah `5xx` (ADR K4).
 */
export async function deliverInviteEmail(
  prisma: PrismaClient,
  sender: EmailSender,
  inviteId: string,
  message: InviteEmail,
): Promise<{ emailSentAt: Date | null; emailError: string | null }> {
  let result;
  try {
    result = await sender.sendInvite(message);
  } catch (err) {
    result = {
      sentAt: null,
      messageId: null,
      error: err instanceof Error ? err.name : 'SEND_FAILED',
    };
  }

  await prisma.invite.update({
    where: { id: inviteId },
    data: {
      emailSentAt: result.sentAt,
      emailMessageId: result.messageId,
      emailError: result.error,
    },
    select: { id: true },
  });
  return { emailSentAt: result.sentAt, emailError: result.error };
}
