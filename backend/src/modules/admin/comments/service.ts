/**
 * Moderasi komentar — kontrak §5.10, model §6.8 & §6.11.
 *
 * Tiga aturan yang membentuk modul ini:
 *
 * 1. **`DELETED` adalah titik akhir.** Ia tidak bisa dipulihkan lewat UI,
 *    sehingga komentar yang sudah dianggap hilang oleh penulisnya tidak bisa
 *    diam-diam ditayangkan kembali. `SPAM` sebaliknya masih bisa kembali.
 * 2. **Balasan admin menyetujui induknya** (A7): membalas komentar yang masih
 *    `PENDING` tanpa menayangkannya akan menghasilkan balasan yang menggantung
 *    tanpa pertanyaan di halaman publik.
 * 3. **Anonimisasi tidak bisa dibatalkan**, jadi ia Administrator saja (A3) dan
 *    idempoten: menjalankannya dua kali tidak merusak apa pun.
 */

import {
  canModerateFrom,
  COMMENT_BUSINESS_RULES,
  type AdminCommentsQuery,
  type CommentStatus,
} from '@ornament/shared';

import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, businessRuleViolation, notFound } from '../../../lib/errors.js';
import { escapeLike } from '../../../lib/like.js';
import type { R2 } from '../../../lib/r2.js';
import { anonymizeCommentRows, anonymizeInquiryRows } from '../anonymize.js';
import { adminCommentSelect, type AdminCommentRow } from './dto.js';

type Tx = Prisma.TransactionClient;

export interface CommentActor {
  id: string;
  name: string;
}

export interface CommentDeps {
  prisma: PrismaClient;
  /** Untuk menghapus objek lampiran inquiry saat anonimisasi (§6.11). */
  r2: R2 | null;
}

// ── Daftar ───────────────────────────────────────────────────────────────────

export interface CommentListResult {
  rows: AdminCommentRow[];
  total: number;
  counts: Record<CommentStatus, number>;
}

export async function listComments(
  prisma: PrismaClient,
  query: AdminCommentsQuery,
): Promise<CommentListResult> {
  const filters = baseWhere(query);
  const where: Prisma.CommentWhereInput = { ...filters, status: query.status };

  const [rows, total, grouped] = await Promise.all([
    prisma.comment.findMany({
      where,
      select: adminCommentSelect,
      orderBy: [{ createdAt: query.sort === 'createdAt' ? 'asc' : 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.comment.count({ where }),
    // `counts` memakai filter yang sama **kecuali** filter tab itu sendiri
    // (kontrak §1.4), yaitu `status`.
    prisma.comment.groupBy({ by: ['status'], where: filters, _count: { _all: true } }),
  ]);

  const counts: Record<CommentStatus, number> = {
    PENDING: 0,
    APPROVED: 0,
    SPAM: 0,
    DELETED: 0,
  };
  for (const row of grouped) counts[row.status] = row._count._all;

  return { rows, total, counts };
}

function baseWhere(query: AdminCommentsQuery): Prisma.CommentWhereInput {
  const q = query.q === undefined ? undefined : escapeLike(query.q);
  return {
    ...(query.articleId === undefined ? {} : { articleId: query.articleId }),
    ...(q === undefined
      ? {}
      : {
          OR: [
            { authorName: { contains: q, mode: 'insensitive' } },
            { body: { contains: q, mode: 'insensitive' } },
          ],
        }),
  };
}

export async function loadComment(
  prisma: PrismaClient,
  commentId: string,
): Promise<AdminCommentRow> {
  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    select: adminCommentSelect,
  });
  if (row === null) throw notFound('Komentar tidak ditemukan.');
  return row;
}

// ── Ubah status ──────────────────────────────────────────────────────────────

export async function moderateComment(
  prisma: PrismaClient,
  options: { actor: CommentActor; commentId: string; status: CommentStatus },
): Promise<AdminCommentRow> {
  const { actor, commentId, status } = options;

  return prisma.$transaction(async (tx) => {
    const current = await tx.comment.findUnique({
      where: { id: commentId },
      select: { id: true, status: true, authorName: true },
    });
    if (current === null) throw notFound('Komentar tidak ditemukan.');

    if (!canModerateFrom(current.status)) {
      throw new AppError('INVALID_STATE', 'Komentar yang sudah dihapus tidak dapat diubah lagi.', {
        details: { current: current.status, allowed: [] },
      });
    }

    const row = await tx.comment.update({
      where: { id: commentId },
      data: { status, moderatedById: actor.id, moderatedAt: new Date() },
      select: adminCommentSelect,
    });
    await logComment(
      tx,
      actor.id,
      `comment.${status.toLowerCase()}`,
      `Komentar dari "${current.authorName}" ditandai ${status}`,
      commentId,
    );
    return row;
  });
}

// ── Balasan admin (A7) ───────────────────────────────────────────────────────

export async function replyToComment(
  prisma: PrismaClient,
  options: { actor: CommentActor; commentId: string; body: string },
): Promise<AdminCommentRow> {
  const { actor, commentId, body } = options;

  return prisma.$transaction(async (tx) => {
    const parent = await tx.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        parentId: true,
        status: true,
        articleId: true,
        article: { select: { status: true, publishAt: true, deletedAt: true } },
      },
    });
    if (parent === null) throw notFound('Komentar tidak ditemukan.');

    // Satu tingkat balasan saja (kontrak §5.3): utas publik dirender sebagai
    // komentar + balasannya, bukan pohon.
    if (parent.parentId !== null) {
      throw businessRuleViolation(
        COMMENT_BUSINESS_RULES.REPLY_DEPTH_EXCEEDED,
        'Balasan tidak dapat dibalas lagi.',
      );
    }
    if (!isArticleLive(parent.article)) {
      throw businessRuleViolation(
        COMMENT_BUSINESS_RULES.ARTICLE_NOT_PUBLISHED,
        'Artikel ini belum terbit, jadi balasan tidak akan terlihat pengunjung.',
      );
    }

    const now = new Date();
    // Balasan admin langsung tayang: ia ditulis orang yang berwenang, jadi
    // mengantrekannya di moderasi hanya menunda dirinya sendiri.
    const reply = await tx.comment.create({
      data: {
        articleId: parent.articleId,
        parentId: parent.id,
        authorName: actor.name,
        authorUserId: actor.id,
        body,
        status: 'APPROVED',
        moderatedById: actor.id,
        moderatedAt: now,
      },
      select: adminCommentSelect,
    });

    // A7: induk yang masih `PENDING` ikut disetujui dalam transaksi yang sama.
    // Tanpa ini balasan akan tampil tanpa pertanyaan yang dijawabnya.
    if (parent.status === 'PENDING') {
      await tx.comment.update({
        where: { id: parent.id },
        data: { status: 'APPROVED', moderatedById: actor.id, moderatedAt: now },
        select: { id: true },
      });
    }

    await logComment(tx, actor.id, 'comment.replied', 'Balasan admin ditambahkan', parent.id);
    return reply;
  });
}

/** ADR K8: `SCHEDULED` yang jadwalnya sudah lewat sudah tayang. */
function isArticleLive(article: {
  status: string;
  publishAt: Date | null;
  deletedAt: Date | null;
}): boolean {
  if (article.deletedAt !== null) return false;
  if (article.status === 'PUBLISHED') return true;
  return (
    article.status === 'SCHEDULED' && article.publishAt !== null && article.publishAt <= new Date()
  );
}

// ── Anonimisasi (model §6.11) ────────────────────────────────────────────────

export interface AnonymizeOutcome {
  row: AdminCommentRow;
  affected: { comments: number; inquiries: number };
}

/**
 * Menghapus jejak pribadi tanpa menghapus barisnya: utas publik tetap utuh,
 * laporan inquiry tetap bisa dihitung, tetapi nama, email, dan sidik jari
 * teknis hilang.
 *
 * Idempoten (§6.11): menjalankannya dua kali menghasilkan keadaan yang sama,
 * karena setiap field ditulis ke nilai tetap dan `anonymizedAt` hanya diisi
 * bila masih kosong.
 */
export async function anonymizeComment(
  deps: CommentDeps,
  options: { actor: CommentActor; commentId: string; sameEmail: boolean },
): Promise<AnonymizeOutcome> {
  const { actor, commentId, sameEmail } = options;

  const purgedKeys: string[] = [];
  const outcome = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorEmail: true, authorUserId: true },
    });
    if (current === null) throw notFound('Komentar tidak ditemukan.');

    // Balasan admin bukan data pengunjung: tidak ada yang bisa dianonimkan,
    // dan mengosongkannya justru menghapus jawaban resmi dari utas.
    if (current.authorUserId !== null) {
      throw new AppError('INVALID_STATE', 'Balasan admin bukan data pengunjung.', {
        details: { current: 'STAFF_REPLY', allowed: [] },
      });
    }

    const email = current.authorEmail;
    const commentIds =
      sameEmail && email !== null
        ? (
            await tx.comment.findMany({
              where: { authorEmail: email, authorUserId: null },
              select: { id: true },
            })
          ).map((row) => row.id)
        : [commentId];

    const comments = await anonymizeCommentRows(tx, commentIds);

    let inquiries = 0;
    if (sameEmail && email !== null) {
      const rows = await tx.inquiry.findMany({ where: { email }, select: { id: true } });
      inquiries = await anonymizeInquiryRows(
        tx,
        rows.map((row) => row.id),
        purgedKeys,
      );
    }

    await logComment(
      tx,
      actor.id,
      'comment.anonymized',
      sameEmail
        ? `Data pribadi dianonimkan untuk ${String(comments)} komentar dan ${String(inquiries)} inquiry`
        : 'Data pribadi komentar dianonimkan',
      commentId,
    );

    const row = await tx.comment.findUniqueOrThrow({
      where: { id: commentId },
      select: adminCommentSelect,
    });
    return { row, affected: { comments, inquiries } };
  });

  // Objek R2 dihapus **setelah** transaksi commit: gagal menghapus berkas
  // hanya menyisakan objek yatim, sedangkan membatalkan anonimisasi yang sudah
  // tercatat akan mengembalikan data pribadi yang seharusnya hilang.
  if (deps.r2 !== null) {
    for (const key of purgedKeys) await deps.r2.remove(key);
  }

  return outcome;
}

async function logComment(
  tx: Tx,
  actorId: string,
  action: string,
  message: string,
  commentId: string,
): Promise<void> {
  await tx.activityLog.create({
    data: {
      kind: 'COMMENT',
      action,
      message,
      actorId,
      entityType: 'Comment',
      entityId: commentId,
    },
    select: { id: true },
  });
}
