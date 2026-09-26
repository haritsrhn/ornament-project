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

/**
 * Notifikasi inquiry baru ke tim (`SiteSetting.contactEmail`, kontrak §5.4).
 *
 * Sengaja **tidak** memuat isi pribadi pengirim (email, pesan, lampiran):
 * yang dibutuhkan tim hanyalah "ada inquiry baru, ini nomornya". Detailnya
 * dibuka di admin, yang sudah punya kontrol akses dan jejak audit — jadi data
 * 🔒 tidak ikut menyebar ke kotak masuk dan log penyedia email.
 */
export interface InquiryNotificationEmail {
  /** Tujuan; `SiteSetting.contactEmail`. */
  to: string;
  /** `INQ-0043`. */
  reference: string;
  /** Subjek turunan (§6.5), mis. "Rotan alami — 400 pcs". */
  subject: string;
}

/**
 * Balasan admin ke pengirim inquiry (kontrak §5.11).
 *
 * Berbeda dengan notifikasi tim, email ini **memang** berisi tulisan staf dan
 * dialamatkan ke pengunjung, jadi `to` diambil dari `Inquiry.email` saat
 * balasan dibuat — bukan saat dikirim — supaya inquiry yang dianonimkan di
 * antara keduanya tidak membangkitkan alamat yang sudah dihapus.
 */
export interface InquiryReplyEmail {
  to: string;
  subject: string;
  body: string;
  /** Lampiran balasan; sudah diunduh pemanggil dari R2. */
  attachments?: { fileName: string; content: Buffer }[];
}

export interface EmailSender {
  sendInvite: (message: InviteEmail) => Promise<EmailSendResult>;
  /** Hasilnya disimpan di `Inquiry.notificationMessageId`/`notificationError`. */
  sendInquiryNotification: (message: InquiryNotificationEmail) => Promise<EmailSendResult>;
  /** Hasilnya disimpan di `InquiryReply.emailMessageId`/`emailError`. */
  sendInquiryReply: (message: InquiryReplyEmail) => Promise<EmailSendResult>;
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

  /**
   * Inquiry tetap tersimpan dan respons tetap `201`; yang tercatat adalah
   * `notificationError = "EMAIL_NOT_CONFIGURED"`, sehingga admin melihat
   * "notifikasi belum terkirim" alih-alih mengira tim sudah diberi tahu.
   */
  sendInquiryNotification(): Promise<EmailSendResult> {
    return Promise.resolve({ sentAt: null, messageId: null, error: EMAIL_NOT_CONFIGURED });
  }

  /**
   * Balasan tetap tersimpan dan respons tetap `200`; statusnya `FAILED`
   * dengan `emailError = "EMAIL_NOT_CONFIGURED"`, dan bisa dikirim ulang
   * setelah penyedia dikonfigurasi (kontrak §5.11).
   */
  sendInquiryReply(): Promise<EmailSendResult> {
    return Promise.resolve({ sentAt: null, messageId: null, error: EMAIL_NOT_CONFIGURED });
  }
}
