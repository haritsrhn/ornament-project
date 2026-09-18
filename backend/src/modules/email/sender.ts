/**
 * Antarmuka pengirim email (ADR K4: Resend).
 *
 * Modul Resend **belum** dibangun (Tahap 5/8), dan PR ini sengaja tidak
 * menambah dependensi email. Yang ada di sini hanyalah kontrak internalnya plus
 * implementasi no-op, supaya:
 *
 * - alur undangan sudah memanggil pengirim di tempat yang benar (setelah commit
 *   pembuatan undangan), jadi menukar implementasinya nanti tidak menyentuh
 *   handler;
 * - hasil kirim tersimpan apa adanya di kolom `invite.email_sent_at`,
 *   `email_message_id`, dan `email_error` (model domain §3.1), sehingga UI bisa
 *   menampilkan "belum terkirim" alih-alih berpura-pura sukses;
 * - kegagalan email **tidak pernah** menjadi 5xx (ADR K4, kontrak §1.10:
 *   "Kegagalan Resend tidak menjadi 5xx — operasi tetap tersimpan, status kirim
 *   ditandai").
 *
 * Token undangan ikut dikirim ke `sendInvite` karena memang isi emailnya;
 * implementasi mana pun **tidak boleh** menuliskannya ke log (lihat
 * `NoopEmailSender`).
 */

import type { UserRole } from '@ornament/shared';

export interface InviteEmail {
  to: string;
  role: UserRole;
  /** Token mentah; hanya untuk badan email. Jangan pernah di-log. */
  token: string;
  expiresAt: Date;
  invitedByName: string;
}

export interface EmailSendResult {
  /** Waktu kirim berhasil; `null` bila gagal/belum dikirim. */
  sentAt: Date | null;
  /** ID pesan penyedia (Resend) bila ada. */
  messageId: string | null;
  /** Kode/pesan kegagalan singkat; `null` bila sukses. */
  error: string | null;
}

export interface EmailSender {
  sendInvite: (message: InviteEmail) => Promise<EmailSendResult>;
}

/** `emailError` saat belum ada penyedia email yang dikonfigurasi. */
export const EMAIL_NOT_CONFIGURED = 'EMAIL_NOT_CONFIGURED';

/**
 * Implementasi sementara: tidak mengirim apa pun dan melaporkan kegagalan yang
 * jujur, sehingga `AdminInvite.emailError` memberi tahu admin bahwa tautan
 * undangan harus dibagikan manual (lihat `token` di respons pembuatan).
 */
export class NoopEmailSender implements EmailSender {
  // Parameter sengaja tidak diterima sama sekali: tidak ada isi undangan —
  // apalagi tokennya — yang boleh menyentuh log atau penyimpanan lain.
  sendInvite(): Promise<EmailSendResult> {
    return Promise.resolve({ sentAt: null, messageId: null, error: EMAIL_NOT_CONFIGURED });
  }
}
