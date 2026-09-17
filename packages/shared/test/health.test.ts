import { expect, test } from 'vitest';

import { healthResponseSchema } from '../src/index.js';

test('healthResponseSchema hanya menerima status ok', () => {
  expect(healthResponseSchema.parse({ data: { status: 'ok' } })).toEqual({
    data: { status: 'ok' },
  });
  expect(healthResponseSchema.safeParse({ data: { status: 'down' } }).success).toBe(false);
  expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
});
