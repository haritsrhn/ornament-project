import { z } from 'zod';

import {
  ornamentEmailSchema,
  userNameSchema,
  userRoleSchema,
  userStatusSchema,
  mediaRefSchema,
} from './auth.js';
import { dataEnvelope, dataMetaEnvelope } from './envelope.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';

/**
 * Kontrak pengguna & undangan admin — kontrak API §5.13 (`/v1/admin/users/*`,
 * `/v1/admin/invites/*`). Hanya bentuk data: tanpa tipe Prisma (ADR K6).
 */

// ── DTO ──────────────────────────────────────────────────────────────────────

/** Jumlah konten yang diturunkan saat query (model domain §3.1: bukan kolom). */
export const userContentCountSchema = z.object({
  articles: z.int().min(0),
  products: z.int().min(0),
  revisions: z.int().min(0),
});
export type UserContentCount = z.infer<typeof userContentCountSchema>;

/** Baris tabel Users di admin (kontrak §5.13). `passwordHash` tidak pernah ada di sini. */
export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  avatar: mediaRefSchema.nullable(),
  lastActiveAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  contentCount: userContentCountSchema,
  createdAt: z.iso.datetime(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

/** Referensi ringkas ke seorang pengguna (`invitedBy`). */
export const userRefSchema = z.object({ id: z.uuid(), name: z.string() });
export type UserRef = z.infer<typeof userRefSchema>;

/**
 * Status undangan adalah **turunan** dari kolom waktu (`acceptedAt`,
 * `revokedAt`, `expiresAt`), bukan kolom tersendiri — lihat
 * `inviteStatusOf()`. Urutan prioritas: diterima → dicabut → kedaluwarsa →
 * tertunda.
 */
export const INVITE_STATUSES = ['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED'] as const;
export const inviteStatusSchema = z.enum(INVITE_STATUSES);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export function inviteStatusOf(
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): InviteStatus {
  if (invite.acceptedAt !== null) return 'ACCEPTED';
  if (invite.revokedAt !== null) return 'REVOKED';
  return invite.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING';
}

/**
 * Undangan di tabel Users (baris "Belum masuk"). Token **tidak** ada di DTO
 * ini: hanya hash-nya yang tersimpan, dan token mentah hanya dikembalikan satu
 * kali oleh `POST /invites` / `POST /invites/:id/resend`
 * (`adminInviteWithTokenSchema`).
 */
export const adminInviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: userRoleSchema,
  status: inviteStatusSchema,
  invitedBy: userRefSchema,
  expiresAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  emailSentAt: z.iso.datetime().nullable(),
  emailError: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminInvite = z.infer<typeof adminInviteSchema>;

/**
 * Respons pembuatan/kirim-ulang undangan.
 *
 * `token` adalah **tambahan sementara** di luar tabel DTO kontrak §5.13:
 * modul email (Resend, ADR K4) baru dibangun di tahap berikutnya, jadi tanpa
 * ini undangan yang dibuat tidak akan pernah bisa dipakai. Nilainya hanya
 * muncul di respons pembuatan (sekali), tidak pernah di `GET /invites`, dan
 * menjadi `null` begitu pengiriman email betulan aktif.
 */
export const adminInviteWithTokenSchema = adminInviteSchema.extend({
  token: z.string().nullable(),
});
export type AdminInviteWithToken = z.infer<typeof adminInviteWithTokenSchema>;

// ── Query & body: pengguna ───────────────────────────────────────────────────

/**
 * Allowlist `sort` (kontrak §1.7). `name` naik adalah default tabel admin;
 * `-lastActiveAt` dipakai kolom "Terakhir aktif".
 */
export const USER_SORTS = ['name', '-name', 'lastActiveAt', '-lastActiveAt'] as const;
export const userSortSchema = z.enum(USER_SORTS);
export type UserSort = z.infer<typeof userSortSchema>;

/**
 * `status` default `ACTIVE` (kontrak §5.13). `ALL` ditambahkan agar tabel admin
 * bisa menampilkan gabungan aktif + dicabut dalam satu halaman; nilainya
 * bersifat aditif dan tidak mengubah default.
 */
export const USER_STATUS_FILTERS = ['ACTIVE', 'REVOKED', 'ALL'] as const;
export const userStatusFilterSchema = z.enum(USER_STATUS_FILTERS);
export type UserStatusFilter = z.infer<typeof userStatusFilterSchema>;

export const SEARCH_QUERY_MAX_LENGTH = 100;
/** `q` kontrak §1.7: 1–100 karakter, di-trim. */
export const searchQuerySchema = z.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH);

export const adminUsersQuerySchema = pageQuerySchema.extend({
  role: userRoleSchema.optional(),
  status: userStatusFilterSchema.default('ACTIVE'),
  q: searchQuerySchema.optional(),
  sort: userSortSchema.default('name'),
});
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;

export const adminUsersResponseSchema = dataMetaEnvelope(z.array(adminUserSchema), pageMetaSchema);
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

export const adminUserResponseSchema = dataEnvelope(adminUserSchema);
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;

export const userIdParamsSchema = z.object({ id: z.uuid() });

/** `PATCH /v1/admin/users/:id`. Minimal satu field, kalau tidak tidak ada yang berubah. */
export const updateUserBodySchema = z
  .strictObject({ name: userNameSchema.optional(), role: userRoleSchema.optional() })
  .refine((body) => body.name !== undefined || body.role !== undefined, {
    error: 'Kirim minimal satu field yang ingin diubah.',
    params: { code: 'empty_patch' },
  });
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

// ── Query & body: undangan ───────────────────────────────────────────────────

export const INVITE_STATUS_FILTERS = [...INVITE_STATUSES, 'ALL'] as const;
export const inviteStatusFilterSchema = z.enum(INVITE_STATUS_FILTERS);
export type InviteStatusFilter = z.infer<typeof inviteStatusFilterSchema>;

/** `GET /v1/admin/invites` — tanpa paginasi (kontrak §1.6: daftar kecil). */
export const adminInvitesQuerySchema = z.object({
  status: inviteStatusFilterSchema.default('PENDING'),
});
export type AdminInvitesQuery = z.infer<typeof adminInvitesQuerySchema>;

export const adminInvitesResponseSchema = dataEnvelope(z.array(adminInviteSchema));
export type AdminInvitesResponse = z.infer<typeof adminInvitesResponseSchema>;

export const adminInviteResponseSchema = dataEnvelope(adminInviteSchema);
export type AdminInviteResponse = z.infer<typeof adminInviteResponseSchema>;

export const adminInviteWithTokenResponseSchema = dataEnvelope(adminInviteWithTokenSchema);
export type AdminInviteWithTokenResponse = z.infer<typeof adminInviteWithTokenResponseSchema>;

export const inviteIdParamsSchema = z.object({ id: z.uuid() });

/** `POST /v1/admin/invites`. Email wajib `@ornament.id` (ADR K7). */
export const createInviteBodySchema = z.strictObject({
  email: ornamentEmailSchema,
  role: userRoleSchema,
});
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;
export type CreateInviteBodyInput = z.input<typeof createInviteBodySchema>;

// ── Aturan domain (`details.rule` pada 422, kontrak §1.10) ────────────────────

/**
 * Kode `rule` stabil untuk `422 BUSINESS_RULE_VIOLATION` di §5.13. Klien
 * bercabang pada kode ini, bukan pada `message`.
 */
export const USER_BUSINESS_RULES = {
  /** Aksi akan menyisakan nol Administrator aktif. */
  LAST_ADMINISTRATOR: 'LAST_ADMINISTRATOR',
  /** Administrator tidak boleh mengubah perannya sendiri. */
  CANNOT_CHANGE_OWN_ROLE: 'CANNOT_CHANGE_OWN_ROLE',
  /** Administrator tidak boleh mencabut aksesnya sendiri. */
  CANNOT_REVOKE_SELF: 'CANNOT_REVOKE_SELF',
} as const;
export type UserBusinessRule = (typeof USER_BUSINESS_RULES)[keyof typeof USER_BUSINESS_RULES];
