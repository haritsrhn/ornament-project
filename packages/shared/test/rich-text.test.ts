import { describe, expect, test } from 'vitest';

import { RICH_TEXT_BLOCKS_MAX, richTextSchema } from '../src/rich-text.js';

/**
 * `Artisan.story` dan `Product.description` dulu hanya dijamin "JSON valid"
 * (`z.json()`): bentuk apa pun sampai batas 1 MB tersimpan dan dipantulkan
 * kembali ke profil pengrajin dan halaman produk publik. Yang diuji di sini
 * adalah bahwa keduanya sekarang punya bentuk — termasuk aturan tautan yang
 * sama dengan isi artikel.
 */

const paragraph = (text: string) => ({ id: 'p1', type: 'paragraph', text: [{ text }] });

describe('richTextSchema', () => {
  test('menerima blok teks: paragraph, heading2, quote', () => {
    const blocks = [
      paragraph('Workshop keluarga di Bantul.'),
      { id: 'h1', type: 'heading2', text: 'Proses' },
      { id: 'q1', type: 'quote', text: 'Kami mengerjakannya sendiri.', cite: 'Pak Budi' },
    ];
    expect(richTextSchema.safeParse(blocks).success).toBe(true);
  });

  test.each([
    ['objek, bukan array', { hello: 'world' }],
    ['string', 'cerita pengrajin'],
    ['angka', 42],
    ['null', null],
    ['array berisi string', ['paragraf']],
    ['blok tanpa id', [{ type: 'paragraph', text: [{ text: 'x' }] }]],
    ['tipe blok tak dikenal', [{ id: 'b1', type: 'video', src: 'x' }]],
  ])('menolak %s', (_label, value) => {
    expect(richTextSchema.safeParse(value).success).toBe(false);
  });

  test('blok gambar ditolak: story dan description tidak punya jalur resolve mediaId', () => {
    const blocks = [{ id: 'i1', type: 'image', mediaId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }];
    expect(richTextSchema.safeParse(blocks).success).toBe(false);
  });

  test('aturan href yang sama dengan isi artikel berlaku di sini', () => {
    const withHref = (href: string) => [
      { id: 'p1', type: 'paragraph', text: [{ text: 'T', href }] },
    ];

    expect(richTextSchema.safeParse(withHref('https://studio.se')).success).toBe(true);
    expect(richTextSchema.safeParse(withHref('/kontak')).success).toBe(true);
    expect(richTextSchema.safeParse(withHref('javascript:alert(1)')).success).toBe(false);
    expect(richTextSchema.safeParse(withHref('//evil.tld')).success).toBe(false);
    expect(richTextSchema.safeParse(withHref('data:text/html;base64,x')).success).toBe(false);
  });

  test(`maksimal ${String(RICH_TEXT_BLOCKS_MAX)} blok`, () => {
    const many = Array.from({ length: RICH_TEXT_BLOCKS_MAX }, (_, i) => ({
      id: `p${String(i)}`,
      type: 'paragraph' as const,
      text: [{ text: 'x' }],
    }));
    expect(richTextSchema.safeParse(many).success).toBe(true);
    expect(richTextSchema.safeParse([...many, paragraph('lebih')]).success).toBe(false);
  });

  test('array kosong diterima: cerita boleh dikosongkan tanpa menjadi null', () => {
    expect(richTextSchema.safeParse([]).success).toBe(true);
  });
});
