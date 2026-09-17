# Backend — API Ornament

API untuk situs publik dan admin CMS. Fastify 5 + TypeScript (ESM, strict),
berjalan di Node.js 24. Keputusan arsitektur ada di
[`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md).

**Status: scaffold (T1.1).** Server sudah bisa dijalankan, tetapi baru punya
satu rute sementara `GET /v1`. Database/Prisma dan validasi env (T1.2), format
error, validasi Zod, dan health check (T1.3), tes & CI (T1.4), serta paket
`@ornament/shared` (T1.5) menyusul.

## Struktur

```
src/
  app.ts          buildApp() — merakit instance Fastify tanpa listen (dipakai server & tes)
  server.ts       entry: baca HOST/PORT, listen, graceful shutdown (SIGINT/SIGTERM)
docs/             ADR, model domain, kontrak API
eslint.config.js  ESLint flat config (typescript-eslint, type-checked)
tsconfig.json     konfigurasi editor/typecheck (NodeNext, strict)
tsconfig.build.json  build ke dist/
```

## Menjalankan lokal

Paket ini bagian dari npm workspaces; install dari **root** repo.

```bash
nvm use                           # Node 24 dari .nvmrc
npm install                       # di root repo
npm run dev --workspace backend   # tsx watch, http://localhost:4000
curl http://localhost:4000/v1     # {"data":{"name":"ornament-api"}}
```

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Alamat listen |
| `PORT` | `4000` | Port listen |

## Script

Jalankan dengan `npm run <script> --workspace backend` dari root, atau
`npm run <script>` di dalam `backend/`.

| Script | Fungsi |
| --- | --- |
| `dev` | Server dengan reload otomatis (`tsx watch`) |
| `build` | Kompilasi ke `dist/` |
| `start` | Jalankan hasil build (`node dist/server.js`) |
| `typecheck` | `tsc --noEmit` |
| `lint` | ESLint |
| `format` / `format:check` | Prettier (tulis / cek saja) |

## Dokumentasi

- [`docs/adr/0001-arsitektur-backend.md`](docs/adr/0001-arsitektur-backend.md) — keputusan arsitektur
- [`docs/domain-model.md`](docs/domain-model.md) — model domain
- [`docs/api-contract.md`](docs/api-contract.md) — kontrak API
