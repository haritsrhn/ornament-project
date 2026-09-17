import { describe, expect, test } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

function captureEnvError(source: NodeJS.ProcessEnv): EnvValidationError {
  try {
    loadEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err;
    throw err;
  }
  throw new Error('loadEnv seharusnya melempar EnvValidationError');
}

describe('loadEnv', () => {
  test('mengisi default untuk variabel server', () => {
    const env = loadEnv({ DATABASE_URL });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
    });
    expect(env.INTERNAL_API_KEY).toBeUndefined();
  });

  test('mengonversi PORT ke angka dan menerima nilai eksplisit', () => {
    const env = loadEnv({ DATABASE_URL, PORT: '8080', NODE_ENV: 'test', LOG_LEVEL: 'silent' });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('silent');
  });

  test('menerima skema postgres:// maupun postgresql://', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://u:p@h/db' }).DATABASE_URL).toBe(
      'postgres://u:p@h/db',
    );
  });

  test('DATABASE_URL wajib', () => {
    const error = captureEnvError({});
    expect(error.issues).toEqual(['DATABASE_URL: wajib diisi']);
    expect(error.message).toContain('DATABASE_URL: wajib diisi');
  });

  test('DATABASE_URL kosong ditolak', () => {
    expect(captureEnvError({ DATABASE_URL: '' }).issues).toContain('DATABASE_URL: wajib diisi');
  });

  test('DATABASE_URL harus URL postgresql', () => {
    expect(captureEnvError({ DATABASE_URL: 'mysql://localhost/db' }).issues).toEqual([
      'DATABASE_URL: harus URL postgresql://',
    ]);
  });

  test('melaporkan semua variabel yang salah sekaligus', () => {
    const error = captureEnvError({
      PORT: '70000',
      NODE_ENV: 'staging',
      ADMIN_ORIGIN: 'bukan-url',
    });
    const names = error.issues.map((issue) => issue.split(':', 1)[0]);
    expect(names).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'PORT', 'NODE_ENV', 'ADMIN_ORIGIN']),
    );
    expect(names).toHaveLength(4);
  });

  test('variabel opsional kosong dianggap tidak di-set', () => {
    const env = loadEnv({ DATABASE_URL, ADMIN_ORIGIN: '', INTERNAL_API_KEY: '' });
    expect(env.ADMIN_ORIGIN).toBeUndefined();
    expect(env.INTERNAL_API_KEY).toBeUndefined();
  });

  test('rahasia pendek ditolak di production tanpa membocorkan nilainya', () => {
    const secret = 'rahasia-pendek-123';
    const error = captureEnvError({
      DATABASE_URL,
      NODE_ENV: 'production',
      INTERNAL_API_KEY: secret,
      INTERNAL_JOB_TOKEN: `${secret}-job`,
      REVALIDATE_SECRET: `${secret}-reval`,
    });
    expect(error.issues).toEqual([
      'INTERNAL_API_KEY: minimal 32 karakter di production',
      'INTERNAL_JOB_TOKEN: minimal 32 karakter di production',
      'REVALIDATE_SECRET: minimal 32 karakter di production',
    ]);
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });

  test('rahasia pendek diizinkan di luar production', () => {
    expect(loadEnv({ DATABASE_URL, INTERNAL_API_KEY: 'pendek' }).INTERNAL_API_KEY).toBe('pendek');
  });

  test('rahasia 32 karakter diterima di production', () => {
    const secret = 'x'.repeat(32);
    const env = loadEnv({ DATABASE_URL, NODE_ENV: 'production', INTERNAL_API_KEY: secret });
    expect(env.INTERNAL_API_KEY).toBe(secret);
  });

  test('pesan error tidak memuat nilai DATABASE_URL yang salah', () => {
    const value = 'mysql://admin:sandi-super-rahasia@db/prod';
    const error = captureEnvError({ DATABASE_URL: value });
    expect(error.name).toBe('EnvValidationError');
    expect(error.message).not.toContain('sandi-super-rahasia');
  });
});
