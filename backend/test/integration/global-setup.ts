import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { resolveTestDatabaseUrl } from '../helpers/database.js';

const backendDir = path.resolve(import.meta.dirname, '../..');

/**
 * Sekali sebelum project `integration`: terapkan migrasi yang sudah di-commit ke
 * database tes (`prisma migrate deploy`). Tanpa folder migrasi pun perintah ini
 * sukses ("No pending migrations"), sekaligus membuktikan DB tes terjangkau.
 *
 * `DATABASE_URL` untuk proses anak di-set eksplisit ke DB tes; `prisma.config.ts`
 * tidak menimpa env yang sudah ada dengan isi `backend/.env`.
 */
export default function setup(): void {
  const url = resolveTestDatabaseUrl();
  try {
    execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (err) {
    const output = err as { stdout?: string; stderr?: string };
    throw new Error(
      [
        'Gagal menyiapkan database tes (prisma migrate deploy).',
        'Pastikan PostgreSQL berjalan (`npm run db:up`) dan TEST_DATABASE_URL benar.',
        output.stdout ?? '',
        output.stderr ?? '',
      ].join('\n'),
      { cause: err },
    );
  }
}
