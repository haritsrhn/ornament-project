import { describe, expect, test } from 'vitest';

import {
  adminInquiriesQuerySchema,
  canTransitionInquiry,
  inquiryPreview,
  inquiryReplyInputSchema,
  INQUIRY_PREVIEW_LENGTH,
  INQUIRY_REPLY_ATTACHMENTS_MAX,
  INQUIRY_REPLY_BODY_MAX,
  updateInquirySchema,
} from '../src/admin-inquiries.js';

/**
 * Kontrak inbox inquiry (§5.11) dan aturan transisinya (§6.5). Yang dijaga di
 * sini adalah keputusan yang tidak boleh berubah diam-diam: status yang sudah
 * selesai tidak bisa dimundurkan lewat tombol, dan cuplikan daftar tidak
 * pernah membawa isi permintaan pembeli seutuhnya.
 */

describe('canTransitionInquiry (§6.5)', () => {
  test('maju sepanjang alur diizinkan', () => {
    expect(canTransitionInquiry('NEW', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionInquiry('NEW', 'DONE')).toBe(true);
    expect(canTransitionInquiry('IN_PROGRESS', 'DONE')).toBe(true);
  });

  test('DONE tertutup untuk kedua arah mundur', () => {
    // `DONE → IN_PROGRESS` hanya lewat balasan baru yang benar-benar terkirim,
    // bukan lewat tombol status.
    expect(canTransitionInquiry('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransitionInquiry('DONE', 'NEW')).toBe(false);
  });

  test('IN_PROGRESS → NEW ditolak: "belum dibaca" tidak bisa dibuat ulang', () => {
    expect(canTransitionInquiry('IN_PROGRESS', 'NEW')).toBe(false);
  });

  test('status yang sama selalu boleh: PATCH idempoten', () => {
    expect(canTransitionInquiry('DONE', 'DONE')).toBe(true);
    expect(canTransitionInquiry('NEW', 'NEW')).toBe(true);
  });
});

describe('inquiryPreview', () => {
  test('dipotong pada batas dan diratakan spasinya', () => {
    const preview = inquiryPreview(`Baris satu.\n\n   Baris dua. ${'x'.repeat(300)}`);
    expect(preview.length).toBeLessThanOrEqual(INQUIRY_PREVIEW_LENGTH);
    expect(preview).not.toContain('\n');
    expect(preview.endsWith('…')).toBe(true);
  });

  test('pesan pendek utuh, tanpa elipsis', () => {
    expect(inquiryPreview('Butuh 400 pcs.')).toBe('Butuh 400 pcs.');
  });

  test('null → string kosong: inquiry yang dianonimkan tidak punya cuplikan', () => {
    expect(inquiryPreview(null)).toBe('');
  });
});

describe('updateInquirySchema', () => {
  test('body kosong ditolak', () => {
    expect(updateInquirySchema.safeParse({}).success).toBe(false);
  });

  test('targetShipDate wajib YYYY-MM-DD, boleh null', () => {
    expect(updateInquirySchema.safeParse({ targetShipDate: '2026-11-01' }).success).toBe(true);
    expect(updateInquirySchema.safeParse({ targetShipDate: null }).success).toBe(true);
    expect(
      updateInquirySchema.safeParse({ targetShipDate: '2026-11-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });

  test('field turunan tidak bisa dititipkan', () => {
    expect(updateInquirySchema.safeParse({ read: true, completedAt: null }).success).toBe(false);
    expect(updateInquirySchema.safeParse({ reference: 'INQ-0001' }).success).toBe(false);
  });
});

describe('inquiryReplyInputSchema', () => {
  test('body wajib; subject opsional karena diturunkan dari inquiry', () => {
    expect(inquiryReplyInputSchema.safeParse({ body: 'Halo.' }).success).toBe(true);
    expect(inquiryReplyInputSchema.safeParse({ subject: 'Re: X', body: 'Halo.' }).success).toBe(
      true,
    );
    expect(inquiryReplyInputSchema.safeParse({ subject: 'Re: X' }).success).toBe(false);
  });

  test(`body dibatasi ${String(INQUIRY_REPLY_BODY_MAX)} karakter`, () => {
    expect(
      inquiryReplyInputSchema.safeParse({ body: 'x'.repeat(INQUIRY_REPLY_BODY_MAX + 1) }).success,
    ).toBe(false);
  });

  test(`lampiran maksimal ${String(INQUIRY_REPLY_ATTACHMENTS_MAX)}`, () => {
    const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    expect(
      inquiryReplyInputSchema.safeParse({
        body: 'Halo.',
        attachmentMediaIds: Array.from({ length: INQUIRY_REPLY_ATTACHMENTS_MAX + 1 }, () => uuid),
      }).success,
    ).toBe(false);
  });

  test('status dan toEmail tidak bisa dititipkan klien', () => {
    expect(inquiryReplyInputSchema.safeParse({ body: 'Halo.', status: 'SENT' }).success).toBe(
      false,
    );
    expect(
      inquiryReplyInputSchema.safeParse({ body: 'Halo.', toEmail: 'x@y.invalid' }).success,
    ).toBe(false);
  });
});

describe('adminInquiriesQuerySchema', () => {
  test('tanpa status = semua; sort default terbaru lebih dulu', () => {
    const parsed = adminInquiriesQuerySchema.parse({});
    expect(parsed.status).toBeUndefined();
    expect(parsed.sort).toBe('-createdAt');
  });

  test('sort di luar allowlist ditolak', () => {
    expect(adminInquiriesQuerySchema.safeParse({ sort: '-volumeQuantity' }).success).toBe(false);
  });
});
