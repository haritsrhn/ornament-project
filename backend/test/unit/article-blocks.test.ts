import { describe, expect, test } from 'vitest';

import {
  articleImageMediaIds,
  deriveExcerpt,
  parseArticleBlocks,
  toPublicArticleBlocks,
} from '../../src/modules/public/articles/dto.js';
import type { PublicMediaRow } from '../../src/modules/public/media.js';

/**
 * Blok artikel (model §3.6) tanpa database: penguraian isi kolom `Json`,
 * `excerpt` turunan, dan resolusi blok gambar menjadi `PublicMedia`.
 */

const MEDIA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const PRIVATE_MEDIA_ID = '7b1f0c3e-2d4a-4a9e-8f11-5c2b9a7d4e33';
const BASE_URL = 'https://media.ornament.id';

const publicRow: PublicMediaRow = {
  key: 'media/2026/09/foto.jpg',
  alt: 'Foto proses',
  width: 1600,
  height: 900,
  visibility: 'PUBLIC',
};
const privateRow: PublicMediaRow = { ...publicRow, key: 'private/ktp.jpg', visibility: 'PRIVATE' };

describe('parseArticleBlocks', () => {
  test('menerima blok yang sah dan membuang yang bentuknya tidak dikenal', () => {
    const { blocks, dropped } = parseArticleBlocks([
      { id: 'p1', type: 'paragraph', text: [{ text: 'Halo', bold: true }] },
      { id: 'h1', type: 'heading2', text: 'Judul' },
      { id: 'q1', type: 'quote', text: 'Kutipan', cite: 'Narasumber' },
      { id: 'i1', type: 'image', mediaId: MEDIA_ID },
      { id: 'x1', type: 'tidak-dikenal' },
      { id: 'p2', type: 'paragraph' },
      'bukan objek',
    ]);

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'heading2', 'quote', 'image']);
    expect(dropped).toBe(3);
  });

  test('isi yang bukan array tidak pernah melempar', () => {
    expect(parseArticleBlocks(null)).toEqual({ blocks: [], dropped: 0 });
    expect(parseArticleBlocks({ type: 'paragraph' })).toEqual({ blocks: [], dropped: 1 });
  });
});

describe('deriveExcerpt', () => {
  const blocks = parseArticleBlocks([
    { id: 'h1', type: 'heading2', text: 'Judul' },
    { id: 'p1', type: 'paragraph', text: [{ text: 'Rotan dipanen ' }, { text: 'di hulu.' }] },
  ]).blocks;

  test('memakai kolom excerpt bila terisi', () => {
    expect(deriveExcerpt('Ringkasan tersimpan.', blocks)).toBe('Ringkasan tersimpan.');
  });

  test('menurunkan dari paragraf pertama bila kosong', () => {
    expect(deriveExcerpt(null, blocks)).toBe('Rotan dipanen di hulu.');
    expect(deriveExcerpt('   ', blocks)).toBe('Rotan dipanen di hulu.');
  });

  test('dipotong di 200 karakter', () => {
    const panjang = parseArticleBlocks([
      { id: 'p1', type: 'paragraph', text: [{ text: 'a'.repeat(400) }] },
    ]).blocks;
    const excerpt = deriveExcerpt(null, panjang);

    expect(excerpt).toHaveLength(201);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('tanpa paragraf → string kosong', () => {
    expect(deriveExcerpt(null, parseArticleBlocks([]).blocks)).toBe('');
  });
});

describe('toPublicArticleBlocks', () => {
  const { blocks } = parseArticleBlocks([
    { id: 'p1', type: 'paragraph', text: [{ text: 'Teks' }] },
    { id: 'i1', type: 'image', mediaId: MEDIA_ID, caption: 'Keterangan' },
    { id: 'i2', type: 'image', mediaId: PRIVATE_MEDIA_ID },
    { id: 'i3', type: 'image', mediaId: '00000000-0000-4000-8000-000000000000' },
  ]);

  test('mediaId ditukar PublicMedia; media PRIVATE dan yang hilang dibuang', () => {
    const media = new Map<string, PublicMediaRow>([
      [MEDIA_ID, publicRow],
      [PRIVATE_MEDIA_ID, privateRow],
    ]);

    expect(articleImageMediaIds(blocks)).toEqual([
      MEDIA_ID,
      PRIVATE_MEDIA_ID,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(toPublicArticleBlocks(blocks, media, BASE_URL)).toEqual([
      { id: 'p1', type: 'paragraph', text: [{ text: 'Teks' }] },
      {
        id: 'i1',
        type: 'image',
        image: {
          url: `${BASE_URL}/media/2026/09/foto.jpg`,
          alt: 'Foto proses',
          width: 1600,
          height: 900,
        },
        caption: 'Keterangan',
      },
    ]);
  });

  test('tanpa basis URL publik, seluruh blok gambar dibuang', () => {
    const media = new Map<string, PublicMediaRow>([[MEDIA_ID, publicRow]]);
    expect(toPublicArticleBlocks(blocks, media, undefined)).toEqual([
      { id: 'p1', type: 'paragraph', text: [{ text: 'Teks' }] },
    ]);
  });
});
