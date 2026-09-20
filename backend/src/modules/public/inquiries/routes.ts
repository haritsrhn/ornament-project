/**
 * Inquiry publik — kontrak §5.4 (`POST /v1/public/inquiry-uploads`,
 * `POST /v1/public/inquiries`).
 *
 * Keduanya rute **tulis** publik: `X-Internal-Key` wajib (A9, ditegakkan
 * `registerPublicGuard` lewat `publicWriteAccess`), `Cache-Control: no-store`,
 * rate limit per `ipHash` (§2.3), honeypot (A6), dan — untuk submit —
 * `Idempotency-Key` (§1.8).
 *
 * Respons submit **hanya** `{ reference }`: tidak ada endpoint baca publik
 * untuk inquiry dan seluruh isinya 🔒 (kontrak §4).
 */

import {
  idempotencyHeadersSchema,
  publicInquiryInputSchema,
  publicInquirySubmitResponseSchema,
  publicInquiryUploadInputSchema,
  publicInquiryUploadResponseSchema,
  formatInquiryReference,
  INQUIRY_UPLOAD_MAX_BYTES,
  INQUIRY_UPLOAD_MIME_TYPES,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { AppError } from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import type { EmailSender } from '../../email/sender.js';
import { readClientIdentity, type ClientIdentity } from '../client-identity.js';
import { publicWriteAccess } from '../guard.js';
import { handlePublicSubmit } from '../submit.js';
import { enforceSubmitThrottles, type PublicSubmitThrottles } from '../submit-throttle.js';
import { createInquiry, notifyInquiry } from './service.js';

export interface PublicInquiriesRoutesOptions {
  /** Rahasia `ipHash` = `INTERNAL_API_KEY`; lihat `client-identity.ts`. */
  internalApiKey?: string | undefined;
  throttles: PublicSubmitThrottles;
  emailSender: EmailSender;
}

/** Kunci idempotensi diberi ruang nama per rute (§1.8: `key + method + route`). */
const INQUIRY_SCOPE = 'POST /v1/public/inquiries';

/**
 * Referensi palsu untuk respons honeypot (A6). Dibuat dari angka acak dengan
 * bentuk yang sama seperti referensi asli, sehingga bot tidak bisa membedakan
 * submit yang ditolak dari yang diterima.
 */
function fakeReference(): string {
  return formatInquiryReference(1 + Math.floor(Math.random() * 9999));
}

export const publicInquiriesRoutes: FastifyPluginAsyncZod<PublicInquiriesRoutesOptions> = (
  app,
  options,
) => {
  /**
   * Tanpa `INTERNAL_API_KEY` tidak ada request yang pernah lolos guard tulis
   * (`registerPublicGuard` menolak semuanya `401`), jadi handler tidak pernah
   * berjalan. Nilai pengganti ini hanya menjaga tipe tetap non-opsional.
   */
  const ipHashSecret = options.internalApiKey ?? '';

  app.post(
    '/public/inquiry-uploads',
    {
      config: publicWriteAccess('Presign lampiran inquiry dari pengunjung (A5).'),
      schema: {
        body: publicInquiryUploadInputSchema,
        response: { 201: publicInquiryUploadResponseSchema },
      },
    },
    (request) => {
      const identity: ClientIdentity = readClientIdentity(request, ipHashSecret);
      enforceSubmitThrottles([options.throttles.uploadBurst], identity.ipHash);

      const { mimeType, sizeBytes } = request.body;
      // Urutan §1.10: jenis berkas dulu, baru ukurannya.
      if (!(INQUIRY_UPLOAD_MIME_TYPES as readonly string[]).includes(mimeType)) {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          `Jenis berkas harus salah satu dari ${INQUIRY_UPLOAD_MIME_TYPES.join(', ')}.`,
        );
      }
      if (sizeBytes > INQUIRY_UPLOAD_MAX_BYTES) {
        throw new AppError('PAYLOAD_TOO_LARGE', 'Ukuran berkas melebihi 10 MB.');
      }

      /**
       * Presign R2 ditunda ke **Tahap 7 (Media)**, dan itu keputusan sadar:
       * menandatangani `PUT` SigV4 membutuhkan `@aws-sdk/client-s3` +
       * `s3-request-presigner` yang belum ada di dependensi, sementara
       * `R2_*` juga belum terisi sehingga hasilnya tidak bisa diverifikasi
       * terhadap R2 sungguhan. Menuliskan SigV4 sendiri "sambil lalu", tanpa
       * bucket untuk mengujinya, adalah kode kripto yang tidak pernah terbukti
       * benar — risiko yang tidak sebanding dengan fitur yang bisa ditunda.
       *
       * Yang **sudah** berlaku di sini adalah seluruh kontrak di sekelilingnya:
       * key internal wajib, rate limit 15/jam per `ipHash`, allowlist MIME
       * (`415`), dan batas 10 MB (`413`). Yang tersisa hanyalah penandatanganan
       * itu sendiri, dan itu dijawab `503 SERVICE_UNAVAILABLE` — bukan `500`,
       * dan bukan `201` dengan URL yang tidak bisa dipakai.
       *
       * Submit inquiry **tanpa** lampiran tetap berjalan penuh; submit dengan
       * `attachmentUploadIds` dijawab `422 UPLOAD_INVALID` (lihat `service.ts`).
       */
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        'Unggah lampiran belum tersedia. Kirim permintaan tanpa lampiran; tim akan meminta berkasnya lewat balasan email.',
      );
    },
  );

  app.post(
    '/public/inquiries',
    {
      config: publicWriteAccess('Submit form "Konsultasikan Proyek" dari situs publik.'),
      schema: {
        headers: idempotencyHeadersSchema,
        body: publicInquiryInputSchema,
        response: { 201: publicInquirySubmitResponseSchema },
      },
    },
    async (request, reply) => {
      await handlePublicSubmit({
        prisma: app.prisma,
        request,
        reply,
        scope: INQUIRY_SCOPE,
        ipHashSecret,
        throttles: [options.throttles.inquiryBurst, options.throttles.inquiryDaily],
        body: request.body,
        honeypot: request.body.website,
        // A6: `201` dengan referensi yang tidak pernah tersimpan.
        fakeSuccess: () => ({ statusCode: 201, body: ok({ reference: fakeReference() }) }),
        run: async (identity) => {
          const inquiry = await createInquiry(app.prisma, request.body, identity);

          // Setelah commit; gagal kirim **tidak** mengubah respons (ADR K4).
          try {
            await notifyInquiry(app.prisma, options.emailSender, inquiry, inquiry.subject);
          } catch (error) {
            request.log.warn({ err: error }, 'gagal mencatat hasil notifikasi inquiry');
          }

          return { statusCode: 201, body: ok({ reference: inquiry.reference }) };
        },
      });
    },
  );

  return Promise.resolve();
};
