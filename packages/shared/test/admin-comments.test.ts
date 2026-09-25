import { describe, expect, test } from 'vitest';

import {
  adminCommentsQuerySchema,
  anonymizeCommentSchema,
  adminCommentReplySchema,
  canModerateFrom,
  commentBulkBodySchema,
  COMMENT_BODY_ADMIN_MAX,
  moderateCommentSchema,
} from '../src/admin-comments.js';
import { BULK_IDS_MAX } from '../src/common.js';

/**
 * Kontrak moderasi komentar (§5.10). Yang diuji di sini adalah keputusan yang
 * tidak boleh berubah diam-diam: antrean yang muncul lebih dulu, dan pintu
 * keluar `DELETED` yang tidak punya jalan kembali.
 */

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('adminCommentsQuerySchema', () => {
  test('default status PENDING: layar moderasi membuka antreannya', () => {
    const parsed = adminCommentsQuerySchema.parse({});
    expect(parsed.status).toBe('PENDING');
    expect(parsed.sort).toBe('-createdAt');
  });

  test('status di luar enum ditolak', () => {
    expect(adminCommentsQuerySchema.safeParse({ status: 'ARCHIVED' }).success).toBe(false);
  });

  test('sort di luar allowlist ditolak (§1.7)', () => {
    expect(adminCommentsQuerySchema.safeParse({ sort: '-authorName' }).success).toBe(false);
  });
});

describe('canModerateFrom', () => {
  test.each(['PENDING', 'APPROVED', 'SPAM'])('%s masih bisa dimoderasi', (status) => {
    expect(canModerateFrom(status)).toBe(true);
  });

  test('DELETED adalah titik akhir: tidak bisa dipulihkan lewat UI (model §6.8)', () => {
    expect(canModerateFrom('DELETED')).toBe(false);
  });
});

describe('moderateCommentSchema', () => {
  test('hanya menerima field status', () => {
    expect(moderateCommentSchema.safeParse({ status: 'APPROVED' }).success).toBe(true);
    expect(
      moderateCommentSchema.safeParse({ status: 'APPROVED', moderatedById: UUID }).success,
    ).toBe(false);
  });
});

describe('adminCommentReplySchema', () => {
  test(`isi wajib, maksimal ${String(COMMENT_BODY_ADMIN_MAX)} karakter`, () => {
    expect(adminCommentReplySchema.safeParse({ body: 'Halo.' }).success).toBe(true);
    expect(adminCommentReplySchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(
      adminCommentReplySchema.safeParse({ body: 'x'.repeat(COMMENT_BODY_ADMIN_MAX + 1) }).success,
    ).toBe(false);
  });

  test('status tidak bisa dititipkan lewat balasan', () => {
    expect(adminCommentReplySchema.safeParse({ body: 'Halo.', status: 'SPAM' }).success).toBe(
      false,
    );
  });
});

describe('anonymizeCommentSchema', () => {
  test('sameEmail default false: penyapuan lintas email harus diminta eksplisit', () => {
    expect(anonymizeCommentSchema.parse({}).sameEmail).toBe(false);
    expect(anonymizeCommentSchema.parse({ sameEmail: true }).sameEmail).toBe(true);
  });
});

describe('commentBulkBodySchema', () => {
  test('ids wajib ada isinya dan dibatasi', () => {
    expect(commentBulkBodySchema.safeParse({ action: 'APPROVE', ids: [] }).success).toBe(false);
    expect(
      commentBulkBodySchema.safeParse({
        action: 'APPROVE',
        ids: Array.from({ length: BULK_IDS_MAX + 1 }, () => UUID),
      }).success,
    ).toBe(false);
  });

  test('aksi di luar empat yang dikenal ditolak', () => {
    expect(commentBulkBodySchema.safeParse({ action: 'PURGE', ids: [UUID] }).success).toBe(false);
  });
});
