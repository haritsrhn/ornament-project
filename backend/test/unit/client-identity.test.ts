import { describe, expect, test } from 'vitest';
import type { FastifyRequest } from 'fastify';

import {
  hashClientIp,
  resolveClientIp,
  resolveClientUserAgent,
  USER_AGENT_MAX_LENGTH,
} from '../../src/modules/public/client-identity.js';

/**
 * ADR K7 / kontrak §1.2: `X-Client-Ip` dan `X-Client-User-Agent` hanya
 * dipercaya bila pemanggil membawa `X-Internal-Key` yang valid. Tes ini
 * menjaga aturan itu di level fungsi, karena di level HTTP jalur "key salah"
 * sudah dihentikan `401` sebelum handler — sehingga regresi di sini tidak akan
 * terlihat dari tes rute.
 */

const SECRET = 'rahasia-internal-untuk-tes';

function fakeRequest(options: {
  trusted: boolean;
  headers?: Record<string, string | string[]>;
  ip?: string;
}): FastifyRequest {
  return {
    isTrustedInternalCaller: options.trusted,
    headers: options.headers ?? {},
    ip: options.ip ?? '10.0.0.1',
  } as unknown as FastifyRequest;
}

describe('resolveClientIp', () => {
  test('memakai X-Client-Ip bila pemanggil tepercaya', () => {
    const request = fakeRequest({ trusted: true, headers: { 'x-client-ip': '198.51.100.7' } });
    expect(resolveClientIp(request)).toBe('198.51.100.7');
  });

  test('MENGABAIKAN X-Client-Ip bila pemanggil tidak tepercaya', () => {
    const request = fakeRequest({
      trusted: false,
      headers: { 'x-client-ip': '198.51.100.7' },
      ip: '203.0.113.9',
    });
    expect(resolveClientIp(request)).toBe('203.0.113.9');
  });

  test('jatuh ke IP koneksi bila header kosong atau tidak ada', () => {
    expect(resolveClientIp(fakeRequest({ trusted: true, ip: '203.0.113.9' }))).toBe('203.0.113.9');
    expect(
      resolveClientIp(
        fakeRequest({ trusted: true, headers: { 'x-client-ip': '   ' }, ip: '203.0.113.9' }),
      ),
    ).toBe('203.0.113.9');
  });

  test('header ganda: nilai pertama yang dipakai', () => {
    const request = fakeRequest({
      trusted: true,
      headers: { 'x-client-ip': ['198.51.100.7', '1.2.3.4'] },
    });
    expect(resolveClientIp(request)).toBe('198.51.100.7');
  });
});

describe('resolveClientUserAgent', () => {
  test('X-Client-User-Agent hanya dipercaya dari pemanggil tepercaya', () => {
    const headers = { 'x-client-user-agent': 'Pengunjung/1.0', 'user-agent': 'NextServer/1.0' };
    expect(resolveClientUserAgent(fakeRequest({ trusted: true, headers }))).toBe('Pengunjung/1.0');
    expect(resolveClientUserAgent(fakeRequest({ trusted: false, headers }))).toBe('NextServer/1.0');
  });

  test('null bila tidak ada sama sekali', () => {
    expect(resolveClientUserAgent(fakeRequest({ trusted: true }))).toBeNull();
  });

  test('dipotong agar tidak menjadi vektor penyimpanan tak terbatas', () => {
    const request = fakeRequest({ trusted: true, headers: { 'user-agent': 'x'.repeat(5000) } });
    expect(resolveClientUserAgent(request)).toHaveLength(USER_AGENT_MAX_LENGTH);
  });
});

describe('hashClientIp', () => {
  test('hex SHA-256 (64 karakter) dan tidak memuat IP mentah', () => {
    const hash = hashClientIp('198.51.100.7', SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('198.51.100.7');
  });

  test('deterministik untuk IP + rahasia yang sama', () => {
    expect(hashClientIp('198.51.100.7', SECRET)).toBe(hashClientIp('198.51.100.7', SECRET));
  });

  test('IP berbeda → hash berbeda', () => {
    expect(hashClientIp('198.51.100.7', SECRET)).not.toBe(hashClientIp('198.51.100.8', SECRET));
  });

  test('ber-kunci: rahasia berbeda → hash berbeda (tabel pelangi IPv4 tidak cukup)', () => {
    expect(hashClientIp('198.51.100.7', SECRET)).not.toBe(hashClientIp('198.51.100.7', 'lain'));
  });
});
