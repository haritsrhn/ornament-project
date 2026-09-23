import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  isTicketExpired,
  signUploadTicket,
  verifyUploadTicket,
  type UploadTicketPayload,
} from '../../src/lib/upload-token.js';

/**
 * Tiket unggah (kontrak §5.12) adalah satu-satunya hal yang menghubungkan
 * presign dan konfirmasi — tidak ada tabel unggahan sementara. Karena isinya
 * dibawa klien, setiap field di dalamnya adalah field yang **tidak boleh**
 * bisa diubah klien: ukuran, MIME, visibilitas, key, dan pemiliknya.
 */

const SECRET = 'rahasia-uji-yang-cukup-panjang-untuk-hmac';
const OTHER_SECRET = 'rahasia-lain-yang-juga-cukup-panjang-sekali';

const payload: UploadTicketPayload = {
  key: 'media/2026/09/9c1e0000-0000-4000-8000-000000000000-kursi.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 845112,
  visibility: 'PUBLIC',
  userId: '8a1e0000-0000-4000-8000-000000000000',
  exp: Math.floor(Date.now() / 1000) + 600,
};

describe('signUploadTicket / verifyUploadTicket', () => {
  test('tiket yang baru ditandatangani terbaca kembali utuh', () => {
    expect(verifyUploadTicket(signUploadTicket(payload, SECRET), SECRET)).toEqual(payload);
  });

  test('kunci berbeda → ditolak', () => {
    expect(verifyUploadTicket(signUploadTicket(payload, SECRET), OTHER_SECRET)).toBeNull();
  });

  test('menaikkan sizeBytes membatalkan tanda tangan', () => {
    const token = signUploadTicket(payload, SECRET);
    const [body = '', signature = ''] = token.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    tampered.sizeBytes = 99_000_000;

    const forged = `${Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url')}.${signature}`;
    expect(verifyUploadTicket(forged, SECRET)).toBeNull();
  });

  test('menukar visibility PRIVATE menjadi PUBLIC membatalkan tanda tangan', () => {
    const token = signUploadTicket({ ...payload, visibility: 'PRIVATE' }, SECRET);
    const [body = '', signature = ''] = token.split('.');
    const tampered = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    tampered.visibility = 'PUBLIC';

    const forged = `${Buffer.from(JSON.stringify(tampered), 'utf8').toString('base64url')}.${signature}`;
    expect(verifyUploadTicket(forged, SECRET)).toBeNull();
  });

  test.each([
    ['tanpa pemisah', 'bukan-token'],
    ['tanda tangan kosong', 'eyJhIjoxfQ.'],
    ['payload bukan JSON', `${Buffer.from('bukan json').toString('base64url')}.xx`],
    ['string kosong', ''],
  ])('token cacat ditolak tanpa melempar (%s)', (_label, token) => {
    expect(verifyUploadTicket(token, SECRET)).toBeNull();
  });

  test('payload yang bentuknya tidak dikenal ditolak meski tanda tangannya sah', () => {
    // Ditandatangani dengan kunci yang benar, tapi isinya bukan tiket unggah:
    // verifikasi tanda tangan saja tidak cukup, bentuknya juga harus dicek.
    const body = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64url');
    const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64url');

    expect(verifyUploadTicket(`${body}.${signature}`, SECRET)).toBeNull();
  });
});

describe('isTicketExpired', () => {
  test('belum lewat → false, sudah lewat → true', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const exp = Math.floor(now.getTime() / 1000);

    expect(isTicketExpired({ ...payload, exp: exp + 1 }, now)).toBe(false);
    expect(isTicketExpired({ ...payload, exp: exp - 1 }, now)).toBe(true);
  });

  test('tepat di detik kedaluwarsa dianggap sudah lewat', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    expect(isTicketExpired({ ...payload, exp: now.getTime() / 1000 }, now)).toBe(true);
  });
});
