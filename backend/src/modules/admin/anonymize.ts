/**
 * Anonimisasi data pribadi (model §6.11) — dipakai bersama modul komentar dan
 * inquiry.
 *
 * Satu berkas karena permintaan "hapus data saya" tidak mengenal batas modul:
 * `sameEmail` dari layar komentar harus menyapu inquiry orang yang sama, dan
 * sebaliknya. Dua implementasi berarti dua definisi "bersih", dan yang satu
 * pasti akan tertinggal saat kolom baru ditambahkan.
 *
 * Seluruhnya **idempoten**: setiap field ditulis ke nilai tetap, jadi
 * menjalankannya dua kali menghasilkan keadaan yang sama.
 */

import { ANONYMIZED_COMMENT_AUTHOR } from '@ornament/shared';

import { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Nama pengganti inquiry (model §6.11). */
export const ANONYMIZED_INQUIRY_NAME = 'Dianonimkan';

export async function anonymizeCommentRows(tx: Tx, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const now = new Date();

  // Komentar yang tidak tayang kehilangan `body` juga: isinya tidak pernah
  // dibaca publik, jadi menyimpannya hanya menahan data yang diminta hilang.
  const hidden = await tx.comment.updateMany({
    where: { id: { in: [...ids] }, status: { not: 'APPROVED' } },
    data: {
      authorName: ANONYMIZED_COMMENT_AUTHOR,
      authorEmail: null,
      ipHash: null,
      userAgent: null,
      body: '',
      anonymizedAt: now,
    },
  });
  const visible = await tx.comment.updateMany({
    where: { id: { in: [...ids] }, status: 'APPROVED' },
    data: {
      authorName: ANONYMIZED_COMMENT_AUTHOR,
      authorEmail: null,
      ipHash: null,
      userAgent: null,
      anonymizedAt: now,
    },
  });

  await genericizeActivityLog(tx, 'Comment', ids, 'Komentar (dianonimkan)');
  return hidden.count + visible.count;
}

/**
 * Anonimisasi inquiry menyertai komentar hanya pada `sameEmail` (hak GDPR
 * untuk dihapus): satu orang yang meminta datanya hilang tidak seharusnya
 * perlu mengajukannya dua kali untuk dua modul.
 */
export async function anonymizeInquiryRows(
  tx: Tx,
  ids: readonly string[],
  purgedKeys: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const now = new Date();

  const attachments = await tx.inquiryAttachment.findMany({
    where: { inquiryId: { in: [...ids] } },
    select: { id: true, mediaId: true, media: { select: { key: true } } },
  });
  if (attachments.length > 0) {
    await tx.inquiryAttachment.deleteMany({
      where: { id: { in: attachments.map((row) => row.id) } },
    });
    // Lampiran dibuat pengunjung dan hanya berarti bagi inquiry itu, jadi
    // Media-nya ikut hilang permanen — bukan sekadar masuk Trash.
    await tx.media.deleteMany({ where: { id: { in: attachments.map((row) => row.mediaId) } } });
    for (const row of attachments) purgedKeys.push(row.media.key);
  }

  await tx.inquiryReply.updateMany({
    where: { inquiryId: { in: [...ids] } },
    data: { toEmail: null, body: null },
  });

  const updated = await tx.inquiry.updateMany({
    where: { id: { in: [...ids] } },
    // Yang dipertahankan untuk laporan (§6.11): `number`, `reference`,
    // `subject`, `country`, kategori/material, volume, anggaran, tanggal.
    data: {
      name: ANONYMIZED_INQUIRY_NAME,
      email: null,
      company: null,
      message: null,
      destinationPort: null,
      targetShipText: null,
      ipHash: null,
      userAgent: null,
      notificationError: null,
      anonymizedAt: now,
    },
  });

  await genericizeActivityLog(tx, 'Inquiry', ids, 'Inquiry (dianonimkan)');
  return updated.count;
}

/**
 * Jejak audit tetap ada, isinya tidak: `message` log lama memuat nama dan
 * kutipan isi, yang berarti anonimisasi tanpa langkah ini hanya memindahkan
 * data pribadi ke tabel lain.
 */
export async function genericizeActivityLog(
  tx: Tx,
  entityType: string,
  ids: readonly string[],
  message: string,
): Promise<void> {
  await tx.activityLog.updateMany({
    where: { entityType, entityId: { in: [...ids] } },
    data: { message, metadata: Prisma.DbNull },
  });
}
