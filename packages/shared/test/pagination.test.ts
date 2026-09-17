import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  PUBLIC_CURSOR_LIMITS,
  cursorMetaWithTotalSchema,
  cursorQuerySchema,
  dataMetaEnvelope,
  pageMetaSchema,
  pageQuerySchema,
} from '../src/index.js';

describe('pageQuerySchema', () => {
  test('default page 1, pageSize 20', () => {
    expect(pageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  test('string query dikonversi ke angka', () => {
    expect(pageQuerySchema.parse({ page: '3', pageSize: '100' })).toEqual({
      page: 3,
      pageSize: 100,
    });
  });

  test.each([{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { pageSize: 'abc' }])(
    'menolak %o',
    (query) => {
      expect(pageQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

describe('cursorQuerySchema', () => {
  const schema = cursorQuerySchema(PUBLIC_CURSOR_LIMITS);

  test('default limit dan cursor opsional', () => {
    expect(schema.parse({})).toEqual({ limit: 12 });
    expect(schema.parse({ limit: '48', cursor: 'eyJwIjoi' })).toEqual({
      limit: 48,
      cursor: 'eyJwIjoi',
    });
  });

  test('menolak limit di atas batas dan cursor kosong', () => {
    expect(schema.safeParse({ limit: '49' }).success).toBe(false);
    expect(schema.safeParse({ cursor: '' }).success).toBe(false);
  });
});

describe('meta', () => {
  test('envelope daftar ber-halaman', () => {
    const body = {
      data: ['a'],
      meta: { page: 1, pageSize: 20, total: 57, totalPages: 3, counts: { all: 57, DRAFT: 16 } },
    };
    expect(dataMetaEnvelope(z.array(z.string()), pageMetaSchema).parse(body)).toEqual(body);
    expect(pageMetaSchema.safeParse({ ...body.meta, total: -1 }).success).toBe(false);
  });

  test('nextCursor null berarti habis', () => {
    expect(cursorMetaWithTotalSchema.parse({ limit: 12, nextCursor: null, total: 38 })).toEqual({
      limit: 12,
      nextCursor: null,
      total: 38,
    });
    expect(cursorMetaWithTotalSchema.safeParse({ limit: 12, nextCursor: null }).success).toBe(
      false,
    );
  });
});
