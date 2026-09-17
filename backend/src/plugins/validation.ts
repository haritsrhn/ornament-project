import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { z } from 'zod';

/**
 * Validasi request & serialisasi respons dengan skema Zod
 * (`fastify-type-provider-zod`, ADR K5/K6).
 *
 * - Pesan issue bawaan Zod memakai locale Indonesia (kontrak §1.5: `message`
 *   berbahasa Indonesia). Skema boleh menimpa pesan per aturan.
 * - Zod `z.object` membuang field tak dikenal secara diam-diam; kontrak §1.3
 *   mensyaratkan penolakan, jadi skema **body** wajib memakai `z.strictObject`
 *   (atau `.strict()`), yang menghasilkan issue `unrecognized_keys`.
 * - Hanya parser `application/json` yang dipertahankan: body non-JSON ditolak
 *   `415 UNSUPPORTED_MEDIA_TYPE` (kontrak §1.2).
 */
export function registerValidation(app: FastifyInstance): void {
  z.config(z.locales.id());
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.removeContentTypeParser('text/plain');
}
