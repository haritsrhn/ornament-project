import { describe, expect, test } from 'vitest';

import { createResendSender } from '../../src/modules/email/resend.js';
import { EMAIL_NOT_CONFIGURED, NoopEmailSender } from '../../src/modules/email/sender.js';

/**
 * Yang bisa dibuktikan tanpa API key adalah keputusan konfigurasinya: tanpa
 * `RESEND_*` lengkap, aplikasi harus jatuh ke `NoopEmailSender` yang melaporkan
 * kegagalan jujur — bukan diam-diam menganggap email terkirim.
 *
 * Pengiriman sungguhan tidak diuji di sini: ia memanggil layanan pihak ketiga,
 * dan cabang sukses/gagalnya dibuktikan lewat dobel di tes integrasi
 * (`test/helpers/email.ts`).
 */

describe('createResendSender', () => {
  test('null bila apiKey atau from belum diisi', () => {
    expect(createResendSender({})).toBeNull();
    expect(createResendSender({ apiKey: 're_uji' })).toBeNull();
    expect(createResendSender({ from: 'Ornament <no-reply@ornament.id>' })).toBeNull();
  });

  test('terbentuk bila keduanya ada', () => {
    expect(
      createResendSender({ apiKey: 're_uji', from: 'Ornament <no-reply@ornament.id>' }),
    ).not.toBeNull();
  });
});

describe('NoopEmailSender', () => {
  test('balasan inquiry melaporkan EMAIL_NOT_CONFIGURED, bukan sukses palsu', async () => {
    const result = await new NoopEmailSender().sendInquiryReply();
    expect(result).toEqual({ sentAt: null, messageId: null, error: EMAIL_NOT_CONFIGURED });
  });
});
