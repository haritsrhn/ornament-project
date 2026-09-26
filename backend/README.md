# Backend — API Ornament

API untuk situs publik dan admin CMS. Fastify 5 + TypeScript (ESM, strict),
berjalan di Node.js 24. Keputusan arsitektur ada di
[`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md).

**Status: fondasi (T1.1–T1.5).** Server terhubung ke PostgreSQL lewat Prisma,
memvalidasi env saat startup, dan punya middleware inti: format error kontrak,
validasi request/response dengan Zod, request ID + logging, serta health check.
Tes unit/integrasi (Vitest) dan CI GitHub Actions sudah berjalan. Skema/tipe
kontrak API (envelope, katalog kode error, pagination, health) diimpor dari paket
workspace [`@ornament/shared`](../packages/shared/README.md).

**Tahap 2 (T2.1–T2.3): skema domain.** `prisma/schema.prisma` memuat seluruh
model katalog, konten, dan operasional (30 model, 22 enum) sesuai
[`docs/domain-model.md`](docs/domain-model.md), beserta migrasi awal.

**Tahap 2 (T2.4): seed.** `npm run db:seed` mengisi database dev/tes dengan data
mockup `frontend/lib/data.ts` yang sudah dipetakan ke model domain — lihat
[§Seed data mockup](#seed-data-mockup).

**Tahap 3 (T3.1–T3.2): auth & sesi.** Login/logout/`me` admin dengan kata sandi
argon2id, sesi di database + cookie `__Host-osa_session`, guard sesi & peran,
CORS + cek `Origin` sebagai pengganti token CSRF, serta rate limit dan lockout
login — lihat [§Auth admin](#auth-admin). RBAC per endpoint (#15) dan modul
pengguna/undangan (#16) menyusul.

## Struktur

```
src/
  app.ts               buildApp() — merakit instance Fastify tanpa listen (dipakai server & tes)
  server.ts            entry: loadEnv(), cek DB (SELECT 1), listen, graceful shutdown
  config/env.ts        loadEnv() — skema Zod untuk process.env
  lib/errors.ts        AppError + ERROR_STATUS (status HTTP per ErrorCode §1.10) + helper (notFound(), …)
  lib/http.ts          ok() — membungkus data ke envelope sukses (kontrak §1.4)
  lib/password.ts      hashPassword()/verifyPassword()/needsRehash() — argon2id (ADR K7)
  lib/cursor.ts        kursor keyset daftar publik (kontrak §1.6) + sidik jari filter
  lib/attempt-throttle.ts  penghitung percobaan berjendela tetap, in-memory (lockout & submit publik)
  lib/idempotency.ts   withIdempotency() — simpanan 24 jam `(key, rute, ipHash) → respons` (§1.8)
  lib/like.ts          escapeLike() — meloloskan %/_/\ pada pencarian `q` ILIKE (§1.7)
  lib/slug.ts          slugify()/uniqueSlug()/uniqueCopySlug() — aturan slug model §6.1/§6.3
  lib/prisma-error.ts  P2002 → `409 CONFLICT` + details.fields (nama indeks driver adapter)
  lib/edit-conflict.ts expectedUpdatedAt → 409 EDIT_CONFLICT untuk resource tanpa nomor revisi (§1.9)
  lib/r2.ts            presign PUT/GET, HeadObject, hapus objek + bentuk key media (ADR K3)
  lib/upload-token.ts  uploadId bertanda tangan HMAC: presign → konfirmasi tanpa tabel sementara (§5.12)
  lib/image-size.ts    dimensi PNG/JPEG/WebP dari header, tanpa mendekode piksel
  modules/auth/session.ts        service sesi: token 32 byte, SHA-256 di DB, sliding refresh
  modules/auth/cookie.ts         atribut cookie __Host-osa_session di satu tempat
  modules/auth/guard.ts          app.requireSession / app.requireRole(...)
  modules/auth/login-throttle.ts lockout login per email (in-memory)
  modules/auth/me.ts             DTO Me + permissions turunan peran (kontrak §2.2/§3.3)
  modules/auth/routes.ts         POST login, POST logout, GET me
  modules/public/guard.ts        penanda publicAccess + Cache-Control + rate limit /v1/public/*
  modules/public/media.ts        DTO PublicMedia (URL R2; Media PRIVATE tidak pernah dirujuk)
  modules/public/client-identity.ts  IP/user agent pengunjung dari X-Client-* + ipHash ber-kunci
  modules/public/submit-throttle.ts  batas submit per ipHash, dua jendela sekaligus (§2.3)
  modules/public/submit.ts       kerangka submit publik: ipHash → rate limit → honeypot → idempotensi
  modules/public/products/       katalog publik: query keyset, pohon kategori, DTO, rute
  modules/public/artisans/       pengrajin publik: DTO whitelist + rute
  modules/public/articles/       journal publik: aturan "terbit" (ADR K8), keyset, blok isi, komentar
  modules/public/site/           situs publik: settings, menu, halaman & blok, sitemap, redirect
  modules/public/inquiries/      submit inquiry + presign lampiran (kontrak §5.4)
  modules/public/comments/       submit komentar journal → antrean moderasi (kontrak §5.3)
  modules/admin/ownership.ts         primitif batas kepemilikan/status Contributor (403 NOT_OWNER/NOT_DRAFT)
  modules/admin/slug-redirect.ts     SlugRedirect produk & artikel dalam satu aturan (model §6.10)
  modules/admin/tags.ts              resolveTagIds() — tabel `Tag` yang sama untuk produk & artikel
  modules/admin/products/access.ts   penerjemah baris produk ke primitif kepemilikan di atas
  modules/admin/products/dto.ts      DTO admin produk + syarat publish §6.3 (publishReadiness)
  modules/admin/products/service.ts  tulis produk: slug, SKU, stok, revisi, Trash, duplikat, redirect
  modules/admin/products/sku.ts      saran SKU §6.2 (sequence Postgres + YYMM zona SiteSetting)
  modules/admin/products/routes.ts   rute /v1/admin/products/* (kontrak §5.6)
  modules/admin/taxonomy/dto.ts      DTO kategori (produk & artikel), material, tag
  modules/admin/taxonomy/routes.ts   rute /v1/admin/categories|materials|tags (kontrak §5.7)
  modules/admin/artisans/dto.ts      DTO admin pengrajin: AdminArtisan (🔒) vs ArtisanRedacted
  modules/admin/artisans/service.ts  tulis pengrajin: slug, galeri, arsip §6.7, dokumen 🔒
  modules/admin/artisans/routes.ts   rute /v1/admin/artisans/* (kontrak §5.8)
  modules/admin/articles/access.ts   batas kepemilikan/status artikel (Contributor: draf miliknya)
  modules/admin/articles/dto.ts      DTO admin artikel + hitungan komentar per status
  modules/admin/articles/preview.ts  pratinjau: DTO publik tanpa menyimpan (kontrak §5.9)
  modules/admin/articles/service.ts  tulis artikel: slug+redirect, wordCount, jadwal, Trash
  modules/admin/articles/routes.ts   rute /v1/admin/articles/* (kontrak §5.9)
  modules/admin/media/usage.ts       "dipakai di mana?" dari 10 sumber, termasuk blok isi artikel
  modules/admin/media/dto.ts         DTO AdminMedia (url null untuk PRIVATE)
  modules/admin/media/service.ts     unggah, daftar, Trash/pulih/purge (kontrak §5.12)
  modules/admin/media/routes.ts      rute /v1/admin/media/* (kontrak §5.12)
  modules/admin/anonymize.ts         anonimisasi bersama komentar + inquiry (§6.11)
  modules/admin/comments/dto.ts      DTO AdminComment (ipHash/userAgent tidak pernah ikut)
  modules/admin/comments/service.ts  moderasi, balasan admin (A7), anonimisasi (§6.11)
  modules/admin/comments/routes.ts   rute /v1/admin/comments/* (kontrak §5.10)
  modules/admin/inquiries/dto.ts     DTO inbox: preview di daftar, message penuh di detail
  modules/admin/inquiries/service.ts status §6.5, balasan DRAFT→SENT/FAILED, anonimisasi
  modules/admin/inquiries/routes.ts  rute /v1/admin/inquiries/* (kontrak §5.11)
  modules/email/resend.ts            pengirim Resend (ADR K4); gagal ≠ 5xx
  modules/admin/bulk.ts              pengumpul hasil aksi massal (sukses parsial, §5)
  modules/jobs/publish-scheduled.ts  job 60 detik SCHEDULED → PUBLISHED (ADR K8, model §6.6)
  modules/email/sender.ts        antarmuka EmailSender + NoopEmailSender (ADR K4)
  plugins/prisma.ts    registerPrisma() — decorate app.prisma + $disconnect saat onClose
  plugins/validation.ts  validator/serializer Zod, locale pesan Indonesia, hanya body JSON
  plugins/error-handler.ts  setErrorHandler + setNotFoundHandler → envelope error kontrak §1.5
  plugins/logger.ts    opsi pino (LOG_LEVEL, redaksi, pretty di dev) + X-Request-Id
  plugins/admin-origin.ts  CORS allowlist ADMIN_ORIGIN + cek Origin non-GET + no-store
  routes/health.ts     GET /v1/health, GET /v1/health/ready
  generated/prisma/    Prisma Client hasil generate (tidak di-commit)
prisma/
  schema.prisma        datasource + generator + seluruh model domain (docs/domain-model.md)
  migrations/          migrasi SQL yang di-commit (sumber kebenaran skema DB)
  seed.ts              entry `npm run db:seed` (muat .env → pengaman → seed → cetak hitungan)
  seed/guard.ts        assertSeedAllowed() — tolak production & database di luar pola
  seed/source-data.ts  salinan data mockup frontend/lib/data.ts
  seed/transform.ts    pengubah teks mockup → kolom (tanggal, MOQ, stok, slug, …)
  seed/seed.ts         seedDatabase() — TRUNCATE + isi ulang dalam satu transaksi
prisma.config.ts       konfigurasi Prisma CLI (lokasi skema, migrasi, DATABASE_URL)
test/
  unit/                tes tanpa database (env, error, error handler, request ID, health,
                       argon2id, token sesi, lockout login, CORS/guard Origin)
  integration/         tes dengan database tes nyata + global-setup.ts (prisma migrate deploy);
                       schema-constraints.test.ts membuktikan CHECK/unik/Restrict berlaku di DB;
                       seed.test.ts menjalankan seed ke DB tes lalu membersihkannya
  helpers/app.ts       buildTestApp() — app dengan logger mati, ditutup otomatis di akhir tes
  helpers/database.ts  resolveTestDatabaseUrl() + createTestPrisma() — hanya DB `*_test`
  helpers/catalog.ts   fixture kategori/material/media/pengrajin/produk/artikel untuk tes
  helpers/journal.ts   fixture artikel/komentar/halaman/blok/menu/redirect untuk tes /v1/public/*
  helpers/auth.ts      fixture pengguna, pembaca Set-Cookie, dan pembaca respons bertipe
vitest.config.ts       project Vitest `unit` dan `integration`
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
curl http://localhost:4000/v1/health   # {"data":{"status":"ok"}}
```

`npm run db:down` (root) mematikan container; data tetap di volume
`ornament-pgdata`. Untuk reset total: `docker compose down -v`.

### Database

`docker-compose.yml` di root menjalankan satu instance `postgres:18-alpine`
(user/sandi `ornament`/`ornament`, hanya untuk dev) dengan dua database:

| Database        | Dipakai untuk | `DATABASE_URL`                                                              |
| --------------- | ------------- | --------------------------------------------------------------------------- |
| `ornament`      | dev           | `postgresql://ornament:ornament@localhost:5432/ornament?schema=public`      |
| `ornament_test` | tes           | `postgresql://ornament:ornament@localhost:5432/ornament_test?schema=public` |

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
- Preview feature `postgresqlExtensions` aktif agar extension `citext`
  (email case-insensitive) dan `pg_trgm` (indeks trigram untuk pencarian
  `ILIKE`) dideklarasikan di `datasource` dan dibuat oleh migrasi.

### Konvensi skema

Sumber kebenaran model: [`docs/domain-model.md`](docs/domain-model.md).
Yang berlaku di `schema.prisma`:

| Aspek         | Aturan                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nama          | Model/field camelCase Inggris (dipakai di kode); tabel, kolom, dan tipe enum di PostgreSQL **snake_case** lewat `@@map`/`@map` — SQL mentah di ADR K8 menulis `publish_at`, dan nama snake_case konsisten memudahkan query manual/psql. Tabel singular (`product`, `article`, `"user"` — dikutip karena kata kunci SQL). |
| ID & waktu    | `String @id @default(uuid()) @db.Uuid`; semua `DateTime` memakai `@db.Timestamptz` (UTC, domain model D1).                                                                                                                                                                                                               |
| Uang & ukuran | `Decimal` eksplisit: `fob_price_usd`/`budget_per_unit_usd` `DECIMAL(10,2)`, `length/width/height_cm` `DECIMAL(7,1)`, `weight_kg` `DECIMAL(7,2)`. Jangan pakai `Float` untuk uang.                                                                                                                                        |
| JSON          | Rich text & blok disimpan `Json` (`product.description`, `article.content`, `artisan.story`, `page_block.config`, `product_revision.snapshot`, `activity_log.metadata`) dan divalidasi Zod di `@ornament/shared` (domain model D7).                                                                                      |
| Soft delete   | `deleted_at` pada `product`, `article`, `page`, `media`; `artisan` memakai `archived_at`; `comment`/`user` memakai status. Query daftar wajib menyaring sendiri.                                                                                                                                                         |
| Unik          | `slug` dan `sku` unik **termasuk baris di Trash** (§6.1/§6.2), jadi unik biasa — bukan unik parsial.                                                                                                                                                                                                                     |
| Indeks FK     | Setiap kolom FK punya indeks; Postgres tidak membuatnya otomatis dan semua aturan hapus (`Restrict`/`SetNull`/`Cascade`) serta hitungan "dipakai di mana" memeriksa sisi anak.                                                                                                                                           |

### Alur migrasi

```bash
# dev: ubah prisma/schema.prisma, lalu buat + terapkan migrasi
npm run db:migrate --workspace backend -- --name <nama-perubahan>
# staging/production/CI: terapkan migrasi yang sudah di-commit, tanpa membuat baru
npm run db:migrate:deploy --workspace backend
# cek apakah DB tertinggal dari folder migrasi
npx prisma migrate status
```

- `prisma migrate dev` tanpa perubahan harus menjawab _"Already in sync"_. Bila
  ia menawarkan migrasi baru, ada drift antara skema dan migrasi.
- Migrasi yang sudah di-commit **tidak diedit lagi**; perbaikan dibuat sebagai
  migrasi baru (checksum migrasi tersimpan di `_prisma_migrations`).

| Migrasi                          | Isi                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…_model_domain_awal`            | Seluruh model domain + blok SQL manual di bawah                                                                                                                                                                                                   |
| `…_invite_email_sent_at`         | `invite.email_sent_at` (nullable) untuk `AdminInvite.emailSentAt` kontrak §5.13; model domain §3.1 hanya menyebut `email_message_id`/`email_error`, yang tidak bisa menjawab "kapan terkirim". Baris lama otomatis berarti "belum/gagal terkirim" |
| `…_indeks_keyset_katalog_publik` | Indeks `product(publish_status, deleted_at, published_at DESC, id DESC)` untuk keyset katalog publik (§1.6/§5.1)                                                                                                                                  |
| `…_indeks_keyset_artikel_publik` | Dua indeks **ekspresi parsial** pada `article` untuk keyset journal publik (§1.6/§5.3); lihat §Constraint SQL manual                                                                                                                              |

Reset database lokal (dev saja — **menghapus semua data**):

```bash
npx prisma migrate reset            # drop schema, terapkan ulang semua migrasi (+ seed bila ada)
# atau reset total termasuk volume Postgres, dari root repo:
docker compose down -v && npm run db:up
```

Database tes tidak perlu direset manual: `test/integration/global-setup.ts`
menjalankan `prisma migrate deploy` ke `ornament_test` sebelum tes.

### Constraint SQL manual

Sebagian aturan di `docs/domain-model.md` tidak bisa ditulis di Prisma Schema.
Aturan itu ditambahkan sebagai SQL di blok terakhir
`prisma/migrations/<ts>_model_domain_awal/migration.sql`, sehingga ikut
`migrate deploy` dan tetap terlacak `migrate status`. Prisma tidak menganggapnya
drift karena tidak ada padanannya di `schema.prisma` — tapi **jangan hapus blok
itu** saat membuat migrasi berikutnya.

| Objek                                                                         | Aturan                                                                                                                                                                                                                                                                                                      | Sumber                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `invite_email_active_key`                                                     | Unik parsial: satu undangan aktif per email (`WHERE accepted_at IS NULL AND revoked_at IS NULL`)                                                                                                                                                                                                            | §3.1                        |
| `product_material_primary_key`                                                | Unik parsial: maksimal satu material primer per produk (`WHERE is_primary`)                                                                                                                                                                                                                                 | §3.5                        |
| `product_low_stock_threshold_check`                                           | `low_stock_threshold >= 0` bila diisi                                                                                                                                                                                                                                                                       | §3.5 (Q13)                  |
| `product_stock_quantity_check`                                                | `stock_quantity >= 0` bila diisi                                                                                                                                                                                                                                                                            | kontrak §5.6 `ProductInput` |
| `comment_author_identity_check`                                               | `author_user_id`, `author_email`, atau `anonymized_at` harus terisi                                                                                                                                                                                                                                         | §3.6                        |
| `inquiry_email_present_check`                                                 | `email` wajib kecuali sudah dianonimkan                                                                                                                                                                                                                                                                     | §3.7                        |
| `page_block_global_check`                                                     | `page_id IS NULL` ⇔ `visibility = 'GLOBAL'` (blok global)                                                                                                                                                                                                                                                   | D10, §3.8                   |
| `nav_item_target_check`                                                       | Target sesuai `type`: `PAGE`→`page_id`, `CATEGORY`→`category_id`, `CUSTOM_LINK`→`url`, `ARTICLE_ARCHIVE`→tanpa target                                                                                                                                                                                       | §3.8                        |
| `site_setting_singleton_check`                                                | `id = 1` (singleton bertipe)                                                                                                                                                                                                                                                                                | D11, §3.8                   |
| `site_setting_low_stock_threshold_check`                                      | `low_stock_threshold >= 0`                                                                                                                                                                                                                                                                                  | §3.8 (Q13)                  |
| `slug_redirect_target_check`                                                  | Tepat satu dari `product_id`/`article_id`, sesuai `type`                                                                                                                                                                                                                                                    | §3.8, §6.10                 |
| `product_sku_seq`                                                             | Sequence global untuk saran SKU `ORN-<kode>-<NNNN>`; nomor tidak pernah dipakai ulang                                                                                                                                                                                                                       | §6.2                        |
| `article_public_effective_at_idx`, `article_public_category_effective_at_idx` | Indeks ekspresi parsial `COALESCE(published_at, publish_at) DESC, id DESC` (opsional per `category_id`) `WHERE deleted_at IS NULL AND status <> 'DRAFT'`, untuk keyset journal publik. Ekspresi dan predikat parsial tidak bisa ditulis di `schema.prisma`; ada di migrasi `…_indeks_keyset_artikel_publik` | kontrak §1.6/§5.3, ADR K8   |

Aturan lain yang **sengaja tetap di lapisan API** (tidak bisa/tidak layak jadi
constraint DB): syarat publish produk & artikel, "tepat satu material primer saat
publish", nesting komentar maksimal 1 tingkat, `stock_quantity` wajib null saat
status efektif `MADE_TO_ORDER`, domain email `@ornament.id`, pola SKU/slug, dan
larangan `from_slug` bertabrakan dengan slug aktif entitas lain.

Bukti bahwa constraint ini benar-benar berlaku ada di
`test/integration/schema-constraints.test.ts`.

### Env

Divalidasi oleh `src/config/env.ts` saat startup. Bila ada yang salah, server
berhenti dengan daftar **nama** variabel dan aturannya (nilai tidak pernah
dicetak). `dev` dan `start` memuat `backend/.env` bila ada
(`--env-file-if-exists`); di production set env lewat platform.

| Variabel                                                                                  | Default       | Keterangan                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                | `development` | `development` \| `test` \| `production`                                                                                                            |
| `HOST`                                                                                    | `0.0.0.0`     | Alamat listen                                                                                                                                      |
| `PORT`                                                                                    | `4000`        | Port listen                                                                                                                                        |
| `LOG_LEVEL`                                                                               | `info`        | Level log pino                                                                                                                                     |
| `DATABASE_URL`                                                                            | — (**wajib**) | URL `postgresql://`                                                                                                                                |
| `ADMIN_ORIGIN`                                                                            | —             | Opsional; wajib sejak auth admin (ADR K7)                                                                                                          |
| `INTERNAL_API_KEY`                                                                        | —             | Opsional; header `X-Internal-Key` (ADR K7). **Wajib** agar `POST /v1/public/*` bisa dipanggil sama sekali, dan dipakai sebagai kunci HMAC `ipHash` |
| `INTERNAL_JOB_TOKEN`                                                                      | —             | Opsional; bearer `/v1/internal/*` (kontrak §5.17)                                                                                                  |
| `SITE_URL`, `REVALIDATE_SECRET`                                                           | —             | Opsional; revalidasi Next (kontrak §6)                                                                                                             |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | —             | Media (ADR K3); tanpa kelimanya unggah menjawab `503`                                                                                              |
| `MEDIA_UPLOAD_SECRET`                                                                     | —             | Kunci HMAC `uploadId` (kontrak §5.12); min. 32 karakter di production                                                                              |
| `RESEND_API_KEY`, `RESEND_FROM`                                                           | —             | Email (ADR K4). Tanpa keduanya, pengiriman jatuh ke `NoopEmailSender` dan status kirim tercatat `EMAIL_NOT_CONFIGURED`                             |

Di `NODE_ENV=production`, `INTERNAL_API_KEY`, `INTERNAL_JOB_TOKEN`, dan
`REVALIDATE_SECRET` (bila di-set) minimal 32 karakter.

## Seed data mockup

`npm run db:seed` (di `backend/`, atau `npm run db:seed --workspace backend` dari
root) mengisi database dengan isi `frontend/lib/data.ts` yang sudah dipetakan ke
model domain sesuai tabel pemetaan [`docs/domain-model.md`](docs/domain-model.md)
§7: pengguna, kategori (hierarkis), material + kode SKU, tag, pengrajin, produk
beserta material primer/spesifikasi/checklist QC, kategori artikel, artikel +
blok isi, komentar, inquiry + balasan, halaman + blok Page Builder, menu,
pengaturan situs, dan log aktivitas.

```bash
npm run db:up                    # di root; PostgreSQL harus jalan
npm run db:migrate --workspace backend
npm run db:seed --workspace backend
```

> **Hanya dev/tes.** Seed meng-`TRUNCATE` **seluruh tabel domain** sebelum
> mengisi ulang. Data yang dibuat manual lewat admin ikut hilang.

**Idempoten.** Karena hapus-lalu-isi dilakukan di dalam satu transaksi, seed
boleh dijalankan berapa kali pun: jumlah baris tetap sama dan tidak pernah ada
bentrok kunci unik. Yang berubah antar-jalan hanya UUID dan timestamp, karena
semua waktu diturunkan relatif terhadap waktu seed.

**Pengaman** (`prisma/seed/guard.ts`), dijalankan sebelum koneksi dibuka:

| Kondisi                                                 | Hasil                                      |
| ------------------------------------------------------- | ------------------------------------------ |
| `NODE_ENV=production`                                   | Batal, exit code 1, tidak ada yang ditulis |
| Nama database di `DATABASE_URL` tidak memuat `ornament` | Batal, exit code 1                         |
| `DATABASE_URL` kosong/tidak valid                       | Batal, exit code 1                         |

Seed terdaftar di `prisma.config.ts` (`migrations.seed`), jadi ikut
`prisma migrate reset` dan `prisma migrate dev` pada database yang baru dibuat —
**tidak** ikut `prisma migrate deploy`, sehingga rilis production tidak pernah
menjalankan seed.

### Cara data mockup dipetakan

| Mockup                                              | Hasil di database                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tanggal relatif ("3 jam lalu", "Kemarin", "18 mnt") | `now - offset` saat seed dijalankan                                                                                                       |
| Tanggal absolut ("26 Agu 2026", "23 Agu 2026")      | Digeser dengan selisih yang sama terhadap "sekarang"-nya mockup (24 Agu 2026), sehingga artikel `Scheduled` tetap terjadwal di masa depan |
| Periode target kirim inquiry ("Nov 2026")           | Tidak digeser; `targetShipDate` = tanggal 1 bulan itu (§6.5)                                                                              |
| `status` produk ("In Stock" … "Draft")              | Dipecah `publishStatus` + `stockStatus` turunan (§6.3)                                                                                    |
| `stock` ("84 unit siap kirim")                      | `stockQuantity`; teks tanpa angka ("Menunggu foto produk") → `stockNote`                                                                  |
| `PRODUCT_SPEC` (panel detail satu produk)           | Dimensi/lead time/harga FOB hanya untuk produk pertama; dua baris sisanya jadi `ProductSpec`                                              |
| `QC_POINTS` (global)                                | Checklist 4 tahap untuk **setiap** produk (D6); `PASSED` untuk produk terbit                                                              |
| `subject` inquiry (teks bebas)                      | Dihasilkan ulang sesuai §6.5; nomor `INQ-0001…` diurutkan dari yang terlama                                                               |
| `BUILDER_BLOCKS`                                    | Blok beranda; "Footer" jadi blok global (`pageId` null, D10); nama set gambar disimpan di `config.imageNote`                              |

Yang **tidak** ada sumbernya di mockup, dan karena itu tidak diisi: berkas media
(tabel `media` kosong, semua `*ImageId` null — produk terbit karenanya belum
memenuhi syarat publish §6.3 yang berlaku di lapisan API), sesi, undangan,
revisi produk, galeri & dokumen pengrajin, lampiran inquiry, dan redirect slug.
Email komentar (wajib per §3.6) dibuat sintetis `@example.com`.

### Kata sandi akun seed

Mockup tidak memuat kata sandi, jadi **semua** akun seed memakai satu kata sandi
dev yang sama, di-hash argon2id seperti kata sandi sungguhan (ADR K7):

| Sumber                       | Nilai                                   |
| ---------------------------- | --------------------------------------- |
| `SEED_ADMIN_PASSWORD` di env | dipakai apa adanya (minimal 8 karakter) |
| tidak di-set                 | `DEV_ONLY_PASSWORD`                     |

Nilai yang dipakai **dicetak** di akhir `npm run db:seed` bersama satu email
contoh, supaya tidak perlu ditebak:

```
Login admin lokal: rani@ornament.id / DEV_ONLY_PASSWORD
```

Akun seed dan perannya: `rani@ornament.id` (Administrator), `sekar@ornament.id`
dan `dwi@ornament.id` (Editor), `bagus@ornament.id` (Contributor).

> Kata sandi ini sengaja terbaca sebagai "hanya untuk lokal". Seed hanya boleh
> jalan di dev/tes (`prisma/seed/guard.ts`), tetapi tetap: jangan pernah
> menjalankan seed terhadap database yang bisa diakses orang lain.

## Tes

[Vitest](https://vitest.dev) dengan dua project:

| Project       | Lokasi                          | Butuh DB                                                |
| ------------- | ------------------------------- | ------------------------------------------------------- |
| `unit`        | `test/unit/**/*.test.ts`        | Tidak — app dibangun tanpa DB, diuji lewat `app.inject` |
| `integration` | `test/integration/**/*.test.ts` | Ya — database tes (`ornament_test`)                     |

```bash
npm run db:up                                   # di root; integration butuh PostgreSQL
npm test                                        # di root: semua tes backend (unit + integration)
npm run test --workspace backend                # sama, eksplisit
npm run test:unit --workspace backend           # hanya unit (tanpa DB)
npm run test:integration --workspace backend    # hanya integration
npm run test:watch --workspace backend          # mode watch
npm run test --workspace backend -- test/unit/env.test.ts   # satu file
```

### Database tes

- URL diambil dari **`TEST_DATABASE_URL`**; bila tidak di-set, default
  `postgresql://ornament:ornament@localhost:5432/ornament_test?schema=public`
  (cocok dengan `docker-compose.yml`). Tidak perlu file env tes.
- Tes **tidak pernah** membaca `DATABASE_URL` (di `backend/.env` menunjuk DB dev
  `ornament`), dan helper menolak nama database yang tidak berakhiran `_test`.
- Global setup project `integration` menjalankan `prisma migrate deploy` ke DB
  tes (dengan `DATABASE_URL` proses anak di-set ke URL tes). Bila DB tidak
  terjangkau, tes gagal cepat dengan pesan yang jelas.
- Tes integrasi memverifikasi `current_database()` berakhiran `_test`.
- Tes yang menulis data membuat fixture bersufiks acak dan menghapusnya di
  `afterAll`, sehingga `ornament_test` kembali kosong setelah `npm test`.
  `auth.test.ts` mengikuti aturan yang sama: ia membuat pengguna sendiri (email
  bersufiks acak) dan **tidak** membaca satu pun baris seed.
- Berkas project `integration` dijalankan **berurutan** (`fileParallelism: false`):
  `seed.test.ts` mengosongkan lalu mengisi ulang seluruh database tes, jadi ia
  tidak boleh berjalan bersamaan dengan berkas lain. Berkas itu juga
  membersihkan database lagi setelah selesai.

### Menulis tes

```ts
import { expect, test } from 'vitest';

import { buildTestApp } from '../helpers/app.js';
import { createTestPrisma } from '../helpers/database.js';

test('contoh', async () => {
  const app = buildTestApp({ prisma: createTestPrisma() }); // tanpa `prisma` → app tanpa DB
  const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
  expect(res.statusCode).toBe(200);
}); // app.close() (+ $disconnect) otomatis lewat onTestFinished
```

Setiap tes membangun app sendiri; jangan berbagi state antar-tes atau
antar-file agar hasil tidak bergantung urutan.

## Auth admin

Sesi di database + cookie httpOnly (ADR K7), kontrak API §2. Tidak ada JWT dan
tidak ada token CSRF terpisah.

### Alur

```
POST /v1/admin/auth/login              email + kata sandi + rememberMe  → 200 { data: { user: Me } } + Set-Cookie
GET  /v1/admin/auth/me                 cookie sesi                      → 200 { data: Me }
POST /v1/admin/auth/logout             cookie sesi (opsional)           → 204 + cookie dihapus
POST /v1/admin/auth/password           cookie sesi + sandi lama & baru   → 204, sesi LAIN dicabut
GET  /v1/admin/auth/invites/:token     tanpa sesi                        → 200 pratinjau undangan
POST /v1/admin/auth/invites/accept     tanpa sesi: token + nama + sandi   → 201 { data: { user: Me } } + Set-Cookie
```

1. **Login.** Email wajib berakhiran `@ornament.id` (ditolak
   `400 VALIDATION_FAILED` dengan `details[].code = "email_domain"`) dan
   `User.status` harus `ACTIVE`. Kata sandi diverifikasi terhadap hash argon2id.
2. **Sesi.** Sukses → token acak **32 byte** (base64url, 43 karakter). Database
   hanya menyimpan **SHA-256**-nya di `Session.tokenHash`; token mentah hanya
   ada di cookie, jadi dump database tidak bisa dipakai membajak sesi.
3. **`Me`.** `permissions` diturunkan dari `role` lewat `ROLE_PERMISSIONS` di
   `@ornament/shared` (kontrak §3.3) dan hanya dipakai frontend untuk
   menyembunyikan tombol — server tetap memeriksa izin di setiap rute.
4. **Logout.** Menghapus **satu** baris `Session` (perangkat lain tetap masuk),
   selalu `204` walau cookie sudah tidak sah.

### Cookie

```
__Host-osa_session=<token>; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Strict
```

Prefiks `__Host-` mewajibkan `Secure`, `Path=/`, dan **tanpa** `Domain`, jadi
cookie milik host API saja dan tidak menyebar ke subdomain lain. Atributnya
dikunci di `src/modules/auth/cookie.ts` supaya tidak ada rute yang lupa salah
satu. Browser memperlakukan `http://localhost` sebagai origin aman, jadi
`Secure` tidak menghalangi dev.

### Masa berlaku & sliding refresh

|                                       | Tanpa "Ingat saya" | "Ingat saya" |
| ------------------------------------- | ------------------ | ------------ |
| Jendela idle (`expiresAt`, `Max-Age`) | 12 jam             | 30 hari      |
| Batas mutlak (`absoluteExpiresAt`)    | 7 hari             | 90 hari      |

Setiap request admin yang sah memperpanjang `expiresAt` (dibatasi
`absoluteExpiresAt`) dan menyegarkan `lastSeenAt` + `User.lastActiveAt`
**maksimal 1×/menit**, lalu mengirim ulang cookie dengan token yang sama.
"Ingat saya" tidak disimpan sebagai kolom: ia dibaca kembali dari rentang
`absoluteExpiresAt - createdAt` (7 hari vs 90 hari).

Sesi dihapus saat: logout, `expiresAt`/`absoluteExpiresAt` terlewat (dibersihkan
saat cookie dipakai lagi), dan `User.status = REVOKED` (semua sesi user itu
sekaligus). `deleteExpiredSessions()` tersedia untuk job pembersih nanti.

### Kata sandi (argon2id)

`src/lib/password.ts`, lewat `@node-rs/argon2` (binary prebuilt per platform —
tidak ada kompilasi native saat install).

| Parameter       | Nilai                  | Catatan                                     |
| --------------- | ---------------------- | ------------------------------------------- |
| Algoritma       | argon2id v19           | Hibrida: tahan GPU **dan** side-channel     |
| `m` (memori)    | 65536 KiB (64 MiB)     | ~3× batas bawah OWASP (19456)               |
| `t` (iterasi)   | 3                      |                                             |
| `p` (lane)      | 1                      | Node single-threaded; `p > 1` tidak sepadan |
| Keluaran / salt | 32 byte / 16 byte acak | Salt dibuat pustaka per hash                |

Sekitar 85 ms per hash pada laptop. `needsRehash()` menandai hash berparameter
lebih lemah (atau bukan argon2id v19); login menulis ulang hash seperti itu
selagi kata sandi mentah masih ada, sehingga menaikkan biaya nanti tidak
memutus akun lama.

### Guard sesi & izin (RBAC)

Setiap rute `/v1/admin/*` **wajib** menyatakan aksesnya lewat
`config.adminAccess`. Hook `onRoute` di `src/modules/auth/guard.ts` membaca
penanda itu dan memasang sendiri hook `onRequest` yang sesuai:

```ts
import { adminPermission, adminPublic, adminSession, currentSession } from '../auth/guard.js';

// Butuh sesi + izin `user.manage` (matriks kontrak §3 → hanya Administrator).
app.get('/admin/users', { config: { adminAccess: adminPermission('user.manage') } }, handler);

// Butuh sesi, semua peran boleh.
app.get('/admin/auth/me', { config: { adminAccess: adminSession() } }, (request) => {
  const { user } = currentSession(request); // bertipe, tanpa tipe Prisma
});

// Sengaja tanpa sesi — alasannya wajib ditulis dan terlihat saat review.
app.post('/admin/auth/login', { config: { adminAccess: adminPublic('membuat sesi') } }, handler);
```

Dua konsekuensi yang disengaja:

1. **Rute admin yang lupa menyatakan akses gagal saat registrasi**
   (`MissingAdminAccessError`) — server tidak start dan semua tes gagal, alih-alih
   rutenya diam-diam terbuka. Ini pengaman untuk modul Tahap 4+.
   `test/unit/admin-access.test.ts` menyisir ulang seluruh rute terdaftar dan
   juga mengunci daftar rute admin yang boleh tanpa sesi.
2. Tidak ada rute yang bisa "punya izin tapi lupa guard sesi": keduanya dipasang
   dari satu tempat.

Guard berjalan di **`onRequest`**, bukan `preHandler`, sehingga urutannya persis
kontrak §1.10: `Origin` → `401` sesi → `403` izin → `400` validasi. Pemanggil
tanpa hak karena itu tidak pernah menerima detail validasi maupun `404`
keberadaan resource.

| Situasi                                                         | Respons                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Tanpa cookie / token tak dikenal / kedaluwarsa / user `REVOKED` | `401 UNAUTHENTICATED` + cookie penghapus                          |
| Sesi sah, izin kurang                                           | `403 FORBIDDEN`, `details: { requiredPermission, requiredRoles }` |
| Login gagal (sebab apa pun)                                     | `401 INVALID_CREDENTIALS` — pesan **selalu** sama                 |

Sumber matriksnya satu: `ROLE_PERMISSIONS` di `@ornament/shared` (kontrak §3.3).
`Me.permissions` (untuk menyembunyikan tombol) dan guard API membaca tabel yang
sama, jadi UI dan server tidak bisa berbeda pendapat.

| Kemampuan                     | ADM | EDT | CTR | Izin                                 |
| ----------------------------- | --- | --- | --- | ------------------------------------ |
| Mengelola pengguna & undangan | ✓   | —   | —   | `user.manage`                        |
| Menerbitkan produk & artikel  | ✓   | ✓   | —   | `product.publish`, `article.publish` |
| Mengelola pengrajin           | ✓   | ✓   | —   | `artisan.write`                      |
| Membalas inquiry              | ✓   | ✓   | —   | `inquiry.manage`                     |
| Settings & tema               | ✓   | —   | —   | `settings.manage`                    |

Contoh: pengguna `REVOKED` menjawab `401 UNAUTHENTICATED` (bukan `403`) persis
seperti kontrak §2.4, agar admin melakukan redirect ke `/admin/login`.

### Ganti kata sandi sendiri

`POST /v1/admin/auth/password` (`{ currentPassword, newPassword }`, semua peran):
verifikasi sandi lama → hash baru argon2id → **semua sesi lain dicabut**, sesi
pemanggil bertahan (ADR K7). Sandi lama salah → `401 INVALID_CREDENTIALS`
(bukan `UNAUTHENTICATED`, supaya klien tidak ikut logout). Batas 5 percobaan /
15 menit **per pengguna**, di samping batas per IP.

### Pengguna & undangan (Administrator)

```
GET    /v1/admin/users               role?, status? (default ACTIVE, + ALL), q?, sort?, page?, pageSize?
GET    /v1/admin/users/:id
PATCH  /v1/admin/users/:id           { name?, role? }
POST   /v1/admin/users/:id/revoke    → REVOKED + seluruh sesinya dihapus
POST   /v1/admin/users/:id/reactivate→ ACTIVE (login lagi dengan sandi lama)
GET    /v1/admin/invites             status? PENDING|EXPIRED|ACCEPTED|REVOKED|ALL (default PENDING)
POST   /v1/admin/invites             { email (@ornament.id), role }        → 201 + token (sekali)
POST   /v1/admin/invites/:id/resend  → token baru, +72 jam, token lama mati
DELETE /v1/admin/invites/:id         → dicabut
```

`sort` hanya menerima `name`, `-name`, `lastActiveAt`, `-lastActiveAt`;
`meta.counts` berisi jumlah per peran, dihitung dengan filter yang sama kecuali
`role` (kontrak §1.4). `AdminUser.contentCount` (artikel/produk/revisi)
diturunkan saat query — tidak ada kolomnya di database.

**Aturan anti-lockout** (`src/modules/users/service.ts`), semuanya
`422 BUSINESS_RULE_VIOLATION` dengan `details.rule`:

| `rule`                   | Kapan                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `CANNOT_CHANGE_OWN_ROLE` | Administrator mengubah **perannya sendiri** (mengubah namanya sendiri tetap boleh) |
| `CANNOT_REVOKE_SELF`     | Administrator mencabut **aksesnya sendiri**                                        |
| `LAST_ADMINISTRATOR`     | Menurunkan peran / mencabut Administrator **aktif terakhir**                       |

Dua aturan pertama bukan sekadar kenyamanan: karena pemanggil selalu
Administrator aktif, melarang keduanya membuat sistem _secara struktural_ selalu
menyisakan minimal satu Administrator aktif, tanpa bergantung pada hasil `COUNT`
yang bisa basi karena request lain berjalan bersamaan. `LAST_ADMINISTRATOR`
tetap diperiksa sebagai jaring pengaman untuk data yang diubah di luar API.
Konsekuensinya: menghapus Administrator terakhir hanya mungkin lewat database.

### Alur undangan

1. Administrator `POST /v1/admin/invites`. Server membuat token **32 byte dari
   CSPRNG** (base64url, 43 karakter) dan menyimpan **hanya SHA-256**-nya di
   `invite.token_hash`; masa berlaku **72 jam** (ADR K7). Satu undangan aktif
   per email dijaga indeks unik parsial `invite_email_active_key`; undangan yang
   sudah kedaluwarsa dipakai ulang oleh pembuatan berikutnya.
2. Penerima membuka `GET /v1/admin/auth/invites/:token` (tanpa sesi) untuk
   melihat email, peran, dan siapa yang mengundang.
3. `POST /v1/admin/auth/invites/accept` (`{ token, name, password }`) membuat
   `User` dan menandai undangan diterima **dalam satu transaksi**, lalu langsung
   membuat sesi 12 jam. Token sekali pakai: klaim memakai `UPDATE … WHERE
accepted_at IS NULL`, jadi dua request bersamaan hanya menghasilkan satu akun.
4. Token salah, kedaluwarsa, dicabut, atau sudah dipakai → **satu** respons
   `404 NOT_FOUND` dengan pesan yang sama (anti enumerasi), dan kedua endpoint
   tanpa sesi ini dibatasi 10 permintaan / 15 menit per IP.

> **Email undangan belum terkirim.** Modul Resend (ADR K4) baru dibangun di
> tahap berikutnya dan PR ini sengaja tidak menambah dependensi email. Yang ada
> adalah antarmuka `EmailSender` (`src/modules/email/sender.ts`) dengan
> implementasi `NoopEmailSender`: undangan tetap tersimpan, `emailSentAt` tetap
> `null`, dan `emailError` diisi `EMAIL_NOT_CONFIGURED` — jujur, bukan
> berpura-pura sukses. Karena itu `POST /invites` dan `/resend`
> mengembalikan `token` mentah **satu kali** supaya tautan undangan bisa
> dibagikan manual. Token itu tidak pernah muncul di `GET /invites` maupun di
> log; begitu pengiriman email aktif, kembalikan `token: null`.

### CORS & cek Origin (pengganti token CSRF)

`src/plugins/admin-origin.ts`, hanya untuk `/v1/admin/*`:

- **CORS**: allowlist **satu** origin dari `ADMIN_ORIGIN`, `credentials: true`,
  tanpa wildcard; metode `GET,POST,PATCH,PUT,DELETE`, header `Content-Type,
Idempotency-Key, X-Request-Id` (kontrak §2.1). Situs publik tidak masuk
  allowlist — ia memanggil `/v1/public/*` server-to-server.
- **Cek Origin**: setiap non-GET wajib membawa `Origin` yang sama dengan
  `ADMIN_ORIGIN`, jika tidak → `403 ORIGIN_NOT_ALLOWED`, **sebelum** cek sesi
  dan sebelum validasi body. Request tanpa `Origin` juga ditolak.
- Semua respons admin memakai `Cache-Control: no-store`.

Tanpa `ADMIN_ORIGIN`, guard bersikap **fail-closed**: tidak ada origin yang
diizinkan, jadi seluruh non-GET admin (termasuk login) ditolak `403`. Variabelnya
tetap opsional di `loadEnv()` agar server/health dan CI tetap jalan tanpanya;
server mencatat peringatan saat start.

### Rate limit & lockout login

| Kunci                                                    | Batas                  | Mekanisme                                   |
| -------------------------------------------------------- | ---------------------- | ------------------------------------------- |
| IP, `POST /admin/auth/login`                             | 20 / 15 menit          | `@fastify/rate-limit` (store in-memory)     |
| Email, `POST /admin/auth/login`                          | 5 **gagal** / 15 menit | `LoginThrottle` (in-memory)                 |
| IP, `logout`, `me`, dan seluruh `/v1/admin/*` lain       | 600 / menit            | `@fastify/rate-limit`, jaring pengaman      |
| User, `POST /admin/auth/password`                        | 5 / 15 menit           | `PasswordChangeThrottle` (in-memory)        |
| IP, `GET /admin/auth/invites/:token` & `POST .../accept` | 10 / 15 menit          | `@fastify/rate-limit`, anti enumerasi token |

Keduanya menjawab `429 RATE_LIMITED` lewat helper `rateLimited()`, jadi
respons tetap envelope kontrak §1.5 dengan `details.retryAfterSeconds` **dan**
header `Retry-After` (plus `RateLimit-*` draft IETF). Pesannya generik —
"Terlalu banyak permintaan. Coba lagi nanti." — dan tidak pernah menyebut email
atau akun, sehingga tidak bisa dipakai memastikan sebuah email terdaftar.

Selama email terkunci, respons tetap `429` walau kata sandinya benar (kontrak
§2.3); login sukses mereset hitungan.

Agar "email tidak terdaftar" tidak lebih cepat daripada "kata sandi salah",
login memverifikasi kata sandi terhadap **hash dummy** bila email tidak
ditemukan, dan tetap memverifikasi hash pengguna `REVOKED`.

> **Batasan yang disengaja:** kedua state ada di memori proses. Begitu API
> berjalan lebih dari satu instance, batas efektif menjadi `batas × jumlah
instance` dan hilang setiap restart/deploy. ADR K8 mengasumsikan satu proses
> hidup lama, jadi hari ini cukup; saat scale-out, pindahkan ke store bersama
> (opsi `redis` pada plugin, dan tabel PostgreSQL untuk lockout lewat migrasi
> baru).

### Login lokal dengan akun seed

```bash
# 1. DB jalan, migrasi terpasang, dan seed sudah diisi
npm run db:up                    # di root
npm run db:migrate --workspace backend
npm run db:seed --workspace backend   # mencetak kata sandi dev di akhir

# 2. ADMIN_ORIGIN harus di-set (sudah ada di .env.example)
grep ADMIN_ORIGIN backend/.env   # ADMIN_ORIGIN=http://localhost:3000

# 3. Jalankan API
npm run dev --workspace backend

# 4. Login — Origin WAJIB, dan cookie disimpan ke jar
curl -i -X POST http://localhost:4000/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:3000' \
  -c /tmp/osa-cookie.txt \
  -d '{"email":"rani@ornament.id","password":"DEV_ONLY_PASSWORD","rememberMe":false}'

# 5. Pakai sesinya, lalu logout
curl -i -b /tmp/osa-cookie.txt http://localhost:4000/v1/admin/auth/me
curl -i -X POST -H 'Origin: http://localhost:3000' \
  -b /tmp/osa-cookie.txt http://localhost:4000/v1/admin/auth/logout
```

Dari browser admin: `fetch(url, { credentials: "include" })` — cookie
`SameSite=Strict` hanya terkirim bila admin dan API same-site (ADR K7).

Log pino menyensor header `cookie`/`set-cookie` dan field `password`, dan body
request tidak pernah dicatat: token sesi maupun kata sandi tidak muncul di log.

## HTTP API: konvensi dasar

Spesifikasi lengkap di [`docs/api-contract.md`](docs/api-contract.md) §1.

### Health check

| Endpoint               | Arti                                         | Respons                                                                                                       |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`       | Liveness — proses hidup; tidak menyentuh DB  | `200 {"data":{"status":"ok"}}`                                                                                |
| `GET /v1/health/ready` | Readiness — `SELECT 1` ke DB (timeout 2 dtk) | `200 {"data":{"status":"ok"}}`, atau `503 SERVICE_UNAVAILABLE` bila DB tak terjangkau / app dibangun tanpa DB |

Log request liveness hanya muncul di level `warn` ke atas agar probe tidak
membanjiri log.

### Format error

Semua error — termasuk rute tak dikenal, JSON rusak, body > 1 MB, Content-Type
selain `application/json`, gagal validasi, dan error tak terduga — dikirim sebagai:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Beberapa field tidak valid.",
    "details": [
      { "path": "materials[0].materialId", "code": "invalid_format", "message": "UUID tidak valid" }
    ],
    "requestId": "3f0b8a0e-3a55-4b52-9b1a-2c4f7c1a0d11"
  }
}
```

- `code` dari katalog kontrak §1.10 (`ErrorCode` dari `@ornament/shared`;
  status HTTP default per kode di `ERROR_STATUS`, `src/lib/errors.ts`).
  `details` hanya ada bila relevan.
- 5xx: stack & `cause` dicatat di log; respons hanya `INTERNAL_ERROR` generik.
- Di modul, cukup `throw`: `throw notFound()`, `throw conflict(['slug'])`,
  `throw new AppError('INVALID_STATE', 'Pesan.', { details: { current, allowed } })`.
- `X-Request-Id` masuk dipakai bila berupa `[A-Za-z0-9._:-]{1,128}`, selain itu
  dibuat UUID baru. Selalu dikembalikan di header respons dan di `error.requestId`.
- Log pino menyensor `cookie`, `authorization`, `x-internal-key`,
  `x-revalidate-secret`, `set-cookie`, `x-client-ip`, dan field `password`.
  `pino-pretty` (devDependency) hanya dipakai saat `NODE_ENV=development`.

### Menulis rute dengan skema Zod

```ts
import { dataEnvelope } from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { notFound } from '../lib/errors.js';
import { ok } from '../lib/http.js';

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.patch(
    '/admin/categories/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        // Body WAJIB strict: field tak dikenal → 400 VALIDATION_FAILED (unrecognized_keys).
        body: z.strictObject({ name: z.string().min(1).max(100).optional() }),
        response: { 200: dataEnvelope(z.object({ id: z.uuid(), name: z.string() })) },
      },
    },
    async (request) => {
      const category = await app.prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category) throw notFound('Kategori tidak ditemukan.');
      return ok(category); // request.params / request.body sudah bertipe
    },
  );
};
// app.ts: void app.register(categoryRoutes, { prefix: '/v1' });
```

Catatan: Fastify memvalidasi `params` → `body` → `querystring` dan berhenti di
lokasi pertama yang gagal, jadi `details` berisi issue satu lokasi saja. `path`
tanpa prefix lokasi (sesuai contoh kontrak); bila issue ada di akar, `path` =
nama lokasi (`body`, `querystring`, `params`). Respons yang tidak cocok dengan
`schema.response` menjadi `500 INTERNAL_ERROR` (bug server, dicatat di log).

### Skema bersama (`@ornament/shared`)

Skema yang juga dibutuhkan frontend (bentuk request/response, enum, pagination)
ditulis di `packages/shared/src/`, bukan di `backend/src/` (ADR K6); contoh di
atas memakai `z.object` inline hanya untuk ringkas. Yang tetap di backend: logika
server (`AppError`, `ERROR_STATUS`, `ok()`, error handler) dan tipe Prisma.

- `npm run dev` (tsx) dan Vitest me-resolve paket ke `packages/shared/src`
  lewat kondisi export `@ornament/source`: perubahan skema langsung terpakai.
- `typecheck`, `lint`, `build`, dan `start` memakai `packages/shared/dist`
  (dibangun otomatis saat `npm install`; `npm run build:shared` atau
  `npm run dev:shared` di root setelah mengubah skema bersama).
- `build` backend tidak membangun shared; dari root, `npm run build:backend`
  atau `npm run build` membangun shared lebih dulu. Artefak deploy butuh
  `packages/shared/dist` dan `node_modules/@ornament/shared`.

## API baca publik (`/v1/public/*`)

Sumber: kontrak [`docs/api-contract.md`](docs/api-contract.md) §5.1 (produk,
kategori, material), §5.2 (pengrajin), §5.3 (artikel & komentar), dan §5.5
(settings, menu, halaman, sitemap, redirect), dengan aturan privasi §4 dan
konvensi §1. Kode: `src/modules/public/`.

Pemanggil utamanya adalah server Next situs publik (server-to-server), tetapi
GET **tidak** butuh auth (ADR A9): ia dilindungi rate limit dan dirancang untuk
di-cache di edge.

### Endpoint

| Endpoint                                 | Query                                                                                                                                                                        | Respons                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /v1/public/products`                | `category` (slug, termasuk turunan), `material` (slug dipisah koma, **AND**), `tag`, `artisan`, `sort=-publishedAt` (default) \| `name`, `limit` (≤48, default 12), `cursor` | `{ data: PublicProductCard[], meta: { limit, nextCursor, total } }`                                               |
| `GET /v1/public/products/:slug`          | —                                                                                                                                                                            | `{ data: PublicProductDetail }` — spesifikasi, checklist QC 4 tahap, pengrajin ringkas, dan maks 4 produk terkait |
| `GET /v1/public/categories`              | `withEmpty` (default `false`)                                                                                                                                                | Daftar datar urut pohon + `depth` dan `productCount` (kategori + turunannya)                                      |
| `GET /v1/public/materials`               | `withEmpty`                                                                                                                                                                  | Urut `name`, dengan `productCount`                                                                                |
| `GET /v1/public/artisans`                | `regency` (tanpa memandang besar-kecil huruf), `limit`, `cursor`                                                                                                             | `{ data: PublicArtisanCard[], meta }` — hanya `ACTIVE`/`FULL_CAPACITY` yang tidak diarsipkan                      |
| `GET /v1/public/artisans/:slug`          | —                                                                                                                                                                            | `{ data: PublicArtisanDetail }` — profil + maks 12 produk terbaru miliknya                                        |
| `GET /v1/public/article-categories`      | `withEmpty`                                                                                                                                                                  | Urut `position`, dengan `articleCount` (artikel terbit)                                                           |
| `GET /v1/public/articles`                | `category` (slug `ArticleCategory`), `tag`, `limit`, `cursor`                                                                                                                | `{ data: PublicArticleCard[], meta }` — urut `-publishedAt` (terjadwal: `publishAt`)                              |
| `GET /v1/public/articles/:slug`          | —                                                                                                                                                                            | `{ data: PublicArticleDetail }` — blok isi, tag, gambar unggulan, penulis hanya `name`                            |
| `GET /v1/public/articles/:slug/comments` | `limit` (default 20), `cursor`                                                                                                                                               | `{ data: PublicComment[], meta }` — komentar akar `APPROVED` urut `createdAt` naik, balasan bersarang 1 tingkat   |
| `GET /v1/public/settings`                | —                                                                                                                                                                            | `{ data: PublicSiteSetting }` — nama, tagline, kontak, alamat, sosial, SEO, `sitemapEnabled`, `allowIndexing`     |
| `GET /v1/public/nav-items`               | —                                                                                                                                                                            | Menu satu tingkat urut `position`, dengan `href` turunan                                                          |
| `GET /v1/public/pages`                   | `path` (wajib, diawali `/`)                                                                                                                                                  | `{ data: PublicPage }` — blok `ACTIVE` halaman, lalu blok `GLOBAL`                                                |
| `GET /v1/public/blocks/global`           | —                                                                                                                                                                            | Blok global saja, untuk layout tanpa `Page` (mis. `/produk/[slug]`)                                               |
| `GET /v1/public/sitemap`                 | —                                                                                                                                                                            | `{ enabled, entries: [{ path, updatedAt }] }` — halaman, produk, artikel, pengrajin yang tayang                   |
| `GET /v1/public/redirects`               | `type` (`PRODUCT`\|`ARTICLE`), `slug` (slug lama)                                                                                                                            | `{ data: PublicRedirect }` — `301` ke slug terkini (§6.10)                                                        |

Slug filter yang tidak dikenal menjawab `200` dengan `data: []` (bukan `404`),
supaya URL filter lama tidak error. Produk draf/di Trash dan pengrajin
`VERIFICATION`/diarsipkan menjawab `404` di endpoint detailnya.

Belum ada di sini (menyusul di tahap berikutnya, lihat kontrak): seluruh
endpoint **tulis** publik — submit inquiry dan lampirannya (§5.4) serta
`POST /v1/public/articles/:slug/comments` (§5.3).

Kontrak tidak mendefinisikan endpoint `robots`: kebijakan indeks dikirim lewat
`SiteSetting.allowIndexing` di `/settings`, dan `robots.txt` dirender Next.

### Artikel "terbit" (ADR K8)

Query publik menganggap artikel terbit bila `deletedAt IS NULL` **dan**
(`status = PUBLISHED` **atau** `status = SCHEDULED AND publishAt <= now()`) —
model §6.6. Karena tanggal tayangnya karena itu bukan satu kolom, daftar journal
diurutkan `COALESCE(published_at, publish_at) DESC, id DESC`, dan
`PublicArticleCard.publishedAt` memakai `publishAt` untuk artikel terjadwal yang
sudah jatuh tempo. Definisi tunggalnya ada di
`src/modules/public/articles/query.ts` dan dipakai ulang oleh detail, komentar,
hitungan kategori, sitemap, dan resolusi redirect.

Artikel tanpa kategori juga disembunyikan: kategori wajib saat publish (§6.6)
dan `PublicArticleCard.category` tidak nullable, jadi baris yang rusak
disembunyikan alih-alih dikirim setengah jadi.

### Blok isi artikel

`Article.content` tidak lagi sekadar "JSON valid": skema `ArticleBlock`
(`packages/shared/src/articles.ts`, model §3.6) mengunci empat bentuk blok —
`paragraph`, `heading2`, `quote`, `image`. Saat membaca, blok yang tidak cocok
**dibuang** dan dicatat di log (`dropped`), bukan menjatuhkan halaman journal.
Blok `image` menukar `mediaId` dengan `PublicMedia`; blok yang medianya hilang
atau `PRIVATE` ikut dibuang, sama seperti galeri produk.

`Artisan.story` dan `Product.description` memakai `richTextSchema`
(`packages/shared/src/rich-text.ts`): blok teks yang sama dikurangi `image`,
karena keduanya tidak punya jalur penukaran `mediaId` → `PublicMedia` saat
dibaca. Sebelumnya keduanya hanya dijamin "JSON valid" padahal ikut disajikan
ke halaman publik, jadi renderer tidak punya jaminan bentuk dan `href` di
dalamnya tidak pernah divalidasi. Batasnya 60 blok, lebih kecil daripada
artikel (200), karena keduanya teks pendamping — bukan tulisan panjang.

`excerpt` DTO publik selalu terisi: bila kolomnya kosong ia diturunkan dari
paragraf pertama, maks 200 karakter.

### Privasi DTO (kontrak §4)

DTO publik ditulis sebagai **whitelist eksplisit** di `packages/shared/src/products.ts`,
`artisans.ts`, `articles.ts`, dan `site.ts`, bukan hasil `omit` dari model, dan `select` Prisma di
`src/modules/public/**/dto.ts` hanya mengambil kolom yang memang dikirim. Jadi
kolom seperti `stockNote`, `stockStatusOverride`, `lowStockThreshold`,
`ProductQcCheck.notes`, `revision`, `publishStatus`, `deletedAt`, `phone`,
`address`, `contactName`, `internalNotes`, `ArtisanDocument`,
`Comment.authorEmail`/`ipHash`/`userAgent`/`authorUserId`/`status`,
`User.email` (penulis hanya `name`), `SiteSetting.lowStockThreshold`,
`Page.systemKey`, dan `NavItem.pageId`/`categoryId` tidak punya jalur ke respons
publik — juga bila kolom baru ditambahkan ke Prisma nanti. Tes kontraknya ada di
`test/integration/public-products.test.ts`, `public-artisans.test.ts`,
`public-articles.test.ts`, dan `public-site.test.ts`, yang menanam nilai penanda
di kolom privat lalu membuktikan nol kemunculannya di body respons.

Pengrajin yang diarsipkan atau berstatus `VERIFICATION` (model §6.7/A10):
produknya **tetap** tayang, tetapi di detail produk pengrajinnya muncul dengan
`slug: null` sehingga UI menampilkannya tanpa tautan.

### Penanda rute publik

Cerminan `config.adminAccess`: setiap rute `/v1/public/*` **wajib** memakai
`config: publicReadAccess()` (GET) atau `publicWriteAccess("alasan")` (POST).
Penanda itu membawa batas rate limit §2.3 sekaligus, dan rute yang lupa
memakainya **gagal saat registrasi** (`MissingPublicAccessError`) alih-alih
tayang tanpa batas. Lihat `src/modules/public/guard.ts` dan
`test/unit/public-access.test.ts`.

```ts
app.get('/public/products', { config: publicReadAccess(), schema: { … } }, handler);
```

| Aspek                                    | Nilai                                                               |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `Cache-Control` GET                      | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` (§1.2) |
| `Cache-Control` POST                     | `no-store`                                                          |
| Rate limit dengan `X-Internal-Key` valid | 1200 / menit per IP                                                 |
| Rate limit tanpa key (atau key salah)    | 120 / menit per IP                                                  |

`X-Internal-Key` **tidak wajib** pada GET; key yang salah diperlakukan sama
dengan tanpa key (bukan `401`), hanya kuotanya yang lebih ketat. Kuota tepercaya
dan anonim memakai kunci hitung yang berbeda, sehingga kuota longgar server Next
tidak bisa "dipinjam". POST publik tetap mewajibkan key (`401 INVALID_INTERNAL_KEY`).

### Pagination kursor

Daftar publik memakai keyset (kontrak §1.6), bukan `OFFSET`: kursor menyimpan
sort, sidik jari filter, nilai kolom sort, dan `id` baris terakhir
(`src/lib/cursor.ts`). Akibatnya produk yang terbit di antara dua klik
"Muat 12 lagi" tidak membuat item terlewat atau tampil dua kali, dan kursor yang
dipakai dengan filter/sort berbeda ditolak `400 INVALID_CURSOR`.

Indeks `product(publish_status, deleted_at, published_at DESC, id DESC)`
(migrasi `20260919034034_indeks_keyset_katalog_publik`) melayani urutan katalog.
Untuk journal, urutannya adalah ekspresi `COALESCE(published_at, publish_at)`,
yang tidak bisa diurutkan `orderBy` Prisma: rutenya memakai satu query SQL
mentah yang hanya mengembalikan `id` (urut + keyset), lalu barisnya diambil
ulang lewat `select` whitelist Prisma — tidak ada kolom artikel yang pernah
lolos tanpa melewati whitelist. Indeks ekspresi parsialnya ada di migrasi
`20260919120000_indeks_keyset_artikel_publik`.

Komentar memakai keyset naik (`createdAt ASC, id ASC`, default `limit` 20) dan
dilayani indeks `comment(article_id, status, created_at)` yang sudah ada.
`meta.total` komentar menghitung komentar **akar** yang cocok filter; angka
"Diskusi (n)" di UI memakai `commentCount` pada DTO artikel, yang menghitung
balasan juga (model §6.8).

## Tulis publik: inquiry, komentar, anti-spam

Rute `POST /v1/public/*` (kontrak §5.3/§5.4, issue #21–#23). Berbeda dengan GET
publik yang boleh dipanggil siapa saja (A9), setiap POST publik melewati empat
lapis yang urutannya mengikat — `modules/public/submit.ts` menjalankannya di
satu tempat supaya tidak ada rute tulis yang melewatkan salah satunya:

| #   | Lapis                          | Di mana                                 | Gagal →                            |
| --- | ------------------------------ | --------------------------------------- | ---------------------------------- |
| 0   | `X-Internal-Key` wajib (A9)    | `modules/public/guard.ts` (`onRequest`) | `401 INVALID_INTERNAL_KEY`         |
| 0   | Skema Zod `strictObject`       | `schema.body` rute + `@ornament/shared` | `400 VALIDATION_FAILED`            |
| 1   | `ipHash` pengunjung            | `client-identity.ts`                    | —                                  |
| 2   | Rate limit per `ipHash` (§2.3) | `submit-throttle.ts`                    | `429 RATE_LIMITED` + `Retry-After` |
| 3   | Honeypot (A6)                  | `submit.ts`                             | **sukses palsu**                   |
| 4   | `Idempotency-Key` (§1.8)       | `lib/idempotency.ts`                    | `409`/`422`                        |

Rute tulis wajib memakai `config: publicWriteAccess("alasan")`; yang lupa gagal
saat registrasi, dan `test/unit/public-access.test.ts` menuliskan daftar rute
tulis yang diizinkan secara eksplisit supaya penambahannya terlihat saat review.

### Endpoint

| Method & path                             | Respons sukses                        | Catatan                                           |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `POST /v1/public/inquiries`               | `201 { data: { reference } }`         | Hanya `reference` — seluruh isi `Inquiry` 🔒 (§4) |
| `POST /v1/public/articles/:slug/comments` | `202 { data: { status: "PENDING" } }` | Artikel harus tayang; selain itu `404`            |
| `POST /v1/public/inquiry-uploads`         | —                                     | Presign ditunda; lihat "Lampiran" di bawah        |

### Nilai yang diisi server (inquiry)

Tidak satu pun bisa dikirim klien (`strictObject` menolaknya, §1.3):

- `number` dari `nextval` sequence kolomnya, `reference = "INQ-" + lpad(number, 4)`
  dalam `INSERT` yang sama (§6.5). Sequence tidak transaksional, jadi submit yang
  gagal meninggalkan lubang nomor — itu disengaja: satu nomor tidak pernah dipakai dua kali.
- `subject` turunan (§6.5): `"<kategori> <material> — n pcs"` bila keduanya terisi,
  selain itu `"<material ?? kategori ?? 'Permintaan produk'> — n pcs"`.
- `categoryLabel`/`materialLabel` = **salinan** nama taksonomi saat submit, supaya
  inquiry lama tetap terbaca setelah kategori diganti nama atau dihapus (`SetNull`).
  `categoryId`/`materialId` yang tidak dikenal → `400` dengan `details[].code = "not_found"`.
- `targetShipDate` diturunkan dari `targetShipText` bila polanya terbaca
  (`parseTargetShipDate` di `@ornament/shared`, dipakai server **dan** form):
  `2026-11-17` → tanggal itu; `2026-11`/`Nov 2026`/`November 2026` → tanggal 1 bulan itu;
  `Q3 2026` → tanggal 1 kuartal itu; `ASAP`/`Flexible`/`Early next month` → `null`.
  Nama bulan Indonesia ikut dikenali (kontrak hanya menyebut yang Inggris).
- `status = NEW`, `ipHash`, `userAgent`, plus satu baris `ActivityLog`
  (`kind: INQUIRY`, `actorId: null`) dalam transaksi yang sama.

### IP pengunjung dan `ipHash`

Pemanggil rute ini selalu server Next, jadi `request.ip` bukan IP pengunjung.
Next meneruskannya lewat `X-Client-Ip` (dan `X-Client-User-Agent`), dan header itu
**hanya dipercaya bila `X-Internal-Key` valid** (ADR K7, §1.2) — tanpa itu header
diabaikan dan IP koneksi yang dipakai.

Yang disimpan adalah `ipHash`, bukan IP mentah (§6.11), dan hash-nya
**ber-kunci**: `HMAC-SHA256(INTERNAL_API_KEY, "ip:" + ip)`. SHA-256 polos atas IP
bukan perlindungan — ruang IPv4 hanya 2^32 nilai, jadi dump DB bisa dibalik
dengan tabel pelangi. Konsekuensi yang disadari: **merotasi `INTERNAL_API_KEY`
mengubah semua `ipHash` berikutnya**, sehingga jendela rate limit yang sedang
berjalan ikut ter-reset. Itu diterima karena `ipHash` memang berumur pendek
(30 hari) dan hanya dipakai untuk anti-spam.

### Rate limit per `ipHash` (§2.3)

| Rute                                   | Batas                          |
| -------------------------------------- | ------------------------------ |
| `POST /public/inquiries`               | 5 / jam **dan** 20 / hari      |
| `POST /public/inquiry-uploads`         | 15 / jam                       |
| `POST /public/articles/:slug/comments` | 5 / 10 menit **dan** 30 / hari |

Dua jendela sekaligus tidak bisa dinyatakan dengan satu `max` + satu
`timeWindow`, dan kuncinya `ipHash` (baru diketahui di dalam handler) — karena
itu batas ini memakai `AttemptThrottle`, bukan `@fastify/rate-limit`. Request
yang sudah ditolak jendela pendek **tidak** menghabiskan kuota jendela panjang,
dan `Retry-After` memakai sisa terlama dari semua jendela.

Batasannya sama dengan store rate limit bawaan: **state per proses**, hilang saat
restart, dan berlipat bila API di-scale-out. Jaring pengaman per IP koneksi tetap
ada dari `publicWriteAccess()`.

### Honeypot (A6)

Form publik punya field `website` yang disembunyikan dan harus tetap kosong.
Terisi → **respons sukses palsu**: `201` dengan `reference` acak yang tidak
pernah tersimpan, atau `202 { status: "PENDING" }` tanpa komentar. Tidak ada
baris yang dibuat, dan kunci idempotensinya pun tidak dipakai — bot tidak
mendapat sinyal apa pun untuk dipelajari. Yang tercatat hanya satu baris log
`info` tanpa isi body.

Honeypot dicek **sebelum** artikel dicari, sehingga bot juga tidak bisa memakai
endpoint ini untuk menebak artikel mana yang sedang draf.

### Idempotensi (§1.8)

`Idempotency-Key` (16–128 karakter) **wajib** di kedua submit. Server menyimpan
`(key, rute, ipHash) → status + body respons` selama 24 jam di tabel
`idempotency_record` (migrasi `…_idempotensi_submit_publik`).

Tabel sendiri, bukan kolom di `inquiry`/`comment`, karena penguncinya harus ada
_sebelum_ baris domain dibuat — indeks unik `(scope, actor, key)`-lah yang
memutuskan siapa yang menang saat dua request tiba bersamaan. Dan bukan peta di
memori seperti `AttemptThrottle`, karena yang hilang saat restart di sini bukan
sekadar hitungan percobaan melainkan jaminan "tidak ada baris ganda".

| Situasi                                | Respons                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| Kunci baru                             | Handler dijalankan, hasilnya disimpan                         |
| Kunci sama + body sama, sudah selesai  | Respons tersimpan + `Idempotent-Replayed: true`               |
| Kunci sama + body sama, masih berjalan | `409 IDEMPOTENCY_IN_PROGRESS`                                 |
| Kunci sama + body berbeda              | `422 IDEMPOTENCY_KEY_REUSED`                                  |
| Kunci sama, `ipHash` berbeda           | Dianggap kunci lain (tidak pernah membaca respons orang lain) |

Handler yang **gagal** menghapus barisnya lagi, sehingga kegagalan sementara
tidak mengunci kunci itu selama 24 jam. Baris kedaluwarsa dibuang saat kunci itu
dipakai lagi; job pembersih terjadwal belum ada (lihat "Yang belum" di bawah).

### Komentar: antrean moderasi

Komentar publik selalu masuk `PENDING` (§6.8) dan karena itu **tidak** muncul di
`GET /v1/public/articles/:slug/comments`, yang hanya menampilkan `APPROVED`.
`authorEmail` wajib (Q9) dan 🔒: ia tidak pernah keluar lewat DTO mana pun —
tidak juga sebagai hash Gravatar.

`parentId` **tidak ada** di skema input, jadi komentar publik selalu komentar
akar; balasan bersarang (maks 1 tingkat, §3.6) hanya dibuat admin di Tahap 6.
Kontrak §5.3 memang tidak mencantumkan `parentId` pada body publik, jadi
mengirimnya ditolak `400` dengan `code: "unrecognized_keys"`.

### Email

Notifikasi inquiry ke `SiteSetting.contactEmail` dikirim lewat Resend sejak
Tahap 8 (`modules/email/resend.ts`); tanpa `RESEND_*` ia jatuh ke
`NoopEmailSender`. Hasilnya disimpan apa adanya di
`Inquiry.notificationMessageId` / `notificationError` (`EMAIL_NOT_CONFIGURED`,
atau `CONTACT_EMAIL_NOT_SET` bila baris `SiteSetting` belum ada). Kegagalan
kirim **tidak pernah** menjadi 5xx dan tidak mengubah respons (ADR K4, kontrak
§1.10) — inquiry tetap tersimpan dan admin melihat "belum terkirim" alih-alih
dibuat mengira tim sudah diberi tahu.

### Lampiran: presign ditunda ke Tahap 7

Kontrak §5.4 (A5) menetapkan presigned `PUT` ke R2, maks 3 berkas × 10 MB lewat
`POST /v1/public/inquiry-uploads`, lalu `attachmentUploadIds` saat submit.

Menandatangani `PUT` SigV4 membutuhkan `@aws-sdk/client-s3` +
`s3-request-presigner` yang belum ada di dependensi, sementara `R2_*` juga belum
terisi sehingga hasilnya tidak bisa diverifikasi terhadap R2 sungguhan. Menulis
SigV4 sendiri tanpa bucket untuk mengujinya adalah kode kripto yang tidak pernah
terbukti benar, jadi **penandatanganannya** ditunda ke Tahap 7 (Media), yang
memang akan membangun presign admin.

Yang **sudah** berlaku sekarang di `POST /v1/public/inquiry-uploads`: key
internal wajib (`401`), rate limit 15/jam per `ipHash` (`429`), allowlist MIME
PDF/JPEG/PNG (`415`), dan batas 10 MB (`413`). Request yang lolos semuanya
dijawab `503 SERVICE_UNAVAILABLE` dengan pesan yang bisa ditampilkan —
bukan `500`, dan bukan `201` dengan URL yang tidak bisa dipakai.

Submit inquiry **tanpa** lampiran berjalan penuh. Submit dengan
`attachmentUploadIds` dijawab `422 UPLOAD_INVALID` dengan
`details: { reason: "NOT_FOUND", uploadId }` — persis jawaban kontrak untuk
upload yang tidak ada atau kedaluwarsa, yang memang keadaannya: tidak ada
`uploadId` yang pernah diterbitkan API ini.

### Yang belum (menunggu tahap berikutnya)

- Job harian §6.11 (mengosongkan `ipHash`/`userAgent` > 30 hari) dan pembersih
  `idempotency_record` kedaluwarsa terjadwal.
- Moderasi komentar & balasan admin (Tahap 6, PR berikutnya), yang juga
  menegakkan nesting maks 1 tingkat.
- Presign R2 (Tahap 7) dan Resend (Tahap 8), lihat dua bagian di atas.

## Admin produk (`/v1/admin/products/*`)

Kontrak §5.6. Dua lapis izin dipakai bersama dan sengaja dipisah:

1. **Matriks §3** lewat `config.adminAccess` — "peran ini punya tombolnya?".
2. **Kepemilikan/status** lewat `modules/admin/products/access.ts` — "boleh untuk
   baris ini?". Contributor hanya boleh menulis **draf miliknya sendiri** (A1);
   penolakannya `403` dengan `details.reason` `NOT_OWNER`/`NOT_DRAFT` (§2.4),
   **bukan** `404`, karena membaca produk orang lain memang boleh (§3.2).

| Method & path                                      | Penanda izin          | Catatan                                                                       |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `GET /admin/products`                              | `adminSession()`      | Paginasi nomor halaman + `meta.counts` (`all`, `PUBLISHED`, `DRAFT`, `trash`) |
| `POST /admin/products`                             | `product.write_draft` | Selalu `DRAFT`, `revision = 1`, 4 baris QC `PENDING`                          |
| `POST /admin/products/sku-suggestions`             | `product.write_draft` | Tidak menyimpan apa pun; `POST` karena mengambil nomor sequence               |
| `POST /admin/products/bulk`                        | `product.write_draft` | Izin dicek **per item**; `BulkResult`, sukses parsial                         |
| `GET /admin/products/:id`                          | `adminSession()`      | Termasuk yang di Trash                                                        |
| `PATCH /admin/products/:id`                        | `product.write_draft` | `expectedRevision` wajib (§1.9)                                               |
| `POST /admin/products/:id/publish` \| `/unpublish` | `product.publish`     | Editor+                                                                       |
| `POST /admin/products/:id/duplicate`               | `product.write_draft` | `Idempotency-Key` opsional (§1.8)                                             |
| `DELETE /admin/products/:id`                       | `product.trash`       | Trash (`deletedAt`), bukan hapus                                              |
| `POST /admin/products/:id/restore`                 | `product.restore`     | **Selalu** kembali `DRAFT` (Q3)                                               |
| `DELETE /admin/products/:id/permanent`             | `product.purge`       | Administrator saja (A3)                                                       |
| `PATCH /admin/products/:id/qc/:stage`              | `product.qc`          | Tidak menaikkan `revision`                                                    |
| `GET /admin/products/:id/revisions[/:number]`      | `adminSession()`      | Snapshot 🔒: Contributor hanya miliknya                                       |

Rute **baca** memakai `adminSession()`, bukan izin tulis yang kebetulan dimiliki
ketiga peran: kontrak §3.2 memang memberi baca ke semua peran, dan menulis
`adminPermission('product.write_draft')` pada sebuah `GET` akan menyesatkan
pembaca rute.

### Syarat publish (§6.3)

`name`, `sku`, `categoryId`, `artisanId`, `primaryImageId`, tepat satu material
primer, `moqQuantity`, dan pengrajin tidak diarsipkan. Satu fungsi
(`publishRequirementIssues()`) melayani dua tempat sekaligus:

- `publishReadiness: { ready, missing[] }` di **setiap** respons produk — untuk
  tombol "Terbitkan" di UI;
- `details` pada `422 PUBLISH_REQUIREMENTS_NOT_MET` — `[{ path, code }]`.

Karena sumbernya satu, tombol di UI dan penolakan server tidak pernah bisa
berbeda pendapat. `code` `artisan_archived` dibedakan dari `required`: UI perlu
menyarankan **mengganti** pengrajin, bukan mengisinya.

`PATCH` pada produk yang sedang tayang ikut diperiksa: perubahan yang membuatnya
tidak layak tayang (mis. `primaryImageId: null`) ditolak `422` dan seluruh
transaksi dibatalkan, sehingga tidak ada pintu belakang menuju produk terbit
yang tidak lengkap.

### Revisi, stok, duplikat, Trash

- **Revisi (§6.3):** setiap simpan yang mengubah isi menaikkan `revision` dan
  menulis `ProductRevision` **dalam transaksi yang sama**. Snapshot disimpan
  sebagai DTO `AdminProduct`, bukan baris Prisma mentah, supaya riwayat lama
  tetap terbaca dengan kontrak yang sama. Menyimpan tanpa perubahan tidak
  menaikkan revisi (kontrak §5.6), jadi menekan Simpan dua kali tidak memalsukan
  riwayat.
- **Stok (Q13/A11):** `stockStatus` adalah turunan yang **disimpan**, dihitung
  server setiap simpan lewat `deriveStockStatus()` di `@ornament/shared` (override
  → `MADE_TO_ORDER` bila tanpa jumlah → `LOW_STOCK` bila ≤ ambang → `IN_STOCK`).
  Klien tidak pernah mengirimnya (`strictObject` → `400`). Satu-satunya validasi
  A11: status efektif `MADE_TO_ORDER` mewajibkan `stockQuantity = null`.
- **Duplikat (§6.3):** `<nama> (copy)`, slug `<slug>-copy`, `sku = null`,
  `DRAFT`, `revision = 1`, `duplicatedFromId` terisi, dan checklist QC **direset**
  ke `PENDING` — `criteria` ikut disalin karena ia isi produk, sedangkan status,
  catatan, dan `checkedBy`/`checkedAt` adalah hasil pemeriksaan barang lain.
- **Trash (§6.4):** `DELETE` mengisi `deletedAt`; `restore` mengosongkannya dan
  **selalu** mengembalikan `publishStatus = DRAFT` (`publishedAt` dipertahankan
  sebagai jejak pernah tayang). Justru karena pemulihan tidak pernah menayangkan
  konten, Contributor boleh memulihkan miliknya sendiri tanpa izin terbit.
- **Redirect slug (§6.10):** slug berubah → `SlugRedirect` slug lama dibuat dan
  redirect yang `fromSlug`-nya = slug baru dihapus (slug aktif selalu menang),
  semuanya dalam transaksi yang sama. Hasilnya langsung terbaca
  `GET /v1/public/redirects?type=PRODUCT&slug=<slug lama>`.

### Saran SKU (§6.2)

`POST /admin/products/sku-suggestions` mengembalikan `ORN-<skuCode>-<NNNN>` bila
material primer punya `skuCode`, atau `ORN-<YYMM>-<NNNN>` bila tidak. `YYMM`
memakai `SiteSetting.timezone` lewat `Intl`, bukan UTC: saran yang dibuat
1 September pukul 06.00 WIB tidak boleh berkode Agustus. `NNNN` diambil dari
sequence Postgres `product_sku_seq` (migrasi awal) dan **tidak transaksional** —
saran yang tidak jadi dipakai meninggalkan lubang nomor, dan itu memang yang
diinginkan: nomor tidak pernah dipakai dua kali. Server tidak pernah mengisi
`sku` diam-diam (Q6).

## Admin taksonomi (`/v1/admin/categories|materials|tags`)

Kontrak §5.7. **Satu set endpoint melayani dua tabel** lewat query `type` (Q4):
`PRODUCT` → `Category` (hierarkis), `ARTICLE` → `ArticleCategory` (datar). Layar
`/admin/taxonomy` memakainya sebagai tab Produk/Artikel; tidak ada modul admin
kedua yang harus ikut diubah setiap kali aturannya bergeser.

Izin (§3.2): **baca** boleh semua peran (`adminSession()`), **tulis** butuh
`taxonomy.write` (Editor+) karena taksonomi memengaruhi katalog dan journal
publik.

- **Pohon kategori** disusun di memori dari **satu** query (`flattenTree()` yang
  sama dengan katalog publik), lalu `productCount` dijumlahkan naik ke setiap
  leluhur dengan `rollUpCounts()` — bukan satu query per kategori.
- **Siklus ditolak** (`422 CATEGORY_CYCLE`): induk tidak boleh dirinya sendiri
  maupun turunannya. Dicek di aplikasi karena FK `Restrict` hanya menjamin
  induknya ada, bukan bahwa pohonnya tetap pohon.
- **`PUT /categories/order`** menerima **seluruh** pohon sekaligus dalam satu
  transaksi; kiriman sebagian ditolak `422 CATEGORY_SET_MISMATCH`, karena
  menerapkannya akan menghasilkan urutan yang tidak pernah diminta siapa pun.
- **Hapus yang masih dipakai** → `409 IN_USE` dengan `details.counts` per
  `entityType` dan `total` dari hitungan **sebenarnya**, sementara `usages` hanya
  memuat maksimal 20 contoh (Q5). UI menulis "masih digunakan oleh 9 produk" dari
  `counts`, jadi angkanya tidak boleh ikut terpotong bersama daftar contohnya.
- **Tag** tidak punya `409 IN_USE`: relasinya `Cascade`, jadi menghapus tag hanya
  melepaskannya dari konten.
- **`Material.skuCode`** unik dan dinormalisasi huruf besar (`^[A-Z]{3}$`).
  Mengubahnya **tidak** mengubah SKU produk lama (§6.2): SKU yang sudah tercetak
  di dokumen tidak boleh berubah sendiri.

### `409 CONFLICT` dengan driver adapter

Dengan `@prisma/adapter-pg` (ADR K1) Prisma **tidak** lagi mengisi `meta.target`
pada `P2002`; yang tersedia hanya nama indeks Postgres di
`meta.driverAdapterError.cause.constraint.index` (mis. `material_sku_code_key`).
`lib/prisma-error.ts` menerjemahkannya menjadi nama field kontrak
(`details.fields: ["skuCode"]`). Tanpa itu setiap konflik jatuh ke tebakan
default dan UI menyorot field yang salah.

### Siapa boleh membuat tag baru

`Tag` adalah satu tabel untuk produk **dan** artikel (model §3.3), jadi
menambah baris di sana adalah menulis taksonomi — `taxonomy.write`, Editor+
(§3.1) — bukan menulis draf sendiri. Tag tidak punya endpoint `POST`: ia lahir
implisit dari `tags: string[]` saat produk atau artikel disimpan, sehingga
batasnya ditegakkan di `modules/admin/tags.ts`, bukan di guard rute.

Contributor tetap bebas **memakai** tag yang sudah ada — yang datang dari
autocomplete `GET /v1/admin/tags` — tetapi nama yang belum ada dijawab
`403 FORBIDDEN` dengan `details.reason = "TAG_NOT_FOUND"` dan
`details.unknownTags` berisi semua nama yang tidak ditemukan sekaligus, agar
editor yang mengetik tiga tag baru tahu ketiganya dalam satu kali simpan.

Menolak lebih baik daripada membuang diam-diam: tag yang hilang tanpa kabar
akan tampak seperti bug penyimpanan, dan lebih baik daripada membiarkannya
karena peran paling tidak privileged tidak seharusnya bisa menumbuhkan
taksonomi yang dikurasi Editor.

## Admin pengrajin (`/v1/admin/artisans/*`)

Kontrak §5.8, model §3.4 & §6.7. Berbeda dengan produk dan artikel, pengrajin
**tidak** punya batas kepemilikan: matriks §3.1 menempatkannya sebagai "tulis
Editor+, Contributor hanya lihat". Yang bercabang per peran adalah **bentuk
DTO-nya**.

| Method & path                                         | Penanda izin           | Catatan                                                        |
| ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| `GET /admin/artisans`                                 | `adminSession()`       | Nomor halaman + `meta.counts` per `ArtisanStatus` + `archived` |
| `POST /admin/artisans`                                | `artisan.write`        | `status` **selalu** `VERIFICATION`                             |
| `GET /admin/artisans/:id`                             | `adminSession()`       | Editor+: `AdminArtisan`; Contributor: `ArtisanRedacted`        |
| `PATCH /admin/artisans/:id`                           | `artisan.write`        | `expectedUpdatedAt` wajib (§1.9)                               |
| `POST /admin/artisans/:id/archive` \| `/unarchive`    | `artisan.write`        | Arsip memberi `warnings`, bukan menolak (A10)                  |
| `GET /admin/artisans/:id/documents`                   | `artisan.read_private` | Editor+ saja                                                   |
| `POST \| PATCH \| DELETE .../documents[/:documentId]` | `artisan.write`        | Berkas wajib Media `PRIVATE`                                   |
| `GET .../documents/:documentId/url`                   | `artisan.read_private` | Presigned GET; lihat catatan R2 di bawah                       |

### Field 🔒: dihapus, bukan dijadikan `null`

`ArtisanRedacted` **tidak memuat** `contactName`, `phone`, `address`, dan
`internalNotes` sama sekali. Bedanya bukan kosmetik: `null` berarti "belum
diisi" dan akan membuat UI Contributor menampilkan field telepon yang seolah
menunggu diisi, sementara yang benar adalah "bukan urusan Anda".

Kedua DTO dibangun dari fungsi yang sama (`toArtisanRedacted()`), lalu
`toAdminArtisan()` menambahkan empat field 🔒 di atasnya. Karena itu menambah
field publik baru tidak bisa membuat keduanya menyimpang, dan satu-satunya jalan
field 🔒 masuk respons adalah lewat cabang Editor+ di `routes.ts`.

### Arsip (§6.7, A10)

Mengarsipkan pengrajin yang masih punya produk terbit **diizinkan**. Responsnya
memuat `warnings: [{ code: "HAS_PUBLISHED_PRODUCTS", count }]`, dan akibatnya:

- `/v1/public/artisans/:slug` → `404` (profilnya hilang dari situs);
- produknya **tetap tayang** di katalog;
- di detail produk publik, pengrajin muncul ringkas **tanpa tautan**
  (`slug: null`), sehingga tidak ada pranala menuju halaman 404.

Pengrajin yang diarsipkan tidak bisa di-`PATCH` (`409 INVALID_STATE`); pulihkan
dulu dari arsip. `unarchive` **mempertahankan** `status` — arsip bukan status
publikasi, jadi memulihkan tidak boleh diam-diam mengubah profil `ACTIVE`
menjadi sesuatu yang lain.

Menghapus pengrajin tidak tersedia (model D3). Slug pengrajin **tidak** menulis
`SlugRedirect`: model §6.10 membatasinya pada `Product` dan `Article`.

### Dokumen 🔒 dan URL berdurasi pendek

`ArtisanDocument` menunjuk Media `PRIVATE` (keputusan #49/#50): KTP dan nomor
rekening diunggah sebagai berkas `IDENTITY`/`BANK_ACCOUNT`, bukan kolom teks,
sehingga tidak perlu enkripsi tingkat field. Server menegakkan kebalikan dari
aturan media publik:

- media `PUBLIC` sebagai dokumen → `422 MEDIA_NOT_PRIVATE`;
- media yang sudah menjadi dokumen lain → `422 MEDIA_ALREADY_USED` (aturan
  tambahan di luar daftar kontrak §5.8: satu berkas privat hanya boleh punya
  satu pemilik, supaya menghapus dokumen tidak membuat dokumen lain kehilangan
  berkasnya). Yang **menegakkan** aturan ini adalah indeks unik
  `artisan_document.media_id`, bukan pemeriksaan `findFirst` di service:
  `findFirst` + `create` bisa dibalap dua request bersamaan, dan pihak yang
  kalah menerima `422` yang sama, bukan `500`;
- menghapus dokumen memindahkan **Media**-nya ke Trash (pemulihan 30 hari §6.4),
  bukan menghapus objek R2.

`GET .../documents/:documentId/url` menegakkan seluruh kontrak di sekelilingnya
(izin Editor+, dokumen harus milik pengrajin yang diminta, `404` untuk yang
bukan) lalu menjawab **`503 SERVICE_UNAVAILABLE`**: penandatanganan presigned
GET ditunda ke Tahap 7 bersama modul media, dengan alasan yang sama seperti
presign lampiran inquiry (SigV4 tanpa bucket untuk mengujinya adalah kode
kripto yang tidak pernah terbukti benar). Yang dijawab bukan `500`, dan bukan
`200` dengan URL yang tidak bisa dipakai.

## Admin artikel (`/v1/admin/articles/*`)

Kontrak §5.9, model §3.6 & §6.6. Dua lapis izin yang sama dengan produk;
"draf" untuk artikel berarti `status === 'DRAFT'`, jadi artikel `SCHEDULED`
sudah di luar jangkauan Contributor.

| Method & path                                      | Penanda izin          | Catatan                                                          |
| -------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| `GET /admin/articles`                              | `adminSession()`      | `meta.counts`: `all`, `DRAFT`, `SCHEDULED`, `PUBLISHED`, `trash` |
| `POST /admin/articles`                             | `article.write_draft` | `DRAFT`, penulis = diri sendiri; juga "Draf cepat" (Q1)          |
| `POST /admin/articles/bulk`                        | `article.write_draft` | Izin dicek **per item**; `BulkResult`                            |
| `GET /admin/articles/:id`                          | `adminSession()`      | Termasuk yang di Trash                                           |
| `PATCH /admin/articles/:id`                        | `article.write_draft` | `expectedUpdatedAt` wajib (§1.9)                                 |
| `POST /admin/articles/:id/publish` \| `/unpublish` | `article.publish`     | `publishAt` masa depan = `SCHEDULED`                             |
| `POST /admin/articles/:id/preview`                 | `article.write_draft` | DTO publik **tanpa menyimpan**                                   |
| `DELETE /admin/articles/:id`                       | `article.write_draft` | Trash; katalog `Permission` tidak punya `article.trash`          |
| `POST /admin/articles/:id/restore`                 | `article.restore`     | **Selalu** `DRAFT`, `publishAt = null` (Q3)                      |
| `DELETE /admin/articles/:id/permanent`             | `article.purge`       | Administrator saja (A3); komentar ikut terhapus                  |

Contributor yang mengirim `slug` atau `authorId` ditolak `403 FORBIDDEN_FIELD`:
URL publik adalah keputusan Editor+ (§6.1), dan `authorId` akan memindahkan
kepemilikan — dan dengan itu batas A1 — ke orang lain.

### Isi berbasis blok

`Article.content` divalidasi `articleContentInputSchema` di `@ornament/shared`:
skema blok **yang sama** dengan yang dipakai journal publik, ditambah syarat
`id` blok unik. Blok bertipe tak dikenal, `mediaId` bukan UUID, atau id ganda
ditolak `400 VALIDATION_FAILED` sebelum menyentuh database — tidak ada bentuk
yang bisa tersimpan lewat editor admin lalu dibuang diam-diam saat dirender.

`wordCount` diturunkan saat simpan dengan `countArticleWords()` dari paket
bersama, sehingga angka "Kata: 612" di editor persis sama dengan yang tersimpan.

### Syarat publish (§6.6)

`title`, `categoryId`, `content` tidak kosong, dan **alt pada gambar** — gambar
unggulan maupun setiap blok gambar, karena keduanya dirender publik. `details`
pada `422 PUBLISH_REQUIREMENTS_NOT_MET` memakai path per blok
(`content[2].mediaId`, `code: "alt_required"`) agar editor bisa menyorot blok
yang salah. `PATCH` pada artikel yang sudah terbit/terjadwal ikut diperiksa,
jadi `categoryId: null` tidak bisa menjadi pintu belakang.

Menjadwalkan ke waktu yang sudah lewat → `422 BUSINESS_RULE_VIOLATION`
(`rule: "PUBLISH_AT_IN_PAST"`); kosongkan `publishAt` untuk terbit sekarang.

### Pratinjau

`POST /:id/preview` menumpuk body parsial (isi editor yang belum disimpan) di
atas baris tersimpan, lalu melewatkannya ke transformasi DTO publik **yang
sama** dengan `/v1/public/articles/:slug`. Itu disengaja: pratinjau dengan
aturan sendiri akan berbohong justru di tempat yang paling mahal — blok gambar
yang medianya `PRIVATE`/hilang dibuang di publik, `excerpt` kosong diturunkan
dari paragraf pertama, dan `mediaId` ditukar `PublicMedia`.

Tidak ada baris yang ditulis: tag baru di body hanya dihitung slugnya
(`slugify()`), bukan dibuat. `commentCount` selalu `0`, dan artikel yang belum
terbit dipratinjau seolah terbit sekarang.

### Draf cepat dashboard (Q1)

Kartu "Draf cepat" memakai endpoint `POST /admin/articles` yang sama — tidak ada
rute khusus. Catatan diubah menjadi blok `paragraph` pertama dengan
`quickDraftContent()` di `@ornament/shared`, hasilnya `DRAFT` dengan
`categoryId: null`, dan responsnya memuat `data.id` yang dipakai UI untuk
menautkan ke `/admin/articles/<id>`.

### Publikasi terjadwal (ADR K8)

Query publik **sudah** menganggap `SCHEDULED && publishAt <= now()` sebagai
terbit, jadi artikel tayang tepat waktu tanpa job. Yang dikerjakan job adalah
merapikan _state_: memindahkan status ke `PUBLISHED` dan mengisi `publishedAt`
dari `publishAt`, sehingga daftar admin, hitungan tab, dan urutan `-publishedAt`
tidak perlu mengulang aturan "sudah jatuh tempo" di setiap tempat.

- **Satu `UPDATE ... WHERE status = 'SCHEDULED' ... RETURNING`**. Dua instance
  yang berjalan bersamaan saling menunggu di row lock, lalu yang kalah
  memperbarui **nol** baris — tidak ada tabel lock dan tidak ada leader election.
- **Idempoten**: putaran kedua tanpa jadwal baru mengembalikan
  `{ published: 0 }` dan tidak menulis `ActivityLog`.
- **Berhenti saat shutdown** lewat hook `onClose`, dan timernya `unref()` supaya
  tidak pernah menahan proses tetap hidup.
- **Tidak mengganggu tes**: `buildApp({ scheduledPublish: false })` mematikannya,
  dan defaultnya hanya aktif bila `config` diberikan (yaitu `src/server.ts`).
  Tes memanggil `publishScheduledArticles(prisma)` langsung alih-alih menunggu
  interval 60 detik.

Endpoint cron eksternal `POST /v1/internal/jobs/publish-scheduled` (kontrak
§5.17) **belum** ada; seluruh `/v1/internal/*` menyusul bersama modul job
eksternal.

## Moderasi komentar (`/v1/admin/comments/*`)

Kontrak §5.10, model §6.8 & §6.11.

**Contributor tidak punya akses sama sekali** (A2) — termasuk membaca daftar,
karena isinya email pengunjung. Ini satu-satunya modul admin yang rute bacanya
pun digantung pada izin (`comment.moderate`), bukan `adminSession()`.

`ipHash` dan `userAgent` **tidak pernah** masuk DTO, bahkan untuk
Administrator. Keduanya dikumpulkan untuk anti-spam otomatis, bukan untuk
dibaca manusia, dan dikosongkan setelah 30 hari (§6.11). `authorEmail` justru
ikut: moderator memakainya untuk menilai spam.

| Aturan               | Perilaku                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `DELETED`            | Titik akhir: `409 INVALID_STATE` untuk perubahan apa pun sesudahnya                           |
| `SPAM`               | Masih bisa kembali ke `APPROVED` (§6.8)                                                       |
| Balasan admin        | Langsung `APPROVED`; induk yang masih `PENDING` ikut disetujui dalam transaksi yang sama (A7) |
| Balasan atas balasan | `422 REPLY_DEPTH_EXCEEDED` — utas publik satu tingkat                                         |
| Artikel belum terbit | `422 ARTICLE_NOT_PUBLISHED`                                                                   |

### Anonimisasi (§6.11)

Administrator saja (A3), karena tidak bisa dibatalkan. Idempoten: setiap field
ditulis ke nilai tetap, jadi menjalankannya dua kali menghasilkan keadaan yang
sama.

Komentar `APPROVED` mempertahankan `body` — utas publik tetap utuh — sedangkan
yang tidak tayang kehilangan isinya juga, karena isi itu tidak pernah dibaca
publik dan menyimpannya hanya menahan data yang diminta hilang.

`ActivityLog` dengan `entityType`/`entityId` yang sama ikut diganti pesan
generik. Tanpa langkah itu anonimisasi hanya memindahkan nama dan kutipan isi
ke tabel lain.

`sameEmail: true` menyapu seluruh komentar **dan** inquiry dengan email yang
sama (hak GDPR untuk dihapus): satu orang yang meminta datanya hilang tidak
seharusnya perlu mengajukannya dua kali untuk dua modul. Lampiran inquiry ikut
dihapus beserta Media dan objek R2-nya — objek dihapus **setelah** transaksi
commit, karena gagal menghapus berkas hanya menyisakan objek yatim sedangkan
membatalkan anonimisasi yang sudah tercatat akan mengembalikan data pribadi.

## Inbox inquiry (`/v1/admin/inquiries/*`)

Kontrak §5.11, model §3.7 & §6.5. Contributor tidak punya akses — inquiry
adalah data pembeli (nama, email, anggaran), bukan konten.

**`GET` tidak menandai dibaca.** Itu aksi tersendiri lewat `PATCH { read: true }`,
supaya mengintip detail tidak sama dengan menerima pekerjaannya.

Daftar memakai `preview` ±120 karakter, bukan `message` penuh: inbox memuat
puluhan baris sekaligus dan isi lengkap permintaan pembeli tidak perlu ikut ke
setiap muat halaman.

### Transisi status (§6.5)

| Dari → ke                      | Boleh?                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `NEW` → `IN_PROGRESS` / `DONE` | ✓                                                                        |
| `IN_PROGRESS` → `DONE`         | ✓                                                                        |
| `IN_PROGRESS` → `NEW`          | ✗ — "belum dibaca" tidak bisa dibuat ulang                               |
| `DONE` → apa pun               | ✗ lewat tombol; `IN_PROGRESS` hanya lewat balasan baru yang **terkirim** |

`completedAt` diisi saat `DONE` dan dikosongkan saat inquiry terbuka kembali,
supaya laporan tidak menghitung dua kali.

### Balasan

Disimpan `DRAFT` lebih dulu, dikirim **setelah commit** (§6.5). Email adalah
panggilan jaringan ke pihak ketiga: menjalankannya di dalam transaksi menahan
koneksi database selama Resend lambat, dan rollback-nya akan membuang balasan
yang mungkin sudah terkirim.

`toEmail` diambil saat balasan **dibuat**, bukan saat dikirim — inquiry yang
dianonimkan di antara keduanya tidak boleh membangkitkan alamat yang sudah
dihapus.

Kegagalan email **tidak pernah** menjadi 5xx (§1.10): `200` dengan
`status: FAILED` + `emailError`, dan bisa dikirim ulang. `SENT` tidak bisa
diedit, dihapus, maupun dikirim ulang; `FAILED` boleh dihapus karena tidak
pernah sampai ke siapa pun.

Lampiran diunduh dari R2 dan ikut sebagai berkas di email, bukan sebagai
tautan bertanda tangan: penerimanya pembeli di luar organisasi, dan URL
berumur 5 menit akan mati sebelum sempat dibuka.

`Idempotency-Key` disarankan pada `/send`: klik ganda tidak boleh mengirim dua
email ke pembeli.

### Email (ADR K4)

`RESEND_API_KEY` + `RESEND_FROM` lengkap → `ResendEmailSender`; salah satu
kosong → `NoopEmailSender` yang melaporkan `EMAIL_NOT_CONFIGURED`. Satu
instance dipakai undangan, notifikasi inquiry, dan balasan inquiry, supaya
ketiganya melaporkan kegagalan dengan cara yang sama. SDK di-`import()` saat
pertama dipakai, dengan alasan yang sama seperti SDK R2.

## Media Library (`/v1/admin/media/*`)

Kontrak §5.12, model §3.2. Berkas **tidak pernah melewati API** (ADR K3):
klien meminta izin unggah, meng-`PUT` langsung ke R2, lalu mengonfirmasi.

```
POST /v1/admin/media/uploads   → { uploadId, uploadUrl, headers, key, expiresAt }
PUT  <uploadUrl>               (klien → R2, tanpa menyentuh API)
POST /v1/admin/media           → 201 AdminMedia   (200 bila tiket diulang)
```

`uploadId` adalah token HMAC berisi `key`, `mimeType`, `sizeBytes`,
`visibility`, `userId`, dan `exp` — sehingga tidak ada tabel unggahan
sementara yang harus dibersihkan saat klien menutup tab di tengah unggahan.
Kuncinya `MEDIA_UPLOAD_SECRET`, dipisah dari kredensial R2 karena masa hidup
dan radius ledakannya berbeda.

**Batas ukuran ditegakkan dua kali.** `Content-Length` ikut ditandatangani,
jadi R2 sendiri menolak unggahan yang lebih besar; lalu konfirmasi memanggil
`HeadObject` dan menolak `422 UPLOAD_INVALID` (`MISMATCH`) bila objek yang ada
tetap berbeda. Satu lapis saja tidak cukup: yang pertama bisa dilewati bila
bucket salah konfigurasi, yang kedua tidak menghalangi berkas besar terlanjur
terunggah.

**Dua tingkat "sedang dipakai"** (model §5), keduanya dihitung
`modules/admin/media/usage.ts` supaya detail dan penjaga hapus tidak pernah
berbeda pendapat:

| Aksi                    | Syarat                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| `DELETE /:id` (Trash)   | tidak dirujuk konten **terbit** → selain itu `409 IN_USE` + `details.usages` |
| `DELETE /:id/permanent` | sudah di Trash **dan** tidak dirujuk apa pun (FK `Restrict`)                 |

Sembilan sumber rujukan punya kolom FK. Yang kesepuluh — blok gambar di dalam
`Article.content` — tidak, jadi ia dicari lewat containment `jsonb`
(`content @> [{"mediaId": …}]`). Tanpa query itu, menghapus gambar yang dipakai
di tengah artikel terbit akan lolos diam-diam.

**Penyimpangan dari kontrak yang perlu dicatat:** `MediaUsage.entityId`
bertipe `string`, bukan `uuid`. `SiteSetting` adalah baris tunggal ber-`id`
integer `1` (model §3.8), dan justru pemakai itulah yang paling tidak boleh
hilang dari daftar.

Media `PRIVATE` tidak pernah punya URL permanen: `AdminMedia.url` selalu
`null` dan `GET /:id/url` menjawab presigned GET 5 menit. Contributor menerima
`404` — bukan `403` — untuk media privat, sehingga keberadaannya pun tidak
bocor. Dokumen pengrajin (`/v1/admin/artisans/:id/documents/:documentId/url`)
memakai jalur presign yang sama; tidak ada penandatanganan kedua yang perlu
dijaga terpisah.

Tanpa `R2_*` dan `MEDIA_UPLOAD_SECRET`, rute yang butuh bucket menjawab
`503 SERVICE_UNAVAILABLE` dan sisa Media Library tetap berfungsi penuh atas
baris yang sudah ada. Lampiran inquiry (`POST /v1/public/inquiries/uploads`,
kontrak §5.4) masih `503`: pengunggahnya pengunjung anonim, bukan sesi admin,
sehingga butuh pembatasan tersendiri dan menyusul bersama modul inquiry.

SDK `@aws-sdk/client-s3` di-`import()` saat pertama dipakai, bukan saat modul
dimuat. Build ESM-nya ditujukan untuk bundler (impor relatif tanpa ekstensi)
dan tidak bisa dimuat pemuat ESM Vite; memuatnya hanya di jalur yang benar-benar
menyentuh R2 membuat seluruh test suite — yang memakai dobel in-memory — tidak
pernah menyentuhnya.

## Script

Jalankan dengan `npm run <script> --workspace backend` dari root, atau
`npm run <script>` di dalam `backend/`.

| Script                           | Fungsi                                                                    |
| -------------------------------- | ------------------------------------------------------------------------- |
| `dev`                            | Server dengan reload otomatis (`tsx watch`, shared dari `src/`)           |
| `build`                          | `prisma generate` lalu kompilasi ke `dist/`                               |
| `start`                          | Jalankan hasil build (`node dist/server.js`)                              |
| `typecheck`                      | `tsc --noEmit` (butuh `packages/shared/dist`)                             |
| `lint`                           | ESLint                                                                    |
| `format` / `format:check`        | Prettier (tulis / cek saja)                                               |
| `test`                           | Semua tes sekali jalan (unit + integration)                               |
| `test:unit` / `test:integration` | Satu project Vitest                                                       |
| `test:watch`                     | Vitest mode watch                                                         |
| `db:generate`                    | `prisma generate`                                                         |
| `db:migrate`                     | `prisma migrate dev` (buat + terapkan migrasi, dev)                       |
| `db:migrate:deploy`              | `prisma migrate deploy` (terapkan migrasi yang ada)                       |
| `db:seed`                        | Isi database dev/tes dengan data mockup (**menghapus isi DB lebih dulu**) |
| `db:studio`                      | Prisma Studio                                                             |

Di root: `db:up` / `db:down` untuk container PostgreSQL, `test` untuk tes backend.

## CI

`.github/workflows/ci.yml` (lihat README root) menjalankan untuk backend:
`npm ci` → `db:generate` → `build:shared` → `typecheck` (shared + backend) →
`lint` → `format:check` → `test` (shared, lalu backend dengan service container
`postgres:18-alpine` dan `TEST_DATABASE_URL`) → `build`.

## Dokumentasi

- [`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md) — keputusan arsitektur
- [`docs/domain-model.md`](docs/domain-model.md) — model domain
- [`docs/api-contract.md`](docs/api-contract.md) — kontrak API
