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
  modules/auth/session.ts        service sesi: token 32 byte, SHA-256 di DB, sliding refresh
  modules/auth/cookie.ts         atribut cookie __Host-osa_session di satu tempat
  modules/auth/guard.ts          app.requireSession / app.requireRole(...)
  modules/auth/login-throttle.ts lockout login per email (in-memory)
  modules/auth/me.ts             DTO Me + permissions turunan peran (kontrak §2.2/§3.3)
  modules/auth/routes.ts         POST login, POST logout, GET me
  modules/public/guard.ts        penanda publicAccess + Cache-Control + rate limit /v1/public/*
  modules/public/media.ts        DTO PublicMedia (URL R2; Media PRIVATE tidak pernah dirujuk)
  modules/public/products/       katalog publik: query keyset, pohon kategori, DTO, rute
  modules/public/artisans/       pengrajin publik: DTO whitelist + rute
  modules/public/articles/       journal publik: aturan "terbit" (ADR K8), keyset, blok isi, komentar
  modules/public/site/           situs publik: settings, menu, halaman & blok, sitemap, redirect
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
  helpers/catalog.ts   fixture kategori/material/pengrajin/produk untuk tes /v1/public/*
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

| Database | Dipakai untuk | `DATABASE_URL` |
| --- | --- | --- |
| `ornament` | dev | `postgresql://ornament:ornament@localhost:5432/ornament?schema=public` |
| `ornament_test` | tes | `postgresql://ornament:ornament@localhost:5432/ornament_test?schema=public` |

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

| Aspek | Aturan |
| --- | --- |
| Nama | Model/field camelCase Inggris (dipakai di kode); tabel, kolom, dan tipe enum di PostgreSQL **snake_case** lewat `@@map`/`@map` — SQL mentah di ADR K8 menulis `publish_at`, dan nama snake_case konsisten memudahkan query manual/psql. Tabel singular (`product`, `article`, `"user"` — dikutip karena kata kunci SQL). |
| ID & waktu | `String @id @default(uuid()) @db.Uuid`; semua `DateTime` memakai `@db.Timestamptz` (UTC, domain model D1). |
| Uang & ukuran | `Decimal` eksplisit: `fob_price_usd`/`budget_per_unit_usd` `DECIMAL(10,2)`, `length/width/height_cm` `DECIMAL(7,1)`, `weight_kg` `DECIMAL(7,2)`. Jangan pakai `Float` untuk uang. |
| JSON | Rich text & blok disimpan `Json` (`product.description`, `article.content`, `artisan.story`, `page_block.config`, `product_revision.snapshot`, `activity_log.metadata`) dan divalidasi Zod di `@ornament/shared` (domain model D7). |
| Soft delete | `deleted_at` pada `product`, `article`, `page`, `media`; `artisan` memakai `archived_at`; `comment`/`user` memakai status. Query daftar wajib menyaring sendiri. |
| Unik | `slug` dan `sku` unik **termasuk baris di Trash** (§6.1/§6.2), jadi unik biasa — bukan unik parsial. |
| Indeks FK | Setiap kolom FK punya indeks; Postgres tidak membuatnya otomatis dan semua aturan hapus (`Restrict`/`SetNull`/`Cascade`) serta hitungan "dipakai di mana" memeriksa sisi anak. |

### Alur migrasi

```bash
# dev: ubah prisma/schema.prisma, lalu buat + terapkan migrasi
npm run db:migrate --workspace backend -- --name <nama-perubahan>
# staging/production/CI: terapkan migrasi yang sudah di-commit, tanpa membuat baru
npm run db:migrate:deploy --workspace backend
# cek apakah DB tertinggal dari folder migrasi
npx prisma migrate status
```

- `prisma migrate dev` tanpa perubahan harus menjawab *"Already in sync"*. Bila
  ia menawarkan migrasi baru, ada drift antara skema dan migrasi.
- Migrasi yang sudah di-commit **tidak diedit lagi**; perbaikan dibuat sebagai
  migrasi baru (checksum migrasi tersimpan di `_prisma_migrations`).

| Migrasi | Isi |
| --- | --- |
| `…_model_domain_awal` | Seluruh model domain + blok SQL manual di bawah |
| `…_invite_email_sent_at` | `invite.email_sent_at` (nullable) untuk `AdminInvite.emailSentAt` kontrak §5.13; model domain §3.1 hanya menyebut `email_message_id`/`email_error`, yang tidak bisa menjawab "kapan terkirim". Baris lama otomatis berarti "belum/gagal terkirim" |
| `…_indeks_keyset_katalog_publik` | Indeks `product(publish_status, deleted_at, published_at DESC, id DESC)` untuk keyset katalog publik (§1.6/§5.1) |
| `…_indeks_keyset_artikel_publik` | Dua indeks **ekspresi parsial** pada `article` untuk keyset journal publik (§1.6/§5.3); lihat §Constraint SQL manual |

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

| Objek | Aturan | Sumber |
| --- | --- | --- |
| `invite_email_active_key` | Unik parsial: satu undangan aktif per email (`WHERE accepted_at IS NULL AND revoked_at IS NULL`) | §3.1 |
| `product_material_primary_key` | Unik parsial: maksimal satu material primer per produk (`WHERE is_primary`) | §3.5 |
| `product_low_stock_threshold_check` | `low_stock_threshold >= 0` bila diisi | §3.5 (Q13) |
| `product_stock_quantity_check` | `stock_quantity >= 0` bila diisi | kontrak §5.6 `ProductInput` |
| `comment_author_identity_check` | `author_user_id`, `author_email`, atau `anonymized_at` harus terisi | §3.6 |
| `inquiry_email_present_check` | `email` wajib kecuali sudah dianonimkan | §3.7 |
| `page_block_global_check` | `page_id IS NULL` ⇔ `visibility = 'GLOBAL'` (blok global) | D10, §3.8 |
| `nav_item_target_check` | Target sesuai `type`: `PAGE`→`page_id`, `CATEGORY`→`category_id`, `CUSTOM_LINK`→`url`, `ARTICLE_ARCHIVE`→tanpa target | §3.8 |
| `site_setting_singleton_check` | `id = 1` (singleton bertipe) | D11, §3.8 |
| `site_setting_low_stock_threshold_check` | `low_stock_threshold >= 0` | §3.8 (Q13) |
| `slug_redirect_target_check` | Tepat satu dari `product_id`/`article_id`, sesuai `type` | §3.8, §6.10 |
| `product_sku_seq` | Sequence global untuk saran SKU `ORN-<kode>-<NNNN>`; nomor tidak pernah dipakai ulang | §6.2 |
| `article_public_effective_at_idx`, `article_public_category_effective_at_idx` | Indeks ekspresi parsial `COALESCE(published_at, publish_at) DESC, id DESC` (opsional per `category_id`) `WHERE deleted_at IS NULL AND status <> 'DRAFT'`, untuk keyset journal publik. Ekspresi dan predikat parsial tidak bisa ditulis di `schema.prisma`; ada di migrasi `…_indeks_keyset_artikel_publik` | kontrak §1.6/§5.3, ADR K8 |

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

| Kondisi | Hasil |
| --- | --- |
| `NODE_ENV=production` | Batal, exit code 1, tidak ada yang ditulis |
| Nama database di `DATABASE_URL` tidak memuat `ornament` | Batal, exit code 1 |
| `DATABASE_URL` kosong/tidak valid | Batal, exit code 1 |

Seed terdaftar di `prisma.config.ts` (`migrations.seed`), jadi ikut
`prisma migrate reset` dan `prisma migrate dev` pada database yang baru dibuat —
**tidak** ikut `prisma migrate deploy`, sehingga rilis production tidak pernah
menjalankan seed.

### Cara data mockup dipetakan

| Mockup | Hasil di database |
| --- | --- |
| Tanggal relatif ("3 jam lalu", "Kemarin", "18 mnt") | `now - offset` saat seed dijalankan |
| Tanggal absolut ("26 Agu 2026", "23 Agu 2026") | Digeser dengan selisih yang sama terhadap "sekarang"-nya mockup (24 Agu 2026), sehingga artikel `Scheduled` tetap terjadwal di masa depan |
| Periode target kirim inquiry ("Nov 2026") | Tidak digeser; `targetShipDate` = tanggal 1 bulan itu (§6.5) |
| `status` produk ("In Stock" … "Draft") | Dipecah `publishStatus` + `stockStatus` turunan (§6.3) |
| `stock` ("84 unit siap kirim") | `stockQuantity`; teks tanpa angka ("Menunggu foto produk") → `stockNote` |
| `PRODUCT_SPEC` (panel detail satu produk) | Dimensi/lead time/harga FOB hanya untuk produk pertama; dua baris sisanya jadi `ProductSpec` |
| `QC_POINTS` (global) | Checklist 4 tahap untuk **setiap** produk (D6); `PASSED` untuk produk terbit |
| `subject` inquiry (teks bebas) | Dihasilkan ulang sesuai §6.5; nomor `INQ-0001…` diurutkan dari yang terlama |
| `BUILDER_BLOCKS` | Blok beranda; "Footer" jadi blok global (`pageId` null, D10); nama set gambar disimpan di `config.imageNote` |

Yang **tidak** ada sumbernya di mockup, dan karena itu tidak diisi: berkas media
(tabel `media` kosong, semua `*ImageId` null — produk terbit karenanya belum
memenuhi syarat publish §6.3 yang berlaku di lapisan API), sesi, undangan,
revisi produk, galeri & dokumen pengrajin, lampiran inquiry, dan redirect slug.
Email komentar (wajib per §3.6) dibuat sintetis `@example.com`.

### Kata sandi akun seed

Mockup tidak memuat kata sandi, jadi **semua** akun seed memakai satu kata sandi
dev yang sama, di-hash argon2id seperti kata sandi sungguhan (ADR K7):

| Sumber | Nilai |
| --- | --- |
| `SEED_ADMIN_PASSWORD` di env | dipakai apa adanya (minimal 8 karakter) |
| tidak di-set | `DEV_ONLY_PASSWORD` |

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

| Project | Lokasi | Butuh DB |
| --- | --- | --- |
| `unit` | `test/unit/**/*.test.ts` | Tidak — app dibangun tanpa DB, diuji lewat `app.inject` |
| `integration` | `test/integration/**/*.test.ts` | Ya — database tes (`ornament_test`) |

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

| | Tanpa "Ingat saya" | "Ingat saya" |
| --- | --- | --- |
| Jendela idle (`expiresAt`, `Max-Age`) | 12 jam | 30 hari |
| Batas mutlak (`absoluteExpiresAt`) | 7 hari | 90 hari |

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

| Parameter | Nilai | Catatan |
| --- | --- | --- |
| Algoritma | argon2id v19 | Hibrida: tahan GPU **dan** side-channel |
| `m` (memori) | 65536 KiB (64 MiB) | ~3× batas bawah OWASP (19456) |
| `t` (iterasi) | 3 | |
| `p` (lane) | 1 | Node single-threaded; `p > 1` tidak sepadan |
| Keluaran / salt | 32 byte / 16 byte acak | Salt dibuat pustaka per hash |

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

| Situasi | Respons |
| --- | --- |
| Tanpa cookie / token tak dikenal / kedaluwarsa / user `REVOKED` | `401 UNAUTHENTICATED` + cookie penghapus |
| Sesi sah, izin kurang | `403 FORBIDDEN`, `details: { requiredPermission, requiredRoles }` |
| Login gagal (sebab apa pun) | `401 INVALID_CREDENTIALS` — pesan **selalu** sama |

Sumber matriksnya satu: `ROLE_PERMISSIONS` di `@ornament/shared` (kontrak §3.3).
`Me.permissions` (untuk menyembunyikan tombol) dan guard API membaca tabel yang
sama, jadi UI dan server tidak bisa berbeda pendapat.

| Kemampuan | ADM | EDT | CTR | Izin |
| --- | --- | --- | --- | --- |
| Mengelola pengguna & undangan | ✓ | — | — | `user.manage` |
| Menerbitkan produk & artikel | ✓ | ✓ | — | `product.publish`, `article.publish` |
| Mengelola pengrajin | ✓ | ✓ | — | `artisan.write` |
| Membalas inquiry | ✓ | ✓ | — | `inquiry.manage` |
| Settings & tema | ✓ | — | — | `settings.manage` |

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

| `rule` | Kapan |
| --- | --- |
| `CANNOT_CHANGE_OWN_ROLE` | Administrator mengubah **perannya sendiri** (mengubah namanya sendiri tetap boleh) |
| `CANNOT_REVOKE_SELF` | Administrator mencabut **aksesnya sendiri** |
| `LAST_ADMINISTRATOR` | Menurunkan peran / mencabut Administrator **aktif terakhir** |

Dua aturan pertama bukan sekadar kenyamanan: karena pemanggil selalu
Administrator aktif, melarang keduanya membuat sistem *secara struktural* selalu
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

| Kunci | Batas | Mekanisme |
| --- | --- | --- |
| IP, `POST /admin/auth/login` | 20 / 15 menit | `@fastify/rate-limit` (store in-memory) |
| Email, `POST /admin/auth/login` | 5 **gagal** / 15 menit | `LoginThrottle` (in-memory) |
| IP, `logout`, `me`, dan seluruh `/v1/admin/*` lain | 600 / menit | `@fastify/rate-limit`, jaring pengaman |
| User, `POST /admin/auth/password` | 5 / 15 menit | `PasswordChangeThrottle` (in-memory) |
| IP, `GET /admin/auth/invites/:token` & `POST .../accept` | 10 / 15 menit | `@fastify/rate-limit`, anti enumerasi token |

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
> instance` dan hilang setiap restart/deploy. ADR K8 mengasumsikan satu proses
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

| Endpoint | Arti | Respons |
| --- | --- | --- |
| `GET /v1/health` | Liveness — proses hidup; tidak menyentuh DB | `200 {"data":{"status":"ok"}}` |
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
    "details": [{ "path": "materials[0].materialId", "code": "invalid_format", "message": "UUID tidak valid" }],
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

| Endpoint | Query | Respons |
| --- | --- | --- |
| `GET /v1/public/products` | `category` (slug, termasuk turunan), `material` (slug dipisah koma, **AND**), `tag`, `artisan`, `sort=-publishedAt` (default) \| `name`, `limit` (≤48, default 12), `cursor` | `{ data: PublicProductCard[], meta: { limit, nextCursor, total } }` |
| `GET /v1/public/products/:slug` | — | `{ data: PublicProductDetail }` — spesifikasi, checklist QC 4 tahap, pengrajin ringkas, dan maks 4 produk terkait |
| `GET /v1/public/categories` | `withEmpty` (default `false`) | Daftar datar urut pohon + `depth` dan `productCount` (kategori + turunannya) |
| `GET /v1/public/materials` | `withEmpty` | Urut `name`, dengan `productCount` |
| `GET /v1/public/artisans` | `regency` (tanpa memandang besar-kecil huruf), `limit`, `cursor` | `{ data: PublicArtisanCard[], meta }` — hanya `ACTIVE`/`FULL_CAPACITY` yang tidak diarsipkan |
| `GET /v1/public/artisans/:slug` | — | `{ data: PublicArtisanDetail }` — profil + maks 12 produk terbaru miliknya |
| `GET /v1/public/article-categories` | `withEmpty` | Urut `position`, dengan `articleCount` (artikel terbit) |
| `GET /v1/public/articles` | `category` (slug `ArticleCategory`), `tag`, `limit`, `cursor` | `{ data: PublicArticleCard[], meta }` — urut `-publishedAt` (terjadwal: `publishAt`) |
| `GET /v1/public/articles/:slug` | — | `{ data: PublicArticleDetail }` — blok isi, tag, gambar unggulan, penulis hanya `name` |
| `GET /v1/public/articles/:slug/comments` | `limit` (default 20), `cursor` | `{ data: PublicComment[], meta }` — komentar akar `APPROVED` urut `createdAt` naik, balasan bersarang 1 tingkat |
| `GET /v1/public/settings` | — | `{ data: PublicSiteSetting }` — nama, tagline, kontak, alamat, sosial, SEO, `sitemapEnabled`, `allowIndexing` |
| `GET /v1/public/nav-items` | — | Menu satu tingkat urut `position`, dengan `href` turunan |
| `GET /v1/public/pages` | `path` (wajib, diawali `/`) | `{ data: PublicPage }` — blok `ACTIVE` halaman, lalu blok `GLOBAL` |
| `GET /v1/public/blocks/global` | — | Blok global saja, untuk layout tanpa `Page` (mis. `/produk/[slug]`) |
| `GET /v1/public/sitemap` | — | `{ enabled, entries: [{ path, updatedAt }] }` — halaman, produk, artikel, pengrajin yang tayang |
| `GET /v1/public/redirects` | `type` (`PRODUCT`\|`ARTICLE`), `slug` (slug lama) | `{ data: PublicRedirect }` — `301` ke slug terkini (§6.10) |

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

| Aspek | Nilai |
| --- | --- |
| `Cache-Control` GET | `public, max-age=0, s-maxage=60, stale-while-revalidate=300` (§1.2) |
| `Cache-Control` POST | `no-store` |
| Rate limit dengan `X-Internal-Key` valid | 1200 / menit per IP |
| Rate limit tanpa key (atau key salah) | 120 / menit per IP |

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

## Script

Jalankan dengan `npm run <script> --workspace backend` dari root, atau
`npm run <script>` di dalam `backend/`.

| Script | Fungsi |
| --- | --- |
| `dev` | Server dengan reload otomatis (`tsx watch`, shared dari `src/`) |
| `build` | `prisma generate` lalu kompilasi ke `dist/` |
| `start` | Jalankan hasil build (`node dist/server.js`) |
| `typecheck` | `tsc --noEmit` (butuh `packages/shared/dist`) |
| `lint` | ESLint |
| `format` / `format:check` | Prettier (tulis / cek saja) |
| `test` | Semua tes sekali jalan (unit + integration) |
| `test:unit` / `test:integration` | Satu project Vitest |
| `test:watch` | Vitest mode watch |
| `db:generate` | `prisma generate` |
| `db:migrate` | `prisma migrate dev` (buat + terapkan migrasi, dev) |
| `db:migrate:deploy` | `prisma migrate deploy` (terapkan migrasi yang ada) |
| `db:seed` | Isi database dev/tes dengan data mockup (**menghapus isi DB lebih dulu**) |
| `db:studio` | Prisma Studio |

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
