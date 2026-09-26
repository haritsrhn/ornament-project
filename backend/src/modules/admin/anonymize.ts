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
import { collectMediaUsages } from './media/usage.js';

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
    select: { id: true, mediaId: true, replyId: true, media: { select: { key: true } } },
  });
  if (attachments.length > 0) {
    // Seluruh baris lampiran dihapus, pembeli maupun balasan (§6.11).
    await tx.inquiryAttachment.deleteMany({
      where: { id: { in: attachments.map((row) => row.id) } },
    });

    /**
     * Yang ikut **dipurge** hanyalah berkas pembeli (`replyId === null`), dan
     * hanya bila tidak ada lagi yang merujuknya.
     *
     * Lampiran balasan bukan data pembeli: ia berkas pustaka yang dipilih staf
     * — daftar harga, katalog — dan bisa menempel di banyak inquiry sekaligus.
     * Menghapusnya berarti dua hal buruk: berkas kerja staf hilang permanen
     * beserta objek R2-nya karena satu pembeli minta datanya dihapus, dan bila
     * masih dirujuk inquiry lain, FK `Restrict` membatalkan seluruh transaksi
     * sehingga inquiry itu **tidak akan pernah bisa** dianonimkan.
     */
    const candidates = attachments.filter((row) => row.replyId === null);
    const orphans = await orphanMediaIds(
      tx,
      candidates.map((row) => row.mediaId),
    );
    if (orphans.size > 0) {
      await tx.media.deleteMany({ where: { id: { in: [...orphans] } } });
      for (const row of candidates) {
        if (orphans.has(row.mediaId)) purgedKeys.push(row.media.key);
      }
    }
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

/**
 * Media yang sudah tidak dirujuk apa pun, dihitung setelah baris lampiran
 * dihapus. Dipakai `collectMediaUsages` yang sama dengan Media Library, supaya
 * definisi "masih dipakai" tidak bercabang dua.
 */
async function orphanMediaIds(tx: Tx, mediaIds: readonly string[]): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const usages = await collectMediaUsages(tx, mediaIds);
  return new Set(mediaIds.filter((id) => (usages.get(id)?.length ?? 0) === 0));
}
