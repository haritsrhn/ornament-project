# Ornament Sourcing Agent

Monorepo untuk situs publik dan admin CMS Ornament Sourcing Agent, dikelola
dengan **npm workspaces**.

```
package.json               root workspaces: packages/*, backend, frontend (urutan = urutan build)
package-lock.json          satu lockfile untuk semua workspace
.nvmrc                     Node 24
packages/shared/           @ornament/shared — skema Zod & tipe kontrak API (lihat README-nya)
backend/                   Fastify API + TypeScript + Prisma — lihat backend/README.md
frontend/                  Next.js (App Router) + TypeScript + Tailwind
docker-compose.yml         PostgreSQL lokal (dev + test) untuk backend
design_handoff_ornament/   Referensi desain (tidak di-track git)
```

## Persiapan

Proyek memakai **Node.js 24** (`.nvmrc`, `engines` di `package.json`). Semua
dependensi di-install sekali dari root; jangan jalankan `npm install` di dalam
folder workspace.

```bash
nvm use
npm install
```

Script agregat di root:

```bash
npm run dev:frontend   # http://localhost:3000  ·  /admin untuk CMS
npm run dev:backend    # http://localhost:4000
npm run dev:shared     # tsc --watch untuk packages/shared (tipe dist/ untuk frontend & editor)
npm run build          # build semua workspace (shared → backend → frontend)
npm run build:shared   # build @ornament/shared saja (juga otomatis saat npm install)
npm run typecheck      # build shared, lalu typecheck semua workspace
npm run lint           # lint shared + backend
npm run format         # Prettier shared + backend (format:check untuk cek saja)
npm test               # tes shared + backend (unit + integration; butuh db:up)
npm run db:up          # PostgreSQL lokal via Docker (tunggu healthy)
npm run db:seed --workspace backend   # isi DB dev dengan data mockup (dev/tes saja)
npm run db:down        # matikan PostgreSQL lokal
```

Script per workspace: `npm run <script> --workspace frontend|backend|packages/shared`.

## Paket bersama

[`packages/shared`](packages/shared/README.md) (`@ornament/shared`) berisi
skema Zod dan tipe kontrak API yang diimpor backend dan frontend (ADR K6):
envelope sukses/error, katalog kode error, pagination, health. Hanya kontrak —
tanpa dependensi server dan tanpa tipe Prisma. Frontend memakainya lewat
`transpilePackages`; backend dev/tes me-resolve ke `src/` (kondisi
`@ornament/source`), sedangkan typecheck/build/produksi memakai `dist/`.

## Frontend

Berisi 9 tampilan situs publik dan 16 layar admin CMS, dibangun dari paket
`design_handoff_ornament/`. Detail design system, routing, komponen, dan
perilaku responsif ada di [`frontend/README.md`](frontend/README.md).

Frontend saat ini masih UI statis dan state interaksi saja: semua daftar
dirender dari `frontend/lib/data.ts`, dan setiap aksi "simpan" hanya mengubah
state komponen lalu menampilkan toast. Integrasi ke API menyusul.

## Backend

Scaffold Fastify sudah bisa dijalankan (`GET /v1`) dengan PostgreSQL (Prisma) dan
validasi env; autentikasi dan
endpoint domain dibangun bertahap. Cara menjalankan dan struktur ada di
[`backend/README.md`](backend/README.md); keputusan arsitektur, model domain,
dan kontrak API ada di [`backend/docs/`](backend/docs/).

## CI

GitHub Actions (`.github/workflows/ci.yml`) berjalan pada setiap pull request
(ke base branch apa pun) dan push ke `main`. Run lama di ref yang sama
dibatalkan otomatis. Dua job paralel, Node dari `.nvmrc`:

- **backend** (+ shared) — `npm ci`, generate Prisma Client, build shared,
  typecheck, lint, cek Prettier (shared + backend), tes shared lalu tes unit +
  integrasi backend terhadap service container `postgres:18-alpine` (database
  `ornament_test`), lalu build.
- **frontend** — `npm ci`, build shared, typecheck, build Next.js.

Jalankan langkah yang sama secara lokal sebelum membuka PR:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

## Deployment

Situs publik dan admin **dideploy pada domain terpisah**. Admin bersifat privat
dan tidak boleh punya tautan dari situs publik.

## Aset foto

Paket handoff tidak menyertakan foto. Setiap posisi gambar dirender lewat
komponen `ImageSlot` yang menjaga rasio dan radius, serta menampilkan deskripsi
foto yang seharusnya ada di situ. Ganti dengan `next/image` setelah foto dari
klien tersedia.
