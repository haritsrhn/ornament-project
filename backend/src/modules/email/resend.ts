/**
 * Pengirim email lewat Resend (ADR K4).
 *
 * Tiga aturan yang membentuk berkas ini:
 *
 * 1. **Kegagalan email tidak pernah menjadi 5xx** (kontrak §1.10). Setiap
 *    metode menangkap kegagalannya sendiri dan mengembalikannya sebagai
 *    `EmailSendResult.error`, sehingga operasi domain yang memicunya —
 *    undangan dibuat, inquiry tersimpan, balasan ditulis — tetap berhasil dan
 *    statusnya jujur di UI.
 * 2. **Isi email tidak pernah masuk log.** Token undangan, alamat pengunjung,
 *    dan badan balasan hanya lewat; yang dicatat pemanggil cuma hasilnya.
 * 3. **Pesan galat dipendekkan.** `emailError` disimpan di database dan
 *    ditampilkan ke admin, jadi ia harus cukup untuk menebak penyebab tanpa
 *    menjadi tempat penyimpanan respons HTTP penuh.
 */

import type { Resend } from 'resend';

import type {
  EmailSender,
  EmailSendResult,
  InquiryNotificationEmail,
  InquiryReplyEmail,
  InviteEmail,
} from './sender.js';

export interface ResendConfig {
  apiKey: string;
  /** `Ornament <no-reply@ornament.id>`. */
  from: string;
}

/** Batas panjang `emailError` yang disimpan; cukup untuk kode + sebab. */
const ERROR_MAX = 200;

const shorten = (value: string): string =>
  value.length <= ERROR_MAX ? value : `${value.slice(0, ERROR_MAX - 1)}…`;

function toError(error: unknown): string {
  if (typeof error === 'string') return shorten(error);
  if (error instanceof Error) return shorten(`${error.name}: ${error.message}`);
  return 'UNKNOWN_EMAIL_ERROR';
}

/**
 * `null` bila Resend belum dikonfigurasi, sehingga pemanggil jatuh ke
 * `NoopEmailSender` dan status kirim tercatat `EMAIL_NOT_CONFIGURED`.
 */
export function createResendSender(config: Partial<ResendConfig>): ResendEmailSender | null {
  const { apiKey, from } = config;
  if (apiKey === undefined || from === undefined) return null;
  return new ResendEmailSender({ apiKey, from });
}

export class ResendEmailSender implements EmailSender {
  readonly #config: ResendConfig;
  #client: Promise<Resend> | null = null;

  constructor(config: ResendConfig) {
    this.#config = config;
  }

  /**
   * SDK dimuat saat pertama dipakai: proses yang tidak pernah mengirim email —
   * termasuk seluruh test suite, yang memakai dobel — tidak perlu membayarnya.
   */
  #connect(): Promise<Resend> {
    // Promise yang ditolak tidak boleh ikut ter-cache: sekali gagal — misalnya
    // dependensi setengah terpasang sesudah deploy — setiap email berikutnya
    // akan melaporkan galat yang sama sampai proses di-restart.
    this.#client ??= import('resend')
      .then((mod) => new mod.Resend(this.#config.apiKey))
      .catch((error: unknown) => {
        this.#client = null;
        throw error;
      });
    return this.#client;
  }

  async #send(payload: {
    to: string;
    subject: string;
    html: string;
    attachments?: { fileName: string; content: Buffer }[];
  }): Promise<EmailSendResult> {
    try {
      const client = await this.#connect();
      const result = await client.emails.send({
        from: this.#config.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        ...(payload.attachments === undefined || payload.attachments.length === 0
          ? {}
          : {
              attachments: payload.attachments.map((file) => ({
                filename: file.fileName,
                content: file.content,
              })),
            }),
      });

      // Resend melaporkan penolakan sebagai `error` di body, bukan lemparan.
      if (result.error !== null) {
        return { sentAt: null, messageId: null, error: toError(result.error.message) };
      }
      // Setelah `error === null`, tipe SDK menjamin `data` ada.
      return { sentAt: new Date(), messageId: result.data.id, error: null };
    } catch (error) {
      return { sentAt: null, messageId: null, error: toError(error) };
    }
  }

  sendInvite(message: InviteEmail): Promise<EmailSendResult> {
    const expires = message.expiresAt.toISOString();
    return this.#send({
      to: message.to,
      subject: 'Undangan admin Ornament',
      html:
        `<p>${escapeHtml(message.invitedByName)} mengundang Anda sebagai ` +
        `<strong>${escapeHtml(message.role)}</strong> di admin Ornament.</p>` +
        `<p>Token undangan: <code>${escapeHtml(message.token)}</code></p>` +
        `<p>Berlaku sampai ${escapeHtml(expires)}.</p>`,
    });
  }

  sendInquiryNotification(message: InquiryNotificationEmail): Promise<EmailSendResult> {
    // Sengaja tanpa isi pribadi pengirim: tim cukup tahu ada inquiry baru dan
    // nomornya, detailnya dibuka di admin yang punya kontrol akses.
    return this.#send({
      to: message.to,
      subject: `Inquiry baru ${message.reference}`,
      html:
        `<p>Inquiry baru masuk: <strong>${escapeHtml(message.reference)}</strong></p>` +
        `<p>${escapeHtml(message.subject)}</p>` +
        `<p>Buka admin Ornament untuk melihat detailnya.</p>`,
    });
  }

  sendInquiryReply(message: InquiryReplyEmail): Promise<EmailSendResult> {
    return this.#send({
      to: message.to,
      subject: message.subject,
      // Badan balasan diketik staf sebagai teks polos; di-escape lalu newline
      // diubah jadi <br> supaya tidak ada markup yang bisa dititipkan.
      html: `<div>${escapeHtml(message.body).replace(/\n/g, '<br>')}</div>`,
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
