import type {
  EmailSender,
  EmailSendResult,
  InquiryNotificationEmail,
  InquiryReplyEmail,
  InviteEmail,
} from '../../src/modules/email/sender.js';

/**
 * Pengirim email yang mencatat, bukan mengirim.
 *
 * Kontrak §1.10 menuntut kegagalan email **tidak** menjadi 5xx, jadi yang
 * harus bisa dibuktikan tes adalah kedua cabangnya: sukses menandai `SENT`,
 * gagal menandai `FAILED` dengan `emailError` yang bisa dibaca admin — dan
 * keduanya tetap `200`. Dobel ini membuat cabang gagal bisa dipicu sesuka
 * hati, yang mustahil dilakukan terhadap Resend sungguhan.
 */
export interface RecordingEmailSender extends EmailSender {
  readonly invites: InviteEmail[];
  readonly notifications: InquiryNotificationEmail[];
  readonly replies: InquiryReplyEmail[];
  /** Diisi untuk membuat panggilan berikutnya gagal, lalu dikosongkan sendiri. */
  failNextReply: (error: string) => void;
}

export function createRecordingEmailSender(): RecordingEmailSender {
  const invites: InviteEmail[] = [];
  const notifications: InquiryNotificationEmail[] = [];
  const replies: InquiryReplyEmail[] = [];
  let nextReplyError: string | null = null;

  const succeed = (): EmailSendResult => ({
    sentAt: new Date(),
    messageId: `msg_${Math.random().toString(36).slice(2, 10)}`,
    error: null,
  });

  return {
    invites,
    notifications,
    replies,

    failNextReply(error) {
      nextReplyError = error;
    },

    sendInvite(message) {
      invites.push(message);
      return Promise.resolve(succeed());
    },

    sendInquiryNotification(message) {
      notifications.push(message);
      return Promise.resolve(succeed());
    },

    sendInquiryReply(message) {
      replies.push(message);
      if (nextReplyError !== null) {
        const error = nextReplyError;
        nextReplyError = null;
        return Promise.resolve({ sentAt: null, messageId: null, error });
      }
      return Promise.resolve(succeed());
    },
  };
}
