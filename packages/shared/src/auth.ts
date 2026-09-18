import { z } from 'zod';

import { dataEnvelope } from './envelope.js';

/**
 * Kontrak auth admin — kontrak API §2 (endpoint, `Me`, cookie) dan §3
 * (peran + kode `Permission`). Hanya bentuk data: tanpa dependensi server dan
 * tanpa tipe Prisma (ADR K6).
 */

// ── Peran & status pengguna (model domain §4) ────────────────────────────────

export const USER_ROLES = ['ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const USER_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

// ── Domain email wajib (ADR K7, model domain §3.1) ───────────────────────────

/** Semua akun admin adalah alamat di domain ini; dicek di API, bukan constraint DB. */
export const ORNAMENT_EMAIL_DOMAIN = '@ornament.id';

/** Kode issue kustom kontrak §1.5 untuk email di luar domain. */
export const EMAIL_DOMAIN_ISSUE_CODE = 'email_domain';

export const EMAIL_DOMAIN_MESSAGE = `Gunakan email ${ORNAMENT_EMAIL_DOMAIN}.`;

/** `TIM@Ornament.ID ` → `tim@ornament.id`. Email di DB `citext`, jadi bandingkan lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isOrnamentEmail(email: string): boolean {
  return normalizeEmail(email).endsWith(ORNAMENT_EMAIL_DOMAIN);
}

// ── Kode Permission (kontrak §3.3) ───────────────────────────────────────────

/**
 * Daftar kode kemampuan yang dipakai frontend untuk menyembunyikan tombol.
 * Server **tetap** memeriksa izin di setiap rute (kontrak §2.2).
 */
export const PERMISSIONS = [
  'product.write_draft',
  'product.publish',
  'product.trash',
  'product.restore',
  'product.purge',
  'product.qc',
  'article.write_draft',
  'article.publish',
  'article.restore',
  'article.purge',
  'taxonomy.write',
  'artisan.read_private',
  'artisan.write',
  'comment.moderate',
  'inquiry.manage',
  'media.upload',
  'media.private',
  'media.purge',
  'page.read',
  'page.write',
  'page.purge',
  'privacy.anonymize',
  'user.manage',
  'settings.manage',
  'activity.read_all',
  'cache.revalidate',
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

/**
 * Izin per peran, turunan dari matriks kontrak §3.1–§3.2.
 *
 * Catatan: beberapa izin Contributor masih dibatasi **kepemilikan/status** yang
 * hanya bisa dicek server (mis. `product.write_draft` hanya untuk draf miliknya,
 * `product.restore` hanya untuk item miliknya). Kode di sini menjawab "tombolnya
 * ada?", bukan "boleh untuk baris ini?".
 */
export const ROLE_PERMISSIONS = {
  ADMINISTRATOR: PERMISSIONS,
  EDITOR: [
    'product.write_draft',
    'product.publish',
    'product.trash',
    'product.restore',
    'product.qc',
    'article.write_draft',
    'article.publish',
    'article.restore',
    'taxonomy.write',
    'artisan.read_private',
    'artisan.write',
    'comment.moderate',
    'inquiry.manage',
    'media.upload',
    'media.private',
    'page.read',
    'page.write',
    'activity.read_all',
  ],
  CONTRIBUTOR: [
    'product.write_draft',
    'product.trash',
    'product.restore',
    'article.write_draft',
    'article.restore',
    'media.upload',
    'page.read',
  ],
} as const satisfies Record<UserRole, readonly Permission[]>;

/** Izin efektif sebuah peran, urut seperti `PERMISSIONS` agar respons stabil. */
export function permissionsForRole(role: UserRole): Permission[] {
  const granted = new Set<Permission>(ROLE_PERMISSIONS[role]);
  return PERMISSIONS.filter((permission) => granted.has(permission));
}

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission);
}

/**
 * Peran yang memiliki sebuah izin, urut seperti `USER_ROLES`.
 *
 * Dipakai backend untuk mengisi `details.requiredRoles` pada `403 FORBIDDEN`
 * (kontrak §1.10) tanpa menulis ulang matriks izin di guard: satu tabel
 * (`ROLE_PERMISSIONS`) menjawab "siapa yang boleh" dan "tombol mana yang tampil".
 */
export function rolesWithPermission(permission: Permission): UserRole[] {
  return USER_ROLES.filter((role) => roleHasPermission(role, permission));
}

// ── Cookie sesi (ADR K7, kontrak §2.1) ───────────────────────────────────────

/**
 * Nama cookie sesi. Prefiks `__Host-` mewajibkan `Secure`, `Path=/`, dan
 * **tanpa** `Domain`, sehingga cookie hanya milik host API.
 */
export const SESSION_COOKIE_NAME = '__Host-osa_session';

// ── `Me` (kontrak §2.2) ──────────────────────────────────────────────────────

/** `MediaRef` admin (kontrak §5). Didefinisikan di sini sampai modul media ada. */
export const mediaRefSchema = z.object({
  id: z.uuid(),
  url: z.string().nullable(),
  alt: z.string().nullable(),
  width: z.int().nullable(),
  height: z.int().nullable(),
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** Pengguna yang sedang masuk + izin turunan perannya. */
export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  avatar: mediaRefSchema.nullable(),
  lastActiveAt: z.iso.datetime().nullable(),
  permissions: z.array(permissionSchema),
});
export type Me = z.infer<typeof meSchema>;

// ── Endpoint §2.2 ────────────────────────────────────────────────────────────

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Kata sandi: 8–128 karakter (kontrak §2.2, issue #13). */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Kata sandi minimal ${String(PASSWORD_MIN_LENGTH)} karakter.`)
  .max(PASSWORD_MAX_LENGTH, `Kata sandi maksimal ${String(PASSWORD_MAX_LENGTH)} karakter.`);

/**
 * Email login. Dinormalisasi lebih dulu supaya spasi/huruf besar tidak menjadi
 * kegagalan validasi, lalu wajib berdomain `@ornament.id`. Issue domain memakai
 * `params.code = "email_domain"` agar `details[].code` di respons sesuai
 * kontrak §1.5 (backend memetakan `params.code` → `code`).
 */
export const ornamentEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Format email tidak valid.'))
  .refine(isOrnamentEmail, {
    error: EMAIL_DOMAIN_MESSAGE,
    params: { code: EMAIL_DOMAIN_ISSUE_CODE },
  });

/**
 * Alias historis: email login memakai aturan yang sama dengan email undangan
 * dan email pengguna admin lain (`@ornament.id`, dinormalisasi).
 */
export const loginEmailSchema = ornamentEmailSchema;

/** Nama tampilan pengguna (kontrak §2.2 & §5.13: 1–100 karakter, di-trim). */
export const USER_NAME_MAX_LENGTH = 100;
export const userNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama wajib diisi.')
  .max(USER_NAME_MAX_LENGTH, `Nama maksimal ${String(USER_NAME_MAX_LENGTH)} karakter.`);

/** `POST /v1/admin/auth/login`. `rememberMe` = radio "Ingat saya" di layar login. */
export const loginBodySchema = z.strictObject({
  email: loginEmailSchema,
  password: passwordSchema,
  rememberMe: z.boolean().default(false),
});
export type LoginBody = z.infer<typeof loginBodySchema>;
/** Bentuk sebelum `default`/transform — yang dikirim klien. */
export type LoginBodyInput = z.input<typeof loginBodySchema>;

export const loginResponseSchema = dataEnvelope(z.object({ user: meSchema }));
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** `GET /v1/admin/auth/me`. */
export const meResponseSchema = dataEnvelope(meSchema);
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `POST /v1/admin/auth/password` — ganti kata sandi sendiri (kontrak §2.2). */
export const changePasswordBodySchema = z.strictObject({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

// ── Undangan: endpoint tanpa sesi (kontrak §2.2) ─────────────────────────────

/** Panjang token undangan mentah sebelum base64url (32 byte CSPRNG, ADR K7). */
export const INVITE_TOKEN_BYTES = 32;

/** 32 byte base64url = 43 karakter tanpa padding — sama seperti token sesi. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Token undangan di path/body. Bentuknya divalidasi seperti string biasa
 * (panjang wajar) supaya token salah **selalu** dijawab `404 NOT_FOUND` oleh
 * handler — bukan `400 VALIDATION_FAILED`, yang akan memberi tahu penyerang
 * bahwa tebakannya "bentuknya benar".
 */
export const inviteTokenSchema = z.string().min(1).max(200);

export const inviteTokenParamsSchema = z.object({ token: inviteTokenSchema });

/** `GET /v1/admin/auth/invites/:token` — pratinjau undangan sebelum diterima. */
export const invitePreviewSchema = z.object({
  email: z.string(),
  role: userRoleSchema,
  expiresAt: z.iso.datetime(),
  invitedBy: z.object({ name: z.string() }),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const invitePreviewResponseSchema = dataEnvelope(invitePreviewSchema);
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>;

/** `POST /v1/admin/auth/invites/accept` — menetapkan nama + kata sandi sendiri. */
export const acceptInviteBodySchema = z.strictObject({
  token: inviteTokenSchema,
  name: userNameSchema,
  password: passwordSchema,
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;
export type AcceptInviteBodyInput = z.input<typeof acceptInviteBodySchema>;

/** Sama seperti login: `201 { data: { user: Me } }` + cookie sesi 12 jam. */
export const acceptInviteResponseSchema = dataEnvelope(z.object({ user: meSchema }));
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;
