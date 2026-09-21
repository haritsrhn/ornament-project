import { describe, expect, test } from 'vitest';

import {
  adminArtisanSchema,
  artisanDocumentInputSchema,
  artisanInputSchema,
  artisanRedactedSchema,
  updateArtisanBodySchema,
  updateArtisanDocumentBodySchema,
  ARTISAN_DOCUMENT_KINDS,
  ARTISAN_PRIVATE_FIELDS,
  type ArtisanInputRaw,
} from '../src/index.js';

/**
 * Kontrak admin pengrajin (§5.8). Fokusnya pada dua hal yang paling mudah
 * bocor: bentuk input 🔒 dan jaminan bahwa `ArtisanRedacted` benar-benar
 * **tidak memuat** field privat (kontrak §3.1/§4).
 */

const UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const UPDATED_AT = '2026-09-20T03:15:00.000Z';

const base: ArtisanInputRaw = {
  name: 'Anyam Bangunjiwo',
  regency: 'Bantul',
  province: 'DI Yogyakarta',
  skills: ['anyaman rotan'],
};

describe('artisanInputSchema', () => {
  test('menerima body minimal', () => {
    expect(artisanInputSchema.safeParse(base).success).toBe(true);
  });

  test('regency, province, dan minimal satu skill wajib', () => {
    expect(artisanInputSchema.safeParse({ ...base, skills: [] }).success).toBe(false);
    expect(artisanInputSchema.safeParse({ ...base, regency: '  ' }).success).toBe(false);
    expect(artisanInputSchema.safeParse({ ...base, province: '' }).success).toBe(false);
  });

  test('menolak field tak dikenal dan field turunan (status, archivedAt)', () => {
    for (const extra of [
      { status: 'ACTIVE' },
      { archivedAt: UPDATED_AT },
      { productCount: 3 },
      { documents: [] },
    ]) {
      expect(artisanInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  test('telepon dinormalisasi ke E.164; format lain ditolak', () => {
    const parsed = artisanInputSchema.safeParse({ ...base, phone: ' +62 812-3456-789 ' });
    expect(parsed.success && parsed.data.phone).toBe('+628123456789');

    for (const phone of ['08123456789', '+0812345678', 'telepon', '+62']) {
      expect(artisanInputSchema.safeParse({ ...base, phone }).success).toBe(false);
    }
  });

  test('galeri tidak boleh memuat media yang sama dua kali', () => {
    const images = [{ mediaId: UUID }, { mediaId: UUID }];
    const parsed = artisanInputSchema.safeParse({ ...base, images });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['images']);
  });
});

describe('updateArtisanBodySchema', () => {
  test('expectedUpdatedAt wajib (§1.9) dan status boleh diubah di PATCH', () => {
    expect(updateArtisanBodySchema.safeParse({ name: 'Baru' }).success).toBe(false);
    expect(
      updateArtisanBodySchema.safeParse({
        status: 'ACTIVE',
        expectedUpdatedAt: UPDATED_AT,
      }).success,
    ).toBe(true);
  });
});

describe('ArtisanRedacted', () => {
  const full = {
    id: UUID,
    name: 'Anyam Bangunjiwo',
    slug: 'anyam-bangunjiwo',
    partnerSinceYear: 2018,
    village: 'Bangunjiwo',
    regency: 'Bantul',
    province: 'DI Yogyakarta',
    craftsmenCount: 8,
    monthlyCapacity: 600,
    capacityUnit: 'pcs',
    avgLeadTimeDays: 45,
    skills: ['anyaman rotan'],
    summary: 'Workshop keluarga.',
    story: null,
    status: 'ACTIVE',
    archivedAt: null,
    photo: null,
    images: [],
    productCount: 16,
    publishedProductCount: 14,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    contactName: 'Pak Rahasia',
    phone: '+628123456789',
    address: 'Jl. Rahasia No. 1',
    internalNotes: 'Catatan negosiasi.',
  };

  test('empat field 🔒 dihapus, bukan dijadikan null (kontrak §5.8)', () => {
    const redacted = artisanRedactedSchema.parse(full);
    for (const field of ARTISAN_PRIVATE_FIELDS) {
      expect(field in redacted).toBe(false);
    }
    expect(adminArtisanSchema.parse(full).phone).toBe('+628123456789');
  });

  test('bentuk publik-aman tetap memuat data profil yang dibutuhkan Contributor', () => {
    const redacted = artisanRedactedSchema.parse(full);
    expect(redacted.regency).toBe('Bantul');
    expect(redacted.publishedProductCount).toBe(14);
  });
});

describe('dokumen pengrajin 🔒', () => {
  test('kind mengikuti keputusan #49/#50', () => {
    expect([...ARTISAN_DOCUMENT_KINDS]).toEqual([
      'CONTRACT',
      'IDENTITY',
      'BANK_ACCOUNT',
      'MATERIAL_ORIGIN',
      'OTHER',
    ]);
  });

  test('input dokumen menolak kind tak dikenal, judul kosong, dan field tambahan', () => {
    expect(
      artisanDocumentInputSchema.safeParse({ mediaId: UUID, kind: 'IDENTITY', title: 'KTP' })
        .success,
    ).toBe(true);
    expect(
      artisanDocumentInputSchema.safeParse({ mediaId: UUID, kind: 'NPWP', title: 'X' }).success,
    ).toBe(false);
    expect(
      artisanDocumentInputSchema.safeParse({ mediaId: UUID, kind: 'OTHER', title: ' ' }).success,
    ).toBe(false);
    expect(
      artisanDocumentInputSchema.safeParse({
        mediaId: UUID,
        kind: 'OTHER',
        title: 'X',
        visibility: 'PUBLIC',
      }).success,
    ).toBe(false);
  });

  test('PATCH dokumen butuh minimal satu field', () => {
    expect(updateArtisanDocumentBodySchema.safeParse({}).success).toBe(false);
    expect(updateArtisanDocumentBodySchema.safeParse({ title: 'Kontrak 2026' }).success).toBe(true);
  });
});
