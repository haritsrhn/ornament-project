import { describe, expect, test } from 'vitest';

import { redactUrl, REDACT_PATHS } from '../../src/plugins/logger.js';

/**
 * Token undangan setara kredensial: yang membacanya bisa menerima undangan
 * orang lain. Ia ada di **path**, jadi `redact` pino (header/body) tidak
 * menjangkaunya dan harus disensor di serializer `req`.
 */
describe('penyensoran URL di log', () => {
  test('token undangan di path tidak pernah masuk log', () => {
    expect(redactUrl('/v1/admin/auth/invites/KWIJeWyECuvIwW06cqetiIugsPou9sRrPrnZ-DtAoOU')).toBe(
      '/v1/admin/auth/invites/[REDACTED]',
    );
    expect(redactUrl('/v1/admin/auth/invites/abc?next=/admin')).toBe(
      '/v1/admin/auth/invites/[REDACTED]?next=/admin',
    );
  });

  test('URL lain tidak diubah — termasuk `.../accept`, yang tokennya ada di body', () => {
    for (const url of [
      '/v1/admin/auth/invites/accept',
      '/v1/admin/users?q=rani',
      '/v1/admin/users/8a1f9b6e-0000-4000-8000-000000000000',
      '/v1/health',
    ]) {
      expect(redactUrl(url)).toBe(url);
    }
  });

  test('kata sandi tetap disensor lewat path redact pino', () => {
    expect(REDACT_PATHS).toContain('*.currentPassword');
    expect(REDACT_PATHS).toContain('*.newPassword');
    expect(REDACT_PATHS).toContain('req.headers.cookie');
  });
});
