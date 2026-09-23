import { describe, expect, test } from 'vitest';

import { readImageSize } from '../../src/lib/image-size.js';

/**
 * Dimensi dibaca dari header berkas yang diunggah orang lain (kontrak §5.12),
 * jadi yang diuji bukan hanya "angkanya benar" tetapi juga bahwa header
 * bohong atau terpotong berakhir sebagai `null` — bukan lemparan, dan bukan
 * angka karangan yang ikut tersimpan ke database.
 */

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpeg(width: number, height: number, padding = 0): Buffer {
  // SOI, satu segmen APP0 sepanjang `padding`, lalu SOF0 berisi dimensi.
  const app0 = Buffer.alloc(padding === 0 ? 0 : padding + 2);
  if (padding > 0) {
    app0.writeUInt16BE(0xffe0, 0);
    app0.writeUInt16BE(padding, 2);
  }
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

function webpLossy(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  b.writeUIntLE(0x2a019d, 23, 3);
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  return b;
}

describe('readImageSize', () => {
  test('PNG', () => {
    expect(readImageSize(png(1600, 2000))).toEqual({ width: 1600, height: 2000 });
  });

  test('JPEG dengan SOF tepat setelah SOI', () => {
    expect(readImageSize(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  test('JPEG dengan segmen di depan: penelusuran melewatinya, bukan menyerah', () => {
    expect(readImageSize(jpeg(640, 480, 120))).toEqual({ width: 640, height: 480 });
  });

  test('WebP lossy', () => {
    expect(readImageSize(webpLossy(800, 600))).toEqual({ width: 800, height: 600 });
  });

  test.each([
    ['buffer kosong', Buffer.alloc(0)],
    ['PNG terpotong sebelum IHDR', png(100, 100).subarray(0, 20)],
    ['PDF, bukan gambar', Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1')],
    ['RIFF tapi bukan WEBP', Buffer.concat([Buffer.from('RIFF....AVI '), Buffer.alloc(20)])],
  ])('%s → null', (_label, buffer) => {
    expect(readImageSize(buffer)).toBeNull();
  });

  test('panjang segmen JPEG yang dipalsukan berhenti sebagai null, bukan berputar', () => {
    // `length = 0` akan membuat penelusuran naif tidak pernah maju.
    const b = Buffer.alloc(64);
    b.writeUInt16BE(0xffd8, 0);
    b.writeUInt16BE(0xffe0, 2);
    b.writeUInt16BE(0, 4);
    expect(readImageSize(b)).toBeNull();
  });
});
