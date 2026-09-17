# @ornament/shared

Skema Zod dan tipe TypeScript **kontrak API** yang dipakai bersama backend
(validasi request + serialisasi respons) dan frontend (tipe data API, validasi
form). Dasar: [ADR K6](../../backend/docs/adr/0001-arsitektur-backend.md) dan
[kontrak API](../../backend/docs/api-contract.md).

## Isi saat ini (Tahap 1)

| Modul | Ekspor | Kontrak |
| --- | --- | --- |
| `envelope.ts` | `DataEnvelope<T, M>`, `dataEnvelope()`, `dataMetaEnvelope()` | §1.4 |
| `errors.ts` | `ERROR_CODES`, `errorCodeSchema` / `ErrorCode`, `validationDetailSchema` / `ValidationDetail`, `errorBodySchema` / `ErrorBody`, `errorEnvelopeSchema` / `ErrorEnvelope` | §1.5, §1.10 |
| `pagination.ts` | `pageQuerySchema`, `pageMetaSchema`, `cursorQuerySchema()`, `PUBLIC_CURSOR_LIMITS`, `cursorMetaSchema`, `cursorMetaWithTotalSchema` | §1.6 |
| `health.ts` | `healthStatusSchema`, `healthResponseSchema` / `HealthResponse` | §1.1 |

Skema domain (`product.ts`, `article.ts`, …) ditambahkan mulai Tahap 2.

## Aturan

- **Hanya kontrak API**: skema Zod + tipe turunan `z.infer`. Tanpa logika bisnis.
- **Tanpa dependensi server**: tidak mengimpor Fastify, Prisma, `node:*`, atau
  env. Satu-satunya dependensi runtime adalah `zod` (tsconfig `types: []`,
  `lib: ES2022` tanpa DOM/Node).
- **Tanpa tipe Prisma**: DTO ditulis eksplisit agar kolom internal tidak bocor.
- Enum = kode stabil UPPER_SNAKE; label tampilan dipetakan di frontend. Tanggal =
  string ISO 8601.
- Status HTTP per kode error bukan urusan klien, jadi tetap di backend
  (`ERROR_STATUS` di `backend/src/lib/errors.ts`, dicek lengkap dengan
  `satisfies Record<ErrorCode, number>`).
- Import internal memakai ekstensi `.js` (`./errors.js`) — wajib untuk
  konsumen NodeNext.
- Menambah kode error / nilai enum respons = perubahan kontrak; ubah bersama
  backend dan frontend dalam satu PR.

## Pemakaian

```ts
import { dataEnvelope, errorEnvelopeSchema, type ErrorCode } from '@ornament/shared';
```

Satu entry point (`.`). Zod hanya ada satu salinan di monorepo (dependensi
`zod` di paket ini dan backend memakai rentang yang sama, di-hoist npm), sehingga
skema dari paket ini dan `z` di backend adalah instance yang sama — penting untuk
`fastify-type-provider-zod` dan `z.config()` locale.

## Build & resolusi

`exports` punya tiga kondisi:

| Kondisi | Target | Dipakai oleh |
| --- | --- | --- |
| `@ornament/source` | `src/index.ts` | `npm run dev:backend` (`tsx --conditions=@ornament/source`) dan Vitest backend (`ssr.resolve.conditions`) |
| `types` | `dist/index.d.ts` | `tsc` backend & frontend, ESLint type-aware, editor |
| `import` | `dist/index.js` | `node dist/server.js` (produksi), Next.js (`transpilePackages`) |

- `dist/` dibangun `tsc -p tsconfig.build.json` (ESM + `.d.ts` + declaration map
  + source map). Build otomatis saat `npm install` / `npm ci` (script `prepare`),
  dan eksplisit lewat `npm run build:shared` di root (dipanggil juga oleh
  `typecheck`, `build`, `build:backend`, `build:frontend`, serta CI).
- Saat dev backend dan tes, perubahan di `src/` langsung terpakai tanpa build.
  Untuk typecheck/editor/frontend yang membaca `dist/`, jalankan
  `npm run dev:shared` (`tsc --watch`) di terminal terpisah, atau `npm run build:shared`.
- Deploy backend butuh `packages/shared/dist` dan symlink workspace
  `node_modules/@ornament/shared` (install dari root, lalu `npm run build`).

## Script

Dari root: `npm run <script> --workspace packages/shared`.

| Script | Fungsi |
| --- | --- |
| `build` | `tsc` → `dist/` |
| `dev` | `tsc --watch` |
| `typecheck` | `tsc --noEmit` (src + test) |
| `lint` | ESLint (konfigurasi sama dengan backend) |
| `format` / `format:check` | Prettier |
| `test` / `test:watch` | Vitest (skema) |
