/**
 * DTO `AdminComment` (kontrak §5.10).
 *
 * `authorEmail` ikut — moderator perlu melihatnya untuk menilai spam — tetapi
 * `ipHash` dan `userAgent` **tidak pernah**, bahkan untuk Administrator.
 * Keduanya dikumpulkan untuk anti-spam otomatis, bukan untuk dibaca manusia,
 * dan dikosongkan setelah 30 hari (model §6.11). Menyertakannya di DTO berarti
 * setiap layar moderasi menjadi tempat IP pengunjung bisa dibaca dan disalin.
 */

import type { AdminComment } from '@ornament/shared';

export const adminCommentSelect = {
  id: true,
  parentId: true,
  authorName: true,
  authorEmail: true,
  authorUserId: true,
  body: true,
  status: true,
  moderatedAt: true,
  anonymizedAt: true,
  createdAt: true,
  article: { select: { id: true, title: true, slug: true } },
  authorUser: { select: { id: true, name: true } },
  moderatedBy: { select: { id: true, name: true } },
} as const;

export interface AdminCommentRow {
  id: string;
  parentId: string | null;
  authorName: string;
  authorEmail: string | null;
  authorUserId: string | null;
  body: string;
  status: 'PENDING' | 'APPROVED' | 'SPAM' | 'DELETED';
  moderatedAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  article: { id: string; title: string; slug: string };
  authorUser: { id: string; name: string } | null;
  moderatedBy: { id: string; name: string } | null;
}

export function toAdminComment(row: AdminCommentRow): AdminComment {
  return {
    id: row.id,
    article: row.article,
    parentId: row.parentId,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    // Diturunkan dari `authorUserId`, bukan kolom tersendiri: satu sumber
    // kebenaran, dan balasan admin tidak bisa menyamar sebagai pengunjung.
    isStaffReply: row.authorUserId !== null,
    author: row.authorUser,
    body: row.body,
    status: row.status,
    moderatedBy: row.moderatedBy,
    moderatedAt: row.moderatedAt?.toISOString() ?? null,
    anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
