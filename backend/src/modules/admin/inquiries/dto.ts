/**
 * DTO inbox inquiry (kontrak §5.11).
 *
 * `ipHash` dan `userAgent` tidak pernah ikut — sama seperti komentar, keduanya
 * anti-spam, bukan bahan bacaan. Yang berbeda dari komentar: `message` penuh
 * hanya keluar di detail, sedangkan daftar memakai `preview` ±120 karakter,
 * karena inbox memuat puluhan baris sekaligus.
 */

import {
  inquiryPreview,
  type AdminInquiry,
  type AdminInquiryRow,
  type InquiryAttachmentDto,
  type InquiryReplyDto,
} from '@ornament/shared';

import type { Prisma } from '../../../generated/prisma/client.js';

const attachmentSelect = {
  id: true,
  mediaId: true,
  replyId: true,
  media: { select: { fileName: true, mimeType: true, sizeBytes: true } },
} as const;

export const adminInquiryRowSelect = {
  id: true,
  number: true,
  reference: true,
  subject: true,
  name: true,
  company: true,
  email: true,
  country: true,
  volumeQuantity: true,
  status: true,
  readAt: true,
  message: true,
  anonymizedAt: true,
  createdAt: true,
  // `replyId: null` — hanya lampiran pembeli. `InquiryAttachment.inquiryId`
  // terisi untuk lampiran balasan juga, jadi hitungan polos akan bertambah
  // setiap kali staf membalas dan tidak lagi cocok dengan `attachments` di
  // detail, yang kontrak §5.11 batasi pada berkas pembeli.
  _count: { select: { attachments: { where: { replyId: null } }, replies: true } },
} as const;

export const adminInquirySelect = {
  ...adminInquiryRowSelect,
  categoryLabel: true,
  materialLabel: true,
  targetShipText: true,
  targetShipDate: true,
  destinationPort: true,
  budgetPerUnitUsd: true,
  completedAt: true,
  notificationError: true,
  category: { select: { id: true, name: true } },
  material: { select: { id: true, name: true } },
  attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
  replies: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      toEmail: true,
      subject: true,
      body: true,
      status: true,
      sentAt: true,
      emailError: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true } },
      attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
    },
  },
} as const;

export const inquiryReplySelect = adminInquirySelect.replies.select;

interface AttachmentRow {
  id: string;
  mediaId: string;
  replyId: string | null;
  media: { fileName: string; mimeType: string; sizeBytes: bigint };
}

export interface InquiryReplyRow {
  id: string;
  toEmail: string | null;
  subject: string;
  body: string | null;
  status: 'DRAFT' | 'SENT' | 'FAILED';
  sentAt: Date | null;
  emailError: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string };
  attachments: AttachmentRow[];
}

export interface AdminInquiryRowData {
  id: string;
  number: number;
  reference: string;
  subject: string;
  name: string;
  company: string | null;
  email: string | null;
  country: string | null;
  volumeQuantity: number;
  status: 'NEW' | 'IN_PROGRESS' | 'DONE';
  readAt: Date | null;
  message: string | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  _count: { attachments: number; replies: number };
}

export interface AdminInquiryData extends AdminInquiryRowData {
  categoryLabel: string | null;
  materialLabel: string | null;
  targetShipText: string | null;
  targetShipDate: Date | null;
  destinationPort: string | null;
  /** `Decimal` Prisma; diserialkan sebagai string desimal (kontrak §1.3). */
  budgetPerUnitUsd: Prisma.Decimal | null;
  completedAt: Date | null;
  notificationError: string | null;
  category: { id: string; name: string } | null;
  material: { id: string; name: string } | null;
  attachments: AttachmentRow[];
  replies: InquiryReplyRow[];
}

function toAttachment(row: AttachmentRow): InquiryAttachmentDto {
  return {
    id: row.id,
    mediaId: row.mediaId,
    fileName: row.media.fileName,
    mimeType: row.media.mimeType,
    sizeBytes: Number(row.media.sizeBytes),
  };
}

export function toInquiryReply(row: InquiryReplyRow): InquiryReplyDto {
  return {
    id: row.id,
    author: row.author,
    toEmail: row.toEmail,
    subject: row.subject,
    body: row.body,
    status: row.status,
    sentAt: row.sentAt?.toISOString() ?? null,
    emailError: row.emailError,
    attachments: row.attachments.map(toAttachment),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAdminInquiryRow(row: AdminInquiryRowData): AdminInquiryRow {
  return {
    id: row.id,
    number: row.number,
    reference: row.reference,
    subject: row.subject,
    name: row.name,
    company: row.company,
    email: row.email,
    country: row.country,
    volumeQuantity: row.volumeQuantity,
    status: row.status,
    readAt: row.readAt?.toISOString() ?? null,
    preview: inquiryPreview(row.message),
    attachmentCount: row._count.attachments,
    replyCount: row._count.replies,
    anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAdminInquiry(row: AdminInquiryData): AdminInquiry {
  return {
    ...toAdminInquiryRow(row),
    category: row.category,
    categoryLabel: row.categoryLabel,
    material: row.material,
    materialLabel: row.materialLabel,
    targetShipText: row.targetShipText,
    // Kolomnya `@db.Date`: hanya tanggal yang berarti, jadi bagian waktunya
    // dibuang alih-alih mengirim ISO penuh yang menyiratkan presisi palsu.
    targetShipDate: row.targetShipDate?.toISOString().slice(0, 10) ?? null,
    destinationPort: row.destinationPort,
    budgetPerUnitUsd: row.budgetPerUnitUsd?.toString() ?? null,
    message: row.message,
    completedAt: row.completedAt?.toISOString() ?? null,
    notificationError: row.notificationError,
    // Hanya lampiran pembeli; lampiran balasan ikut di `replies[].attachments`.
    attachments: row.attachments.filter((item) => item.replyId === null).map(toAttachment),
    replies: row.replies.map(toInquiryReply),
  };
}
