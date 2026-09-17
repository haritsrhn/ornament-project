import { z } from 'zod';

/** Panjang minimal rahasia bersama di production (kira-kira 256 bit acak dalam hex/base64). */
const MIN_SECRET_LENGTH = 32;

/** Nilai kosong (`FOO=`) diperlakukan sama dengan tidak di-set. */
const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const SECRET_KEYS = ['INTERNAL_API_KEY', 'INTERNAL_JOB_TOKEN', 'REVALIDATE_SECRET'] as const;

const envSchema = z
  .object({
    // ── Server ──────────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    // ── Database (wajib, ADR K2) ────────────────────────────────────────────
    DATABASE_URL: z
      .string({ error: 'wajib diisi' })
      .min(1, 'wajib diisi')
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'harus URL postgresql://'),

    // ── Opsional sekarang; diwajibkan di tahap yang membangun fiturnya ─────
    /** CORS allowlist + guard Origin admin (ADR K7). Wajib sejak auth admin. */
    ADMIN_ORIGIN: optionalUrl,
    /** Header X-Internal-Key dari server Next (ADR K7, kontrak §1). Wajib sejak endpoint publik. */
    INTERNAL_API_KEY: optionalString,
    /** Bearer untuk /v1/internal/* (kontrak §5.17). Wajib sejak endpoint internal. */
    INTERNAL_JOB_TOKEN: optionalString,
    /** Basis URL situs publik untuk POST ${SITE_URL}/api/revalidate (kontrak §6). */
    SITE_URL: optionalUrl,
    /** Header X-Revalidate-Secret (kontrak §6). Wajib sejak revalidasi cache. */
    REVALIDATE_SECRET: optionalString,
    /** Cloudflare R2 (ADR K3). Wajib sejak modul media. */
    R2_ACCOUNT_ID: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    R2_BUCKET: optionalString,
    R2_PUBLIC_URL: optionalUrl,
    /** Resend (ADR K4). Wajib sejak modul email. */
    RESEND_API_KEY: optionalString,
    RESEND_FROM: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of SECRET_KEYS) {
      const value = env[key];
      if (value !== undefined && value.length < MIN_SECRET_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `minimal ${String(MIN_SECRET_LENGTH)} karakter di production`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Konfigurasi env tidak valid:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Memvalidasi env dan mengembalikan config bertipe. Melempar `EnvValidationError`
 * berisi daftar variabel yang salah. Pesan hanya memuat nama variabel dan aturan
 * yang dilanggar — tidak pernah nilainya, agar rahasia tidak bocor ke log.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(root)';
    return `${name}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}
