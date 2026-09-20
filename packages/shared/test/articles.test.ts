import { describe, expect, test } from 'vitest';

import {
  articleBlockSchema,
  articleContentSchema,
  publicCommentInputSchema,
  COMMENT_BODY_MAX,
  publicArticleBlockSchema,
  ARTICLE_BLOCKS_MAX,
} from '../src/articles.js';
import { navCategoryHref, publicRedirectPath } from '../src/site.js';

/**
 * Skema blok artikel (model §3.6) menggantikan `z.json()` generik: bentuk yang
 * tidak dikenal harus ditolak di sini, bukan lolos ke respons publik.
 */

const MEDIA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('articleBlockSchema', () => {
  test('menerima keempat tipe blok', () => {
    const blocks = [
      { id: 'p1', type: 'paragraph', text: [{ text: 'Halo', bold: true, href: '/kontak' }] },
      { id: 'h1', type: 'heading2', text: 'Judul' },
      { id: 'q1', type: 'quote', text: 'Kutipan', cite: 'Narasumber' },
      { id: 'i1', type: 'image', mediaId: MEDIA_ID, caption: 'Keterangan' },
    ];
    expect(articleContentSchema.safeParse(blocks).success).toBe(true);
  });

  test('menolak tipe tak dikenal, id kosong, dan mediaId bukan uuid', () => {
    for (const block of [
      { id: 'x1', type: 'video', src: 'https://contoh.test/v.mp4' },
      { id: '', type: 'heading2', text: 'Judul' },
      { id: 'i1', type: 'image', mediaId: 'bukan-uuid' },
      { id: 'p1', type: 'paragraph', text: 'teks polos' },
    ]) {
      expect(articleBlockSchema.safeParse(block).success).toBe(false);
    }
  });

  test('isi artikel dibatasi 200 blok', () => {
    const block = { id: 'p1', type: 'paragraph', text: [{ text: 'a' }] };
    expect(
      articleContentSchema.safeParse(Array.from({ length: ARTICLE_BLOCKS_MAX }, () => block))
        .success,
    ).toBe(true);
    expect(
      articleContentSchema.safeParse(Array.from({ length: ARTICLE_BLOCKS_MAX + 1 }, () => block))
        .success,
    ).toBe(false);
  });

  test('blok gambar publik memakai PublicMedia, bukan mediaId', () => {
    const image = { url: 'https://media.test/a.jpg', alt: null, width: null, height: null };
    expect(publicArticleBlockSchema.safeParse({ id: 'i1', type: 'image', image }).success).toBe(
      true,
    );
    // `mediaId` internal tidak pernah menjadi bentuk yang sah di sisi publik.
    expect(
      publicArticleBlockSchema.safeParse({ id: 'i1', type: 'image', mediaId: MEDIA_ID }).success,
    ).toBe(false);
  });
});

describe('href turunan situs publik', () => {
  test('redirect memakai prefiks per tipe (kontrak §5.5)', () => {
    expect(publicRedirectPath('PRODUCT', 'kursi-rotan')).toBe('/produk/kursi-rotan');
    expect(publicRedirectPath('ARTICLE', 'rotan-dari-hulu')).toBe('/journal/rotan-dari-hulu');
  });

  test('menu kategori menjadi filter katalog, dengan slug ter-encode', () => {
    expect(navCategoryHref('furniture')).toBe('/catalog?category=furniture');
    expect(navCategoryHref('kursi & meja')).toBe('/catalog?category=kursi%20%26%20meja');
  });
});

describe('publicCommentInputSchema (kontrak §5.3, Q9)', () => {
  const valid = { authorName: 'Sofia L.', authorEmail: 'sofia@studio.se', body: 'Berapa lama?' };

  test('menerima nama, email, dan isi', () => {
    expect(publicCommentInputSchema.safeParse(valid).success).toBe(true);
  });

  test.each(['authorName', 'authorEmail', 'body'])('%s wajib', (field) => {
    // Bangun ulang tanpa `field` alih-alih `delete` dinamis (aturan lint).
    const body = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
    const result = publicCommentInputSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  test('email wajib valid (Q9: tidak boleh kosong)', () => {
    const result = publicCommentInputSchema.safeParse({ ...valid, authorEmail: '' });
    expect(result.success).toBe(false);
  });

  test('isi maksimal 2000 karakter (model §3.6)', () => {
    expect(
      publicCommentInputSchema.safeParse({ ...valid, body: 'x'.repeat(COMMENT_BODY_MAX) }).success,
    ).toBe(true);
    expect(
      publicCommentInputSchema.safeParse({ ...valid, body: 'x'.repeat(COMMENT_BODY_MAX + 1) })
        .success,
    ).toBe(false);
  });

  test('`parentId` diterima: pengunjung boleh membalas (keputusan pemilik)', () => {
    // Syarat induk (akar, APPROVED, artikel yang sama) ditegakkan server, bukan skema.
    expect(
      publicCommentInputSchema.safeParse({ ...valid, parentId: crypto.randomUUID() }).success,
    ).toBe(true);
    expect(publicCommentInputSchema.safeParse({ ...valid, parentId: null }).success).toBe(true);
    expect(publicCommentInputSchema.safeParse({ ...valid, parentId: 'bukan-uuid' }).success).toBe(
      false,
    );
  });

  test('`status` ditolak: klien tidak menentukan hasil moderasi', () => {
    const result = publicCommentInputSchema.safeParse({ ...valid, status: 'APPROVED' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});
