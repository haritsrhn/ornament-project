/**
 * Inbox inquiry — kontrak §5.11, model §3.7 & §6.5.
 *
 * Empat aturan yang membentuk modul ini:
 *
 * 1. **Balasan disimpan sebagai `DRAFT` lebih dulu, dikirim setelah commit**
 *    (§6.5). Email adalah panggilan jaringan ke pihak ketiga: menjalankannya
 *    di dalam transaksi berarti menahan koneksi database selama Resend lambat,
 *    dan kegagalan rollback akan membuang balasan yang mungkin sudah terkirim.
 * 2. **Kegagalan email bukan 5xx** (kontrak §1.10). Pengiriman yang gagal
 *    tetap `200` dengan `status: FAILED` dan `emailError`, dan bisa diulang.
 * 3. **`SENT` tidak bisa diedit atau dihapus.** Yang sudah sampai ke kotak
 *    masuk pembeli tidak bisa ditarik, jadi arsipnya pun tidak boleh berubah.
 * 4. **Inquiry yang dianonimkan tidak bisa dibalas** (§6.11): alamatnya sudah
 *    tidak ada, dan membangkitkannya kembali membatalkan penghapusan itu.
 */

import {
  canTransitionInquiry,
  INQUIRY_BUSINESS_RULES,
  type AdminInquiriesQuery,
  type InquiryReplyInput,
  type InquiryStatus,
  type UpdateInquiryInput,
  type UpdateInquiryReplyInput,
} from '@ornament/shared';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, businessRuleViolation, notFound } from '../../../lib/errors.js';
import { escapeLike } from '../../../lib/like.js';
import type { R2 } from '../../../lib/r2.js';
import type { EmailSender } from '../../email/sender.js';
import { anonymizeCommentRows, anonymizeInquiryRows } from '../anonymize.js';
import {
  adminInquirySelect,
  adminInquiryRowSelect,
  inquiryReplySelect,
  type AdminInquiryData,
  type AdminInquiryRowData,
  type InquiryReplyRow,
} from './dto.js';

type Tx = Prisma.TransactionClient;

export interface InquiryActor {
  id: string;
  name: string;
}

export interface InquiryDeps {
  prisma: PrismaClient;
  email: EmailSender;
  /** Untuk mengunduh lampiran balasan dan menghapus objek saat anonimisasi. */
  r2: R2 | null;
}

const invalidState = (message: string, current: string, allowed: string[]): AppError =>
  new AppError('INVALID_STATE', message, { details: { current, allowed } });

// ── Daftar & detail ──────────────────────────────────────────────────────────

export interface InquiryListResult {
  rows: AdminInquiryRowData[];
  total: number;
  counts: Record<string, number>;
}

export async function listInquiries(
  prisma: PrismaClient,
  query: AdminInquiriesQuery,
): Promise<InquiryListResult> {
  const filters = baseWhere(query);
  const where: Prisma.InquiryWhereInput = {
    ...filters,
    ...(query.status === undefined ? {} : { status: query.status }),
  };

  const [rows, total, grouped, unread] = await Promise.all([
    prisma.inquiry.findMany({
      where,
      select: adminInquiryRowSelect,
      orderBy: [{ createdAt: query.sort === 'createdAt' ? 'asc' : 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.inquiry.count({ where }),
    // `counts` mengabaikan filter tab itu sendiri (kontrak §1.4).
    prisma.inquiry.groupBy({ by: ['status'], where: filters, _count: { _all: true } }),
    prisma.inquiry.count({ where: { ...filters, readAt: null } }),
  ]);

  let all = 0;
  const counts: Record<string, number> = { all: 0, NEW: 0, IN_PROGRESS: 0, DONE: 0, unread };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    all += row._count._all;
  }
  counts.all = all;

  return { rows, total, counts };
}

function baseWhere(query: AdminInquiriesQuery): Prisma.InquiryWhereInput {
  if (query.q === undefined) return {};
  const q = escapeLike(query.q);
  return {
    OR: [
      { reference: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { company: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
    ],
  };
}

export async function loadInquiry(
  prisma: PrismaClient,
  inquiryId: string,
): Promise<AdminInquiryData> {
  const row = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: adminInquirySelect,
  });
  if (row === null) throw notFound('Inquiry tidak ditemukan.');
  return row;
}

// ── Ubah ─────────────────────────────────────────────────────────────────────

export async function updateInquiry(
  prisma: PrismaClient,
  options: { actor: InquiryActor; inquiryId: string; input: UpdateInquiryInput },
): Promise<AdminInquiryData> {
  const { actor, inquiryId, input } = options;

  return prisma.$transaction(async (tx) => {
    const current = await tx.inquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, reference: true, status: true, readAt: true },
    });
    if (current === null) throw notFound('Inquiry tidak ditemukan.');

    if (input.status !== undefined && !canTransitionInquiry(current.status, input.status)) {
      throw invalidState(
        transitionMessage(current.status, input.status),
        current.status,
        allowedNext(current.status),
      );
    }

    await tx.inquiry.update({
      where: { id: inquiryId },
      data: {
        // `GET` sengaja tidak menandai dibaca (kontrak §5.11): membuka detail
        // untuk mengintip tidak sama dengan menerima pekerjaannya.
        ...(input.read === undefined ? {} : { readAt: input.read ? new Date() : null }),
        ...(input.status === undefined
          ? {}
          : {
              status: input.status,
              // `completedAt` adalah jejak kapan selesai; ia ikut dibersihkan
              // saat inquiry dibuka kembali supaya laporan tidak salah hitung.
              completedAt: input.status === 'DONE' ? new Date() : null,
            }),
        ...(input.targetShipDate === undefined
          ? {}
          : {
              targetShipDate: input.targetShipDate === null ? null : new Date(input.targetShipDate),
            }),
      },
      select: { id: true },
    });

    if (input.status !== undefined && input.status !== current.status) {
      await logInquiry(
        tx,
        actor.id,
        'inquiry.status_changed',
        `Inquiry ${current.reference} menjadi ${input.status}`,
        inquiryId,
      );
    }

    return tx.inquiry.findUniqueOrThrow({ where: { id: inquiryId }, select: adminInquirySelect });
  });
}

function allowedNext(current: InquiryStatus): InquiryStatus[] {
  const all: InquiryStatus[] = ['NEW', 'IN_PROGRESS', 'DONE'];
  return all.filter((next) => canTransitionInquiry(current, next));
}

function transitionMessage(current: InquiryStatus, next: InquiryStatus): string {
  if (current === 'DONE' && next === 'IN_PROGRESS') {
    return 'Inquiry yang sudah selesai hanya terbuka kembali lewat balasan baru.';
  }
  return 'Inquiry tidak bisa dikembalikan ke status itu.';
}

// ── Balasan ──────────────────────────────────────────────────────────────────

export async function createReply(
  deps: InquiryDeps,
  options: { actor: InquiryActor; inquiryId: string; input: InquiryReplyInput },
): Promise<InquiryReplyRow> {
  const { actor, inquiryId, input } = options;

  return deps.prisma.$transaction(async (tx) => {
    const inquiry = await tx.inquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, subject: true, email: true, anonymizedAt: true },
    });
    if (inquiry === null) throw notFound('Inquiry tidak ditemukan.');
    assertNotAnonymized(inquiry.anonymizedAt);

    const mediaIds = input.attachmentMediaIds ?? [];
    await assertPrivateMedia(tx, mediaIds);

    const reply = await tx.inquiryReply.create({
      data: {
        inquiryId,
        authorId: actor.id,
        // Diambil sekarang, bukan saat kirim: inquiry yang dianonimkan di
        // antara keduanya tidak boleh membangkitkan alamat yang sudah dihapus.
        toEmail: inquiry.email,
        subject: input.subject ?? `Re: ${inquiry.subject}`,
        body: input.body,
        status: 'DRAFT',
        attachments: {
          create: mediaIds.map((mediaId) => ({ inquiryId, mediaId })),
        },
      },
      select: inquiryReplySelect,
    });
    return reply;
  });
}

export async function updateReply(
  deps: InquiryDeps,
  options: { inquiryId: string; replyId: string; input: UpdateInquiryReplyInput },
): Promise<InquiryReplyRow> {
  const { inquiryId, replyId, input } = options;

  return deps.prisma.$transaction(async (tx) => {
    const current = await loadReplyForWrite(tx, inquiryId, replyId);
    if (current.status === 'SENT') {
      throw invalidState('Balasan yang sudah terkirim tidak bisa diubah.', 'SENT', [
        'DRAFT',
        'FAILED',
      ]);
    }

    const mediaIds = input.attachmentMediaIds;
    if (mediaIds !== undefined) {
      await assertPrivateMedia(tx, mediaIds);
      await tx.inquiryAttachment.deleteMany({ where: { replyId } });
      if (mediaIds.length > 0) {
        await tx.inquiryAttachment.createMany({
          data: mediaIds.map((mediaId) => ({ inquiryId, replyId, mediaId })),
        });
      }
    }

    await tx.inquiryReply.update({
      where: { id: replyId },
      data: {
        ...(input.subject === undefined ? {} : { subject: input.subject }),
        ...(input.body === undefined ? {} : { body: input.body }),
      },
      select: { id: true },
    });
    return tx.inquiryReply.findUniqueOrThrow({
      where: { id: replyId },
      select: inquiryReplySelect,
    });
  });
}

export async function deleteReply(
  prisma: PrismaClient,
  options: { inquiryId: string; replyId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await loadReplyForWrite(tx, options.inquiryId, options.replyId);
    // `FAILED` sengaja ikut boleh dihapus: ia tidak pernah sampai ke siapa pun,
    // jadi membuangnya tidak menghapus jejak percakapan yang nyata.
    if (current.status === 'SENT') {
      throw invalidState('Balasan yang sudah terkirim tidak bisa dihapus.', 'SENT', [
        'DRAFT',
        'FAILED',
      ]);
    }
    await tx.inquiryReply.delete({ where: { id: options.replyId }, select: { id: true } });
  });
}

export interface SendReplyOutcome {
  reply: InquiryReplyRow;
  inquiry: AdminInquiryRowData;
}

/**
 * Kirim balasan. Email dipanggil **di luar** transaksi (§6.5): hasilnya
 * ditulis kembali sesudahnya, sehingga Resend yang lambat tidak menahan
 * koneksi database dan kegagalannya tidak membatalkan apa pun.
 */
export async function sendReply(
  deps: InquiryDeps,
  options: { actor: InquiryActor; inquiryId: string; replyId: string },
): Promise<SendReplyOutcome> {
  const { actor, inquiryId, replyId } = options;

  const prepared = await deps.prisma.$transaction(async (tx) => {
    const reply = await loadReplyForWrite(tx, inquiryId, replyId);
    if (reply.status === 'SENT') {
      throw invalidState('Balasan ini sudah terkirim.', 'SENT', ['DRAFT', 'FAILED']);
    }

    const inquiry = await tx.inquiry.findUniqueOrThrow({
      where: { id: inquiryId },
      select: { id: true, reference: true, anonymizedAt: true, status: true },
    });
    assertNotAnonymized(inquiry.anonymizedAt);

    const full = await tx.inquiryReply.findUniqueOrThrow({
      where: { id: replyId },
      select: inquiryReplySelect,
    });
    return { reply: full, reference: inquiry.reference };
  });

  const toEmail = prepared.reply.toEmail;
  const body = prepared.reply.body;
  const result =
    toEmail === null || body === null
      ? { sentAt: null, messageId: null, error: 'RECIPIENT_MISSING' }
      : await deps.email.sendInquiryReply({
          to: toEmail,
          subject: prepared.reply.subject,
          body,
          attachments: await downloadAttachments(deps, prepared.reply),
        });

  return deps.prisma.$transaction(async (tx) => {
    const sent = result.error === null;
    await tx.inquiryReply.update({
      where: { id: replyId },
      data: {
        status: sent ? 'SENT' : 'FAILED',
        sentAt: result.sentAt,
        emailMessageId: result.messageId,
        emailError: result.error,
      },
      select: { id: true },
    });

    // Balasan pertama yang benar-benar terkirim memindahkan inquiry ke
    // `IN_PROGRESS`, termasuk membuka kembali yang sudah `DONE` (§6.5).
    if (sent) {
      await tx.inquiry.update({
        where: { id: inquiryId },
        data: { status: 'IN_PROGRESS', completedAt: null },
        select: { id: true },
      });
      await logInquiry(
        tx,
        actor.id,
        'inquiry.replied',
        `Balasan untuk ${prepared.reference} terkirim`,
        inquiryId,
      );
    }

    const [reply, inquiry] = await Promise.all([
      tx.inquiryReply.findUniqueOrThrow({ where: { id: replyId }, select: inquiryReplySelect }),
      tx.inquiry.findUniqueOrThrow({ where: { id: inquiryId }, select: adminInquiryRowSelect }),
    ]);
    return { reply, inquiry };
  });
}

/**
 * Lampiran diunduh dari R2 supaya ikut sebagai berkas di email, bukan sebagai
 * tautan bertanda tangan: penerimanya pembeli di luar organisasi, dan URL
 * berumur 5 menit akan mati sebelum sempat dibuka.
 */
async function downloadAttachments(
  deps: InquiryDeps,
  reply: InquiryReplyRow,
): Promise<{ fileName: string; content: Buffer }[]> {
  if (deps.r2 === null || reply.attachments.length === 0) return [];

  const keys = await deps.prisma.media.findMany({
    where: { id: { in: reply.attachments.map((item) => item.mediaId) } },
    select: { id: true, key: true, fileName: true, sizeBytes: true },
  });

  const files: { fileName: string; content: Buffer }[] = [];
  for (const media of keys) {
    // Gagal mengunduh satu lampiran tidak membatalkan kiriman: balasan tanpa
    // lampiran lebih berguna daripada tidak ada balasan sama sekali, dan
    // statusnya tetap terlihat di UI lewat daftar lampiran balasan.
    const content = await deps.r2.readHead(media.key, Number(media.sizeBytes));
    if (content !== null) files.push({ fileName: media.fileName, content });
  }
  return files;
}

async function loadReplyForWrite(
  tx: Tx,
  inquiryId: string,
  replyId: string,
): Promise<{ id: string; status: 'DRAFT' | 'SENT' | 'FAILED' }> {
  // Di-scope ke induknya: id balasan milik inquiry lain harus `404`, bukan
  // diam-diam diubah lewat jalur inquiry yang salah.
  const reply = await tx.inquiryReply.findFirst({
    where: { id: replyId, inquiryId },
    select: { id: true, status: true },
  });
  if (reply === null) throw notFound('Balasan tidak ditemukan.');
  return reply;
}

function assertNotAnonymized(anonymizedAt: Date | null): void {
  if (anonymizedAt === null) return;
  throw invalidState('Inquiry yang sudah dianonimkan tidak bisa dibalas.', 'ANONYMIZED', []);
}

/** Lampiran balasan wajib Media `PRIVATE`: penawaran bukan berkas publik. */
async function assertPrivateMedia(tx: Tx, mediaIds: readonly string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const rows = await tx.media.findMany({
    where: { id: { in: [...mediaIds] } },
    select: { id: true, visibility: true, deletedAt: true },
  });
  if (rows.length !== new Set(mediaIds).size) throw notFound('Media tidak ditemukan.');

  const invalid = rows.filter((row) => row.visibility !== 'PRIVATE' || row.deletedAt !== null);
  if (invalid.length > 0) {
    throw businessRuleViolation(
      INQUIRY_BUSINESS_RULES.MEDIA_NOT_PRIVATE,
      'Lampiran balasan harus berkas privat yang masih aktif.',
    );
  }
}

// ── Anonimisasi (model §6.11) ────────────────────────────────────────────────

export interface AnonymizeInquiryOutcome {
  row: AdminInquiryData;
  affected: { inquiries: number; comments: number };
}

export async function anonymizeInquiry(
  deps: InquiryDeps,
  options: { actor: InquiryActor; inquiryId: string; sameEmail: boolean },
): Promise<AnonymizeInquiryOutcome> {
  const { actor, inquiryId, sameEmail } = options;

  const purgedKeys: string[] = [];
  const outcome = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.inquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, email: true, reference: true },
    });
    if (current === null) throw notFound('Inquiry tidak ditemukan.');

    const email = current.email;
    const inquiryIds =
      sameEmail && email !== null
        ? (await tx.inquiry.findMany({ where: { email }, select: { id: true } })).map(
            (row) => row.id,
          )
        : [inquiryId];

    const inquiries = await anonymizeInquiryRows(tx, inquiryIds, purgedKeys);

    let comments = 0;
    if (sameEmail && email !== null) {
      const rows = await tx.comment.findMany({
        where: { authorEmail: email, authorUserId: null },
        select: { id: true },
      });
      comments = await anonymizeCommentRows(
        tx,
        rows.map((row) => row.id),
      );
    }

    await logInquiry(
      tx,
      actor.id,
      'inquiry.anonymized',
      sameEmail
        ? `Data pribadi dianonimkan untuk ${String(inquiries)} inquiry dan ${String(comments)} komentar`
        : `Data pribadi ${current.reference} dianonimkan`,
      inquiryId,
    );

    const row = await tx.inquiry.findUniqueOrThrow({
      where: { id: inquiryId },
      select: adminInquirySelect,
    });
    return { row, affected: { inquiries, comments } };
  });

  // Objek R2 dihapus setelah commit, dengan alasan yang sama seperti modul
  // komentar: objek yatim lebih murah daripada data pribadi yang kembali.
  if (deps.r2 !== null) {
    for (const key of purgedKeys) await deps.r2.remove(key);
  }
  return outcome;
}

async function logInquiry(
  tx: Tx,
  actorId: string,
  action: string,
  message: string,
  inquiryId: string,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      kind: 'INQUIRY',
      action,
      message,
      actorId,
      entityType: 'Inquiry',
      entityId: inquiryId,
    },
    select: { id: true },
  });
}
