# Backend — API Ornament

API untuk situs publik dan admin CMS. Fastify 5 + TypeScript (ESM, strict),
berjalan di Node.js 24. Keputusan arsitektur ada di
[`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md).

**Status: fondasi (T1.1–T1.2).** Server bisa dijalankan dengan satu rute
sementara `GET /v1`, terhubung ke PostgreSQL lewat Prisma, dan memvalidasi env
saat startup. Format error, validasi Zod request, dan health check (T1.3), tes &
CI (T1.4), paket `@ornament/shared` (T1.5), serta model domain (Tahap 2) menyusul.

## Struktur

```
src/
  app.ts               buildApp() — merakit instance Fastify tanpa listen (dipakai server & tes)
  server.ts            entry: loadEnv(), cek DB (SELECT 1), listen, graceful shutdown
  config/env.ts        loadEnv() — skema Zod untuk process.env
  plugins/prisma.ts    registerPrisma() — decorate app.prisma + $disconnect saat onClose
  generated/prisma/    Prisma Client hasil generate (tidak di-commit)
prisma/
  schema.prisma        datasource + generator (belum ada model domain)
  migrations/          migrasi SQL (muncul saat model pertama ditambahkan)
prisma.config.ts       konfigurasi Prisma CLI (lokasi skema, migrasi, DATABASE_URL)
docker/postgres-init/  skrip init container Postgres (membuat ornament_test)
.env.example           template env — salin ke .env
docs/                  ADR, model domain, kontrak API
```

## Menjalankan lokal

Butuh Node 24 dan Docker. Paket ini bagian dari npm workspaces; install dari
**root** repo.

```bash
nvm use                           # Node 24 dari .nvmrc
npm install                       # di root; postinstall menjalankan `prisma generate`
npm run db:up                     # di root; PostgreSQL 18 di localhost:5432, tunggu healthy
cp backend/.env.example backend/.env
npm run db:migrate --workspace backend   # terapkan migrasi ke DB dev
npm run dev --workspace backend   # tsx watch, http://localhost:4000
curl http://localhost:4000/v1     # {"data":{"name":"ornament-api"}}
```

`npm run db:down` (root) mematikan container; data tetap di volume
`ornament-pgdata`. Untuk reset total: `docker compose down -v`.

### Database

`docker-compose.yml` di root menjalankan satu instance `postgres:18-alpine`
(user/sandi `ornament`/`ornament`, hanya untuk dev) dengan dua database:

| Database | Dipakai untuk | `DATABASE_URL` |
| --- | --- | --- |
| `ornament` | dev | `postgresql://ornament:ornament@localhost:5432/ornament?schema=public` |
| `ornament_test` | tes (T1.4) | `postgresql://ornament:ornament@localhost:5432/ornament_test?schema=public` |

`ornament_test` dibuat oleh `docker/postgres-init/01-create-test-db.sql`, yang
hanya dijalankan image Postgres saat volume **masih kosong**. Bila volume sudah
ada sebelum skrip itu, jalankan `docker compose down -v && npm run db:up`.

### Prisma (v7)

- `prisma.config.ts` adalah sumber konfigurasi CLI; `DATABASE_URL` dibaca dari
  env (file `backend/.env` dimuat otomatis bila ada). Skema tidak memuat URL.
- Generator `prisma-client` menulis client TypeScript ESM ke
  `src/generated/prisma/` (di-gitignore), lalu ikut dikompilasi `tsc`.
  Impor: `import { PrismaClient } from './generated/prisma/client.js'`.
- Runtime memakai driver adapter `@prisma/adapter-pg` (wajib di Prisma 7).
- Client di-generate ulang otomatis saat `npm install` (postinstall) dan
  sebelum `build` (prebuild). Setelah mengubah skema: `npm run db:generate`.

Alur migrasi:

```bash
# dev: ubah prisma/schema.prisma, lalu buat + terapkan migrasi
npm run db:migrate --workspace backend -- --name <nama-perubahan>
# staging/production/CI: terapkan migrasi yang sudah di-commit, tanpa membuat baru
npm run db:migrate:deploy --workspace backend
```

Selama skema belum punya model, `db:migrate` hanya membuat tabel
`_prisma_migrations` dan tidak menghasilkan folder migrasi; migrasi pertama
lahir bersama model domain di Tahap 2.

### Env

Divalidasi oleh `src/config/env.ts` saat startup. Bila ada yang salah, server
berhenti dengan daftar **nama** variabel dan aturannya (nilai tidak pernah
dicetak). `dev` dan `start` memuat `backend/.env` bila ada
(`--env-file-if-exists`); di production set env lewat platform.

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `HOST` | `0.0.0.0` | Alamat listen |
| `PORT` | `4000` | Port listen |
| `LOG_LEVEL` | `info` | Level log pino |
| `DATABASE_URL` | — (**wajib**) | URL `postgresql://` |
| `ADMIN_ORIGIN` | — | Opsional; wajib sejak auth admin (ADR K7) |
| `INTERNAL_API_KEY` | — | Opsional; header `X-Internal-Key` (ADR K7) |
| `INTERNAL_JOB_TOKEN` | — | Opsional; bearer `/v1/internal/*` (kontrak §5.17) |
| `SITE_URL`, `REVALIDATE_SECRET` | — | Opsional; revalidasi Next (kontrak §6) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | — | Opsional; media (ADR K3) |
| `RESEND_API_KEY`, `RESEND_FROM` | — | Opsional; email (ADR K4) |

Di `NODE_ENV=production`, `INTERNAL_API_KEY`, `INTERNAL_JOB_TOKEN`, dan
`REVALIDATE_SECRET` (bila di-set) minimal 32 karakter.

## Script

Jalankan dengan `npm run <script> --workspace backend` dari root, atau
`npm run <script>` di dalam `backend/`.

| Script | Fungsi |
| --- | --- |
| `dev` | Server dengan reload otomatis (`tsx watch`) |
| `build` | `prisma generate` lalu kompilasi ke `dist/` |
| `start` | Jalankan hasil build (`node dist/server.js`) |
| `typecheck` | `tsc --noEmit` |
| `lint` | ESLint |
| `format` / `format:check` | Prettier (tulis / cek saja) |
| `db:generate` | `prisma generate` |
| `db:migrate` | `prisma migrate dev` (buat + terapkan migrasi, dev) |
| `db:migrate:deploy` | `prisma migrate deploy` (terapkan migrasi yang ada) |
| `db:studio` | Prisma Studio |

Di root: `db:up` / `db:down` untuk container PostgreSQL.

## Dokumentasi

- [`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md) — keputusan arsitektur
- [`docs/domain-model.md`](docs/domain-model.md) — model domain
- [`docs/api-contract.md`](docs/api-contract.md) — kontrak API
