/**
 * Penyimpanan inquiry publik (kontrak §5.4, model §3.7 & §6.5).
 *
 * Dipisah dari rute supaya aturan yang mudah salah terkumpul di satu tempat:
 * nomor referensi, subjek turunan, salinan label kategori/material, dan
 * pemisahan tegas antara apa yang datang dari pengunjung dan apa yang diisi
 * server.
 */

import {
  buildInquirySubject,
  formatInquiryReference,
  parseTargetShipDate,
  type PublicInquiryInput,
} from '@ornament/shared';

import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, validationFailed } from '../../../lib/errors.js';
import type { EmailSender } from '../../email/sender.js';
import type { ClientIdentity } from '../client-identity.js';

/** Hasil yang boleh dilihat pemanggil publik: **hanya** referensi (§4). */
export interface StoredInquiry {
  id: string;
  reference: string;
  /** Subjek turunan (§6.5); dipakai notifikasi tim tanpa menghitung ulang. */
  subject: string;
}

/** `null`/absen dinormalkan menjadi `null`; string kosong juga (form mengirim `""`). */
function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Label kategori & material: id divalidasi ke baris yang benar-benar ada, lalu
 * **namanya disalin** (`categoryLabel`/`materialLabel`, model §3.7). Salinan itu
 * yang membuat inquiry lama tetap terbaca setelah taksonomi diganti nama atau
 * dihapus (relasinya `SetNull`).
 *
 * Id tak dikenal → `400 VALIDATION_FAILED` dengan `code: "not_found"` per field
 * (kontrak §5.4), bukan `404`: yang salah adalah isi body, bukan rutenya.
 */
async function resolveTaxonomy(
  prisma: PrismaClient,
  input: PublicInquiryInput,
): Promise<{ categoryLabel: string | null; materialLabel: string | null }> {
  const [category, material] = await Promise.all([
    input.categoryId === null || input.categoryId === undefined
      ? null
      : prisma.category.findUnique({ where: { id: input.categoryId }, select: { name: true } }),
    input.materialId === null || input.materialId === undefined
      ? null
      : prisma.material.findUnique({ where: { id: input.materialId }, select: { name: true } }),
  ]);

  const details = [];
  if (input.categoryId != null && category === null) {
    details.push({ path: 'categoryId', code: 'not_found', message: 'Kategori tidak dikenal.' });
  }
  if (input.materialId != null && material === null) {
    details.push({ path: 'materialId', code: 'not_found', message: 'Material tidak dikenal.' });
  }
  if (details.length > 0) throw validationFailed(details);

  return { categoryLabel: category?.name ?? null, materialLabel: material?.name ?? null };
}

/**
 * Lampiran (A5) belum bisa diklaim: modul presign R2 ditunda ke Tahap 7
 * (lihat `routes.ts`), jadi tidak ada `uploadId` yang pernah diterbitkan API
 * ini. Konsekuensi yang benar menurut kontrak §5.4 adalah
 * `422 UPLOAD_INVALID` dengan `reason: "NOT_FOUND"` — persis jawaban untuk
 * upload yang tidak ada atau sudah kedaluwarsa — bukan `500` dan bukan diam-diam
 * menyimpan inquiry tanpa lampiran yang dikira pengunjung sudah terkirim.
 */
function rejectUnknownAttachments(input: PublicInquiryInput): void {
  const uploadId = input.attachmentUploadIds?.[0];
  if (uploadId === undefined) return;
  throw new AppError('UPLOAD_INVALID', 'Lampiran tidak ditemukan atau sudah kedaluwarsa.', {
    details: { reason: 'NOT_FOUND', uploadId },
  });
}

/**
 * Menyimpan inquiry + `ActivityLog` dalam satu transaksi (model §6.9).
 *
 * `number` diambil dari sequence kolomnya lebih dulu (`nextval`), sehingga
 * `reference` bisa ikut di-`INSERT` yang sama alih-alih diisi lewat `UPDATE`
 * susulan — tidak pernah ada baris yang sempat punya referensi sementara.
 * Sequence sengaja tidak transaksional: rollback meninggalkan lubang nomor,
 * dan itu memang yang diinginkan (nomor tidak pernah dipakai dua kali).
 */
export async function createInquiry(
  prisma: PrismaClient,
  input: PublicInquiryInput,
  identity: ClientIdentity,
): Promise<StoredInquiry> {
  rejectUnknownAttachments(input);
  const { categoryLabel, materialLabel } = await resolveTaxonomy(prisma, input);

  const subject = buildInquirySubject({
    categoryLabel,
    materialLabel,
    volumeQuantity: input.volumeQuantity,
  });
  const targetShipText = optionalText(input.targetShipText);
  const targetShipDate = parseTargetShipDate(targetShipText);

  return prisma.$transaction(async (tx) => {
    const [seq] = await tx.$queryRaw<{ number: number }[]>`
      SELECT nextval(pg_get_serial_sequence('inquiry', 'number'))::int AS number
    `;
    /* c8 ignore next */
    if (seq === undefined) throw new Error('Sequence nomor inquiry tidak mengembalikan nilai.');
    const reference = formatInquiryReference(seq.number);

    const inquiry = await tx.inquiry.create({
      data: {
        // ── Diisi server (kontrak §5.4) ───────────────────────────────────
        number: seq.number,
        reference,
        subject,
        status: 'NEW',
        categoryLabel,
        materialLabel,
        // `@db.Date`: tanggal kalender tanpa zona waktu, jadi tengah malam UTC.
        targetShipDate: targetShipDate === null ? null : new Date(`${targetShipDate}T00:00:00Z`),
        // 🔒 Hash, bukan IP mentah (model §6.11).
        ipHash: identity.ipHash,
        userAgent: identity.userAgent,

        // ── Dari pengunjung ───────────────────────────────────────────────
        name: input.name,
        company: optionalText(input.company),
        email: input.email,
        country: optionalText(input.country),
        categoryId: input.categoryId ?? null,
        materialId: input.materialId ?? null,
        volumeQuantity: input.volumeQuantity,
        targetShipText,
        destinationPort: optionalText(input.destinationPort),
        budgetPerUnitUsd: input.budgetPerUnitUsd ?? null,
        message: optionalText(input.message),
      },
      select: { id: true, reference: true, subject: true },
    });

    await tx.activityLog.create({
      data: {
        kind: 'INQUIRY',
        action: 'inquiry.created',
        // Tanpa nama/email pengirim: feed aktivitas terbaca Editor, sedangkan
        // isi inquiry 🔒 (§4). Referensi + subjek sudah cukup untuk menautkan.
        message: `Inquiry ${inquiry.reference} masuk — ${subject}`,
        // Submit publik tidak punya aktor (§3.8: null = "Sistem").
        actorId: null,
        entityType: 'Inquiry',
        entityId: inquiry.id,
      },
      select: { id: true },
    });

    return inquiry;
  });
}

/**
 * Notifikasi tim, **setelah** commit (ADR K4, kontrak §5.4).
 *
 * Kegagalan apa pun — termasuk pengirim yang melempar dan `SiteSetting` yang
 * belum ada — hanya tercatat di `notificationError`. Inquiry-nya sudah
 * tersimpan dan responsnya sudah ditentukan, jadi kegagalan email tidak pernah
 * menjadi 5xx (kontrak §1.10).
 */
export async function notifyInquiry(
  prisma: PrismaClient,
  sender: EmailSender,
  inquiry: { id: string; reference: string },
  subject: string,
): Promise<void> {
  let result: { sentAt: Date | null; messageId: string | null; error: string | null };
  try {
    const settings = await prisma.siteSetting.findUnique({
      where: { id: 1 },
      select: { contactEmail: true },
    });
    result =
      settings === null
        ? { sentAt: null, messageId: null, error: 'CONTACT_EMAIL_NOT_SET' }
        : await sender.sendInquiryNotification({
            to: settings.contactEmail,
            reference: inquiry.reference,
            subject,
          });
  } catch (error) {
    result = {
      sentAt: null,
      messageId: null,
      error: error instanceof Error ? error.name : 'SEND_FAILED',
    };
  }

  const data: Prisma.InquiryUpdateInput = {
    notificationMessageId: result.messageId,
    notificationError: result.error,
  };
  await prisma.inquiry.update({ where: { id: inquiry.id }, data, select: { id: true } });
}
