import { describe, expect, test } from 'vitest';

import {
  allowedMimeTypes,
  mediaConfirmSchema,
  mediaKindForMime,
  mediaListQuerySchema,
  mediaPatchSchema,
  mediaSizeLimit,
  mediaUploadRequestSchema,
  MEDIA_PAGE_SIZE_DEFAULT,
} from '../src/media.js';

/**
 * Allowlist unggah (kontrak §5.12) adalah satu-satunya tempat yang memutuskan
 * berkas apa yang boleh masuk. Ia dipisah per `visibility` dengan sengaja:
 * berkas publik disajikan apa adanya dari domain media, sedangkan berkas
 * privat punya batas lebih ketat.
 */

describe('allowlist unggah', () => {
  test('gambar publik dibatasi 10 MB, PDF publik 20 MB', () => {
    expect(mediaSizeLimit('PUBLIC', 'image/jpeg')).toBe(10 * 1024 * 1024);
    expect(mediaSizeLimit('PUBLIC', 'application/pdf')).toBe(20 * 1024 * 1024);
  });

  test('PDF privat lebih ketat daripada PDF publik', () => {
    expect(mediaSizeLimit('PRIVATE', 'application/pdf')).toBe(10 * 1024 * 1024);
    expect(mediaSizeLimit('PRIVATE', 'application/pdf')).toBeLessThan(
      mediaSizeLimit('PUBLIC', 'application/pdf') ?? 0,
    );
  });

  test('webp tidak diizinkan sebagai berkas privat', () => {
    expect(mediaSizeLimit('PUBLIC', 'image/webp')).not.toBeNull();
    expect(mediaSizeLimit('PRIVATE', 'image/webp')).toBeNull();
  });

  test.each(['image/svg+xml', 'text/html', 'application/zip', 'image/gif', ''])(
    '%s ditolak untuk kedua visibilitas',
    (mime) => {
      expect(mediaSizeLimit('PUBLIC', mime)).toBeNull();
      expect(mediaSizeLimit('PRIVATE', mime)).toBeNull();
    },
  );

  test('allowlist tidak bisa ditembus lewat properti prototipe', () => {
    // `constructor` dan `toString` ada di prototipe objek biasa; lookup yang
    // naif akan mengembalikan sesuatu yang bukan angka dan lolos pemeriksaan.
    expect(mediaSizeLimit('PUBLIC', 'constructor')).toBeNull();
    expect(mediaSizeLimit('PUBLIC', 'toString')).toBeNull();
    expect(mediaSizeLimit('PUBLIC', '__proto__')).toBeNull();
  });

  test('allowedMimeTypes mengembalikan daftar untuk pesan error', () => {
    expect(allowedMimeTypes('PRIVATE')).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
  });
});

describe('mediaKindForMime', () => {
  test('gambar → IMAGE, PDF → DOCUMENT', () => {
    expect(mediaKindForMime('image/png')).toBe('IMAGE');
    expect(mediaKindForMime('image/webp')).toBe('IMAGE');
    expect(mediaKindForMime('application/pdf')).toBe('DOCUMENT');
  });
});

describe('mediaUploadRequestSchema', () => {
  const valid = { fileName: 'Kursi.jpg', mimeType: 'image/jpeg', sizeBytes: 845112 };

  test('visibility default PUBLIC', () => {
    const parsed = mediaUploadRequestSchema.parse(valid);
    expect(parsed.visibility).toBe('PUBLIC');
  });

  test('ukuran nol atau negatif ditolak', () => {
    expect(mediaUploadRequestSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(false);
    expect(mediaUploadRequestSchema.safeParse({ ...valid, sizeBytes: -1 }).success).toBe(false);
  });

  test('field tak dikenal ditolak (strictObject)', () => {
    expect(mediaUploadRequestSchema.safeParse({ ...valid, key: 'media/bebas.jpg' }).success).toBe(
      false,
    );
  });
});

describe('mediaConfirmSchema', () => {
  test('alt opsional dan boleh null', () => {
    expect(mediaConfirmSchema.safeParse({ uploadId: 'upl_1' }).success).toBe(true);
    expect(mediaConfirmSchema.safeParse({ uploadId: 'upl_1', alt: null }).success).toBe(true);
  });

  test('klien tidak bisa menitipkan visibility atau key lewat konfirmasi', () => {
    expect(mediaConfirmSchema.safeParse({ uploadId: 'upl_1', visibility: 'PUBLIC' }).success).toBe(
      false,
    );
    expect(mediaConfirmSchema.safeParse({ uploadId: 'upl_1', key: 'media/x.jpg' }).success).toBe(
      false,
    );
  });
});

describe('mediaListQuerySchema', () => {
  test('default: halaman 1, 40 per halaman, terbaru lebih dulu', () => {
    const parsed = mediaListQuerySchema.parse({});
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: MEDIA_PAGE_SIZE_DEFAULT,
      sort: '-createdAt',
    });
  });

  test('bool dari query string dibaca sebagai boolean', () => {
    const parsed = mediaListQuerySchema.parse({ unused: 'true', trashed: 'false' });
    expect(parsed.unused).toBe(true);
    expect(parsed.trashed).toBe(false);
  });

  test.each(['2026-9', '2026/09', '2026-13', '2026-00', 'kemarin'])('month %s ditolak', (month) => {
    expect(mediaListQuerySchema.safeParse({ month }).success).toBe(false);
  });

  test('month YYYY-MM diterima', () => {
    expect(mediaListQuerySchema.safeParse({ month: '2026-09' }).success).toBe(true);
  });

  test('sort di luar allowlist ditolak', () => {
    expect(mediaListQuerySchema.safeParse({ sort: 'sizeBytes' }).success).toBe(false);
  });
});

describe('mediaPatchSchema', () => {
  test('body kosong ditolak: PATCH tanpa perubahan bukan permintaan yang sah', () => {
    expect(mediaPatchSchema.safeParse({}).success).toBe(false);
  });

  test('alt boleh dikosongkan; aturan "wajib saat terbit" ditegakkan server', () => {
    expect(mediaPatchSchema.safeParse({ alt: null }).success).toBe(true);
  });
});
