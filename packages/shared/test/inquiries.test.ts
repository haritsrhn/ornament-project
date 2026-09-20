import { describe, expect, test } from 'vitest';

import {
  buildInquirySubject,
  formatInquiryReference,
  parseTargetShipDate,
  publicInquiryInputSchema,
  INQUIRY_ATTACHMENTS_MAX,
} from '../src/inquiries.js';
import { isHoneypotFilled } from '../src/common.js';

/**
 * Aturan turunan inquiry (model §6.5) yang harus sama persis di server, di
 * form, dan di tes — karena itu murni dan tinggal di paket bersama.
 */

describe('formatInquiryReference', () => {
  test('memformat INQ-xxxx dengan nol di depan', () => {
    expect(formatInquiryReference(1)).toBe('INQ-0001');
    expect(formatInquiryReference(43)).toBe('INQ-0043');
    expect(formatInquiryReference(9999)).toBe('INQ-9999');
  });

  test('setelah 9999 panjangnya bertambah, tidak dipotong (§6.5)', () => {
    expect(formatInquiryReference(10_000)).toBe('INQ-10000');
  });
});

describe('buildInquirySubject', () => {
  test('material saja → "<material> — n pcs"', () => {
    expect(
      buildInquirySubject({
        categoryLabel: null,
        materialLabel: 'Rotan alami',
        volumeQuantity: 400,
      }),
    ).toBe('Rotan alami — 400 pcs');
  });

  test('kategori saja dipakai bila material kosong', () => {
    expect(
      buildInquirySubject({ categoryLabel: 'Lighting', materialLabel: null, volumeQuantity: 12 }),
    ).toBe('Lighting — 12 pcs');
  });

  test('keduanya terisi → "<kategori> <material> — n pcs"', () => {
    expect(
      buildInquirySubject({
        categoryLabel: 'Lighting',
        materialLabel: 'Rotan alami',
        volumeQuantity: 400,
      }),
    ).toBe('Lighting Rotan alami — 400 pcs');
  });

  test('keduanya kosong → teks cadangan', () => {
    expect(
      buildInquirySubject({ categoryLabel: null, materialLabel: null, volumeQuantity: 1 }),
    ).toBe('Permintaan produk — 1 pcs');
  });
});

describe('parseTargetShipDate (Q10, §6.5)', () => {
  test.each([
    ['2026-11-17', '2026-11-17'],
    ['2026-11', '2026-11-01'],
    ['Nov 2026', '2026-11-01'],
    ['November 2026', '2026-11-01'],
    ['november 2026', '2026-11-01'],
    ['Nopember 2026', '2026-11-01'],
    ['Agustus 2026', '2026-08-01'],
    ['Q3 2026', '2026-07-01'],
    ['q1 2027', '2027-01-01'],
    ['Q4-2026', '2026-10-01'],
    ['  Nov 2026  ', '2026-11-01'],
  ])('"%s" → %s', (input, expected) => {
    expect(parseTargetShipDate(input)).toBe(expected);
  });

  test.each([
    ['ASAP'],
    ['Flexible / ASAP'],
    ['Early next month'],
    ['secepatnya'],
    ['2026'],
    ['2026-13'],
    ['2026-02-31'],
    ['Smarch 2026'],
    [''],
    ['   '],
  ])('"%s" → null', (input) => {
    expect(parseTargetShipDate(input)).toBeNull();
  });

  test('null/undefined aman', () => {
    expect(parseTargetShipDate(null)).toBeNull();
    expect(parseTargetShipDate(undefined)).toBeNull();
  });

  test('awal kuartal, bukan akhir', () => {
    expect(parseTargetShipDate('Q2 2026')).toBe('2026-04-01');
  });
});

describe('publicInquiryInputSchema', () => {
  const valid = { name: 'Erik', email: 'erik@nordhem.se', volumeQuantity: 400 };

  test('menerima minimal nama, email, volume', () => {
    expect(publicInquiryInputSchema.safeParse(valid).success).toBe(true);
  });

  test('menolak field tak dikenal (strictObject, §1.3)', () => {
    const result = publicInquiryInputSchema.safeParse({ ...valid, status: 'DONE' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  test.each(['name', 'email', 'volumeQuantity'])('%s wajib', (field) => {
    // Bangun ulang tanpa `field` alih-alih `delete` dinamis (aturan lint).
    const body = Object.fromEntries(Object.entries(valid).filter(([key]) => key !== field));
    const result = publicInquiryInputSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });

  test('volume minimal 1', () => {
    const result = publicInquiryInputSchema.safeParse({ ...valid, volumeQuantity: 0 });
    expect(result.error?.issues[0]?.code).toBe('too_small');
  });

  test('lampiran maksimal 3 dan harus unik', () => {
    expect(
      publicInquiryInputSchema.safeParse({ ...valid, attachmentUploadIds: ['a', 'b', 'c', 'd'] })
        .success,
    ).toBe(false);
    expect(
      publicInquiryInputSchema.safeParse({ ...valid, attachmentUploadIds: ['a', 'a'] }).success,
    ).toBe(false);
    expect(
      publicInquiryInputSchema.safeParse({
        ...valid,
        attachmentUploadIds: Array.from(
          { length: INQUIRY_ATTACHMENTS_MAX },
          (_, i) => `u${String(i)}`,
        ),
      }).success,
    ).toBe(true);
  });

  test('honeypot `website` diterima skema; penolakannya bukan 400 (A6)', () => {
    expect(publicInquiryInputSchema.safeParse({ ...valid, website: 'http://spam' }).success).toBe(
      true,
    );
  });
});

describe('isHoneypotFilled', () => {
  test('kosong, spasi, dan absen dianggap kosong', () => {
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled('')).toBe(false);
    expect(isHoneypotFilled('   ')).toBe(false);
  });

  test('isi apa pun dianggap bot', () => {
    expect(isHoneypotFilled('http://spam.example')).toBe(true);
  });
});
