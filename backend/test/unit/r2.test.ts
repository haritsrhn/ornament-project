import { describe, expect, test } from 'vitest';

import {
  buildMediaKey,
  createR2Client,
  getObjectInput,
  putObjectInput,
  putSignOptions,
  r2Endpoint,
} from '../../src/lib/r2.js';

/**
 * R2 diuji tanpa bucket.
 *
 * Batas pengujiannya adalah apa yang **kami** serahkan ke SDK: endpoint, isi
 * perintah, dan daftar header yang ikut ditandatangani. SigV4 sendiri adalah
 * kode AWS dan tidak perlu dibuktikan ulang di sini; yang mudah salah dan
 * mahal adalah `ContentLength` yang lupa ditandatangani (batas ukuran tidak
 * ditegakkan siapa pun) atau berkas privat yang key-nya tanpa prefix.
 */

const CONFIG = {
  accountId: 'akun-uji',
  accessKeyId: 'AKIAUJI',
  secretAccessKey: 'rahasia-uji',
  bucket: 'ornament',
};

describe('createR2Client', () => {
  test('null bila salah satu kredensial belum diisi — pemanggil menjawab 503', () => {
    expect(createR2Client({})).toBeNull();
    expect(createR2Client({ ...CONFIG, bucket: undefined })).toBeNull();
    expect(createR2Client({ ...CONFIG, secretAccessKey: undefined })).toBeNull();
  });

  test('endpoint memakai akun R2, bukan AWS', () => {
    expect(r2Endpoint('akun-uji')).toBe('https://akun-uji.r2.cloudflarestorage.com');
  });
});

describe('perintah yang ditandatangani', () => {
  test('PUT membawa tipe dan ukuran yang disetujui', () => {
    expect(
      putObjectInput({
        bucket: 'ornament',
        key: 'media/2026/09/abc-kursi.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 845112,
        expiresInSeconds: 600,
      }),
    ).toEqual({
      Bucket: 'ornament',
      Key: 'media/2026/09/abc-kursi.jpg',
      ContentType: 'image/jpeg',
      ContentLength: 845112,
    });
  });

  test('content-length ikut ditandatangani — tanpa ini batas ukuran tidak ditegakkan siapa pun', () => {
    const options = putSignOptions(600);
    expect(options.expiresIn).toBe(600);
    expect([...options.signableHeaders].sort()).toEqual(['content-length', 'content-type']);
  });

  test('GET tanpa download tidak memaksa unduhan', () => {
    expect(
      getObjectInput({ bucket: 'ornament', key: 'media/x.jpg', expiresInSeconds: 300 }),
    ).toEqual({ Bucket: 'ornament', Key: 'media/x.jpg' });
  });

  test('GET dengan download memasang Content-Disposition attachment', () => {
    const input = getObjectInput({
      bucket: 'ornament',
      key: 'private/media/2026/09/abc-ktp.pdf',
      expiresInSeconds: 300,
      downloadAs: 'KTP Pak Budi.pdf',
    });
    expect(input.ResponseContentDisposition).toBe(
      `attachment; filename="KTP Pak Budi.pdf"; filename*=UTF-8''${encodeURIComponent('KTP Pak Budi.pdf')}`,
    );
  });

  test('nama berkas tidak bisa memecah header: kutip dan karakter non-ASCII dibersihkan', () => {
    const input = getObjectInput({
      bucket: 'ornament',
      key: 'private/x.pdf',
      expiresInSeconds: 300,
      downloadAs: 'nota "resmi"\r\nX-Injected: 1 — Ω.pdf',
    });
    const disposition = String(input.ResponseContentDisposition);
    expect(disposition).not.toContain('"resmi"');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    // Nama aslinya tetap terbawa utuh lewat `filename*`, yang sudah ter-encode.
    expect(disposition).toContain(encodeURIComponent('Ω'));
  });
});

describe('buildMediaKey', () => {
  const id = '9c1e0000-0000-4000-8000-000000000000';
  const now = new Date('2026-09-24T00:00:00.000Z');

  test('media/<yyyy>/<mm>/<id>-<slug>.<ext> (model §3.2)', () => {
    expect(
      buildMediaKey({ id, fileName: 'Kursi Lounge Depan.jpg', visibility: 'PUBLIC', now }),
    ).toBe(`media/2026/09/${id}-kursi-lounge-depan.jpg`);
  });

  test('berkas privat berprefix private/', () => {
    expect(buildMediaKey({ id, fileName: 'KTP.pdf', visibility: 'PRIVATE', now })).toBe(
      `private/media/2026/09/${id}-ktp.pdf`,
    );
  });

  test('nama non-ASCII disederhanakan, id tetap membuat key unik', () => {
    const a = buildMediaKey({ id, fileName: 'Anyaman — Bantul.png', visibility: 'PUBLIC', now });
    expect(a).toBe(`media/2026/09/${id}-anyaman-bantul.png`);
  });

  test('nama tanpa ekstensi maupun huruf tetap menghasilkan key yang sah', () => {
    expect(buildMediaKey({ id, fileName: '???', visibility: 'PUBLIC', now })).toBe(
      `media/2026/09/${id}-berkas`,
    );
  });

  test('ekstensi yang mencurigakan diabaikan alih-alih ikut ke key', () => {
    const key = buildMediaKey({
      id,
      fileName: 'gambar.very-long-and-weird',
      visibility: 'PUBLIC',
      now,
    });
    // Yang tidak lolos pola ekstensi tidak ikut ke key sama sekali, sehingga
    // key tidak pernah berakhiran sesuatu yang aneh. Nama aslinya tetap utuh
    // di kolom `fileName`, yang memang tempatnya.
    expect(key).toBe(`media/2026/09/${id}-gambar`);
  });
});
