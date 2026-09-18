import { describe, expect, test } from 'vitest';

import {
  EMAIL_DOMAIN_ISSUE_CODE,
  isOrnamentEmail,
  loginBodySchema,
  meSchema,
  normalizeEmail,
  PERMISSIONS,
  permissionsForRole,
  ROLE_PERMISSIONS,
  roleHasPermission,
  SESSION_COOKIE_NAME,
  USER_ROLES,
} from '../src/index.js';

describe('email @ornament.id', () => {
  test('normalisasi membuang spasi dan huruf besar', () => {
    expect(normalizeEmail('  RANI@Ornament.ID ')).toBe('rani@ornament.id');
  });

  test('hanya domain ornament.id yang diterima', () => {
    expect(isOrnamentEmail('rani@ornament.id')).toBe(true);
    expect(isOrnamentEmail('RANI@ORNAMENT.ID')).toBe(true);
    expect(isOrnamentEmail('rani@ornament.co.id')).toBe(false);
    expect(isOrnamentEmail('rani@gmail.com')).toBe(false);
    // Bukan subdomain: harus persis berakhiran @ornament.id.
    expect(isOrnamentEmail('rani@mail.ornament.id')).toBe(false);
  });
});

describe('loginBodySchema', () => {
  test('menormalisasi email dan memberi default rememberMe', () => {
    const parsed = loginBodySchema.parse({ email: ' Rani@Ornament.ID ', password: 'a'.repeat(8) });
    expect(parsed).toEqual({
      email: 'rani@ornament.id',
      password: 'a'.repeat(8),
      rememberMe: false,
    });
  });

  test('email di luar domain memakai kode issue email_domain', () => {
    const result = loginBodySchema.safeParse({ email: 'rani@gmail.com', password: 'a'.repeat(8) });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.code).toBe('custom');
    expect(issue?.path).toEqual(['email']);
    expect((issue as { params?: { code?: string } } | undefined)?.params?.code).toBe(
      EMAIL_DOMAIN_ISSUE_CODE,
    );
  });

  test('kata sandi 8–128 karakter', () => {
    const ok = (password: string) =>
      loginBodySchema.safeParse({ email: 'rani@ornament.id', password }).success;
    expect(ok('a'.repeat(7))).toBe(false);
    expect(ok('a'.repeat(8))).toBe(true);
    expect(ok('a'.repeat(128))).toBe(true);
    expect(ok('a'.repeat(129))).toBe(false);
  });

  test('menolak field tak dikenal (kontrak §1.3)', () => {
    const result = loginBodySchema.safeParse({
      email: 'rani@ornament.id',
      password: 'a'.repeat(8),
      isAdmin: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('permissions per peran (kontrak §3)', () => {
  test('setiap peran punya daftar izin dan tidak ada kode di luar katalog', () => {
    for (const role of USER_ROLES) {
      const granted = ROLE_PERMISSIONS[role];
      expect(granted.length).toBeGreaterThan(0);
      for (const permission of granted) expect(PERMISSIONS).toContain(permission);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  test('Administrator memiliki seluruh katalog', () => {
    expect(permissionsForRole('ADMINISTRATOR')).toEqual([...PERMISSIONS]);
  });

  test('Editor tidak boleh hapus permanen, kelola pengguna, atau ubah pengaturan', () => {
    for (const permission of [
      'product.purge',
      'article.purge',
      'media.purge',
      'page.purge',
      'privacy.anonymize',
      'user.manage',
      'settings.manage',
      'cache.revalidate',
    ] as const) {
      expect(roleHasPermission('EDITOR', permission)).toBe(false);
    }
    expect(roleHasPermission('EDITOR', 'product.publish')).toBe(true);
    expect(roleHasPermission('EDITOR', 'comment.moderate')).toBe(true);
  });

  test('Contributor hanya draf, media upload, dan baca halaman', () => {
    expect(permissionsForRole('CONTRIBUTOR')).toEqual([
      'product.write_draft',
      'product.trash',
      'product.restore',
      'article.write_draft',
      'article.restore',
      'media.upload',
      'page.read',
    ]);
    expect(roleHasPermission('CONTRIBUTOR', 'product.publish')).toBe(false);
    expect(roleHasPermission('CONTRIBUTOR', 'artisan.read_private')).toBe(false);
  });

  test('urutan izin stabil (mengikuti katalog)', () => {
    const editor = permissionsForRole('EDITOR');
    const positions = editor.map((permission) => PERMISSIONS.indexOf(permission));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('meSchema', () => {
  const me = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'rani@ornament.id',
    name: 'Rani Prasetyo',
    role: 'ADMINISTRATOR',
    avatar: null,
    lastActiveAt: '2026-09-18T03:00:00.000Z',
    permissions: ['user.manage'],
  };

  test('menerima bentuk kontrak §2.2', () => {
    expect(meSchema.parse(me)).toEqual(me);
  });

  test('lastActiveAt harus ISO atau null; permissions harus dari katalog', () => {
    expect(meSchema.safeParse({ ...me, lastActiveAt: 'kemarin' }).success).toBe(false);
    expect(meSchema.safeParse({ ...me, lastActiveAt: null }).success).toBe(true);
    expect(meSchema.safeParse({ ...me, permissions: ['product.launch'] }).success).toBe(false);
  });
});

describe('cookie sesi', () => {
  test('nama memakai prefiks __Host- (ADR K7)', () => {
    expect(SESSION_COOKIE_NAME).toBe('__Host-osa_session');
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
  });
});
