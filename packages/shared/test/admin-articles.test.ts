import { describe, expect, test } from 'vitest';

import {
  articleBulkBodySchema,
  articleContentInputSchema,
  articleInputSchema,
  countArticleWords,
  previewArticleBodySchema,
  publishArticleBodySchema,
  quickDraftContent,
  updateArticleBodySchema,
  ARTICLE_EDITOR_ONLY_FIELDS,
  ARTICLE_TITLE_MAX,
  QUICK_DRAFT_BLOCK_ID,
  type ArticleBlock,
} from '../src/index.js';

/**
 * Kontrak admin artikel (§5.9). Yang diuji di sini adalah aturan yang **tidak
 * membutuhkan database**: bentuk input, field turunan (`wordCount`), dan draf
 * cepat — supaya editor admin dan server tidak bisa menyimpang (ADR K6).
 */

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const UPDATED_AT = '2026-09-20T03:15:00.000Z';

describe('articleInputSchema', () => {
  test('menerima body minimal (draf cepat Q1: hanya judul)', () => {
    const parsed = articleInputSchema.safeParse({ title: 'Rotan dari Hulu' });
    expect(parsed.success).toBe(true);
    // `content` sengaja tidak diberi default di skema: server yang memutuskan
    // `[]`, sehingga "tidak dikirim" tetap bisa dibedakan dari "dikosongkan".
    expect(parsed.success && parsed.data.content).toBeUndefined();
  });

  test('menolak field tak dikenal dan field turunan read-only (§1.3)', () => {
    for (const body of [
      { title: 'Judul', status: 'PUBLISHED' },
      { title: 'Judul', wordCount: 100 },
      { title: 'Judul', publishedAt: UPDATED_AT },
      { title: 'Judul', tidakDikenal: true },
    ]) {
      expect(articleInputSchema.safeParse(body).success).toBe(false);
    }
  });

  test('judul kosong / terlalu panjang ditolak', () => {
    expect(articleInputSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(articleInputSchema.safeParse({ title: 'a'.repeat(ARTICLE_TITLE_MAX + 1) }).success).toBe(
      false,
    );
  });

  test('field Editor+ ada di daftar FORBIDDEN_FIELD dan tetap valid secara bentuk', () => {
    expect([...ARTICLE_EDITOR_ONLY_FIELDS]).toEqual(['slug', 'authorId']);
    const parsed = articleInputSchema.safeParse({
      title: 'Judul',
      slug: 'Rotan-Dari-Hulu',
      authorId: UUID,
    });
    // Penolakannya milik server (peran), bukan skema: slug tetap dinormalisasi.
    expect(parsed.success && parsed.data.slug).toBe('rotan-dari-hulu');
  });
});

describe('articleContentInputSchema', () => {
  test('menolak blok dengan id yang sama dua kali', () => {
    const blocks = [
      { id: 'b1', type: 'paragraph', text: [{ text: 'Satu' }] },
      { id: 'b1', type: 'heading2', text: 'Dua' },
    ];
    const parsed = articleContentInputSchema.safeParse(blocks);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain('id yang berbeda');
  });

  test('menolak blok yang bentuknya tidak dikenal', () => {
    expect(
      articleContentInputSchema.safeParse([{ id: 'v1', type: 'video', src: 'x' }]).success,
    ).toBe(false);
    expect(
      articleContentInputSchema.safeParse([{ id: 'i1', type: 'image', mediaId: 'bukan-uuid' }])
        .success,
    ).toBe(false);
  });
});

describe('updateArticleBodySchema', () => {
  test('expectedUpdatedAt wajib (§1.9)', () => {
    expect(updateArticleBodySchema.safeParse({ title: 'Baru' }).success).toBe(false);
    expect(
      updateArticleBodySchema.safeParse({ title: 'Baru', expectedUpdatedAt: UPDATED_AT }).success,
    ).toBe(true);
    expect(
      updateArticleBodySchema.safeParse({ expectedUpdatedAt: '20 September 2026' }).success,
    ).toBe(false);
  });
});

describe('publishArticleBodySchema & articleBulkBodySchema', () => {
  test('body publish boleh kosong, null, atau iso', () => {
    expect(publishArticleBodySchema.parse(undefined)).toEqual({});
    expect(publishArticleBodySchema.parse({ publishAt: null }).publishAt).toBeNull();
    expect(publishArticleBodySchema.parse({ publishAt: UPDATED_AT }).publishAt).toBe(UPDATED_AT);
    expect(publishArticleBodySchema.safeParse({ publishAt: 'besok' }).success).toBe(false);
  });

  test('aksi massal menolak id ganda dan aksi tak dikenal', () => {
    expect(articleBulkBodySchema.safeParse({ action: 'PUBLISH', ids: [UUID, UUID] }).success).toBe(
      false,
    );
    expect(articleBulkBodySchema.safeParse({ action: 'ARCHIVE', ids: [UUID] }).success).toBe(false);
    expect(articleBulkBodySchema.safeParse({ action: 'PURGE', ids: [UUID] }).success).toBe(true);
  });
});

describe('previewArticleBodySchema', () => {
  test('body kosong sah (pratinjau isi tersimpan) dan tanpa expectedUpdatedAt', () => {
    expect(previewArticleBodySchema.parse(undefined)).toEqual({});
    expect(previewArticleBodySchema.safeParse({ expectedUpdatedAt: UPDATED_AT }).success).toBe(
      false,
    );
  });
});

describe('countArticleWords', () => {
  test('menghitung teks yang benar-benar terbaca di halaman', () => {
    const blocks: ArticleBlock[] = [
      { id: 'h1', type: 'heading2', text: 'Dari Hulu' },
      { id: 'p1', type: 'paragraph', text: [{ text: 'Rotan ' }, { text: 'dipanen', bold: true }] },
      { id: 'q1', type: 'quote', text: 'Sabar itu kunci', cite: 'Pak Bagus' },
      { id: 'i1', type: 'image', mediaId: UUID, caption: 'Proses anyam' },
    ];
    // 2 + 2 + 3 + 2 + 2 = 11
    expect(countArticleWords(blocks)).toBe(11);
  });

  test('blok kosong dan spasi berlebih tidak dihitung', () => {
    expect(countArticleWords([])).toBe(0);
    expect(countArticleWords([{ id: 'p1', type: 'paragraph', text: [{ text: '   \n  ' }] }])).toBe(
      0,
    );
    expect(
      countArticleWords([{ id: 'p1', type: 'paragraph', text: [{ text: ' dua   kata ' }] }]),
    ).toBe(2);
  });
});

describe('quickDraftContent (Q1)', () => {
  test('catatan menjadi blok paragraf pertama', () => {
    const content = quickDraftContent('  Ide singkat tentang rotan.  ');
    expect(content).toEqual([
      {
        id: QUICK_DRAFT_BLOCK_ID,
        type: 'paragraph',
        text: [{ text: 'Ide singkat tentang rotan.' }],
      },
    ]);
    // Hasilnya harus lolos skema isi yang sama dengan yang dipakai server.
    expect(articleContentInputSchema.safeParse(content).success).toBe(true);
  });

  test('catatan kosong menghasilkan artikel tanpa blok, bukan error', () => {
    expect(quickDraftContent('')).toEqual([]);
    expect(quickDraftContent(null)).toEqual([]);
    expect(quickDraftContent(undefined)).toEqual([]);
  });
});
