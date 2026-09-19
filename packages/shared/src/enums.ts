import { z } from 'zod';

/**
 * Enum domain (model domain §4) yang dipakai kontrak publik. Kode stabil
 * UPPER_SNAKE; label tampilan dipetakan di frontend (kontrak §1.3).
 */

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'MADE_TO_ORDER'] as const;
export const stockStatusSchema = z.enum(STOCK_STATUSES);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const QC_STAGES = ['MATERIAL', 'FRAME', 'FINISHING', 'PACKAGING'] as const;
export const qcStageSchema = z.enum(QC_STAGES);
export type QcStage = z.infer<typeof qcStageSchema>;

export const QC_STATUSES = ['PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED'] as const;
export const qcStatusSchema = z.enum(QC_STATUSES);
export type QcStatus = z.infer<typeof qcStatusSchema>;

export const ARTISAN_STATUSES = ['VERIFICATION', 'ACTIVE', 'FULL_CAPACITY'] as const;
export const artisanStatusSchema = z.enum(ARTISAN_STATUSES);
export type ArtisanStatus = z.infer<typeof artisanStatusSchema>;

/**
 * Status pengrajin yang boleh muncul di `/v1/public/*` (kontrak §4, model §6.7):
 * `VERIFICATION` tidak pernah tampil, dan pengrajin yang diarsipkan disaring
 * lewat `archivedAt` (yang sendirinya tidak pernah ada di DTO publik).
 */
export const PUBLIC_ARTISAN_STATUSES = ['ACTIVE', 'FULL_CAPACITY'] as const;
export const publicArtisanStatusSchema = z.enum(PUBLIC_ARTISAN_STATUSES);
export type PublicArtisanStatus = z.infer<typeof publicArtisanStatusSchema>;
