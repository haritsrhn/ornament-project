# Kontrak API

- **Issue:** #3 — [T0.3] Kontrak API
- **Status:** Draf untuk ditinjau
- **Tanggal:** 2026-09-17
- **Dasar:** [ADR-0001](adr/0001-arsitektur-backend.md) (K1–K11) dan
  [Model domain](domain-model.md) (D1–D11, §6, Q1–Q15). Nama entitas, field, dan
  enum mengikuti model domain **persis**. Bila dokumen ini berbeda dengan ADR, ADR
  yang berlaku; bila berbeda dengan model domain untuk nama/field, model domain yang
  berlaku.
- **Sumber kebenaran implementasi:** skema Zod di `packages/shared/src/<domain>.ts`
  (ADR K6). Dokumen ini adalah spesifikasi yang harus diterjemahkan ke skema tersebut.

Notasi tipe ringkas: `uuid`, `string`, `int`, `number`, `bool`, `iso` (string
ISO 8601 UTC), `money` (string desimal, mis. `"42.00"`), `T?` = boleh dihilangkan
di request, `T|null` = selalu ada di respons tetapi bisa `null`, `T[]` = array,
`Enum` = kode dari §4 model domain.

---

## 1. Konvensi umum

### 1.1 Base path, audiens, versi

| Prefix | Pemanggil | Auth | Catatan |
| --- | --- | --- | --- |
| `/v1/public/*` | Server Next.js situs publik (server-to-server) | GET: tanpa auth. POST: header `X-Internal-Key` wajib | Hanya konten terbit. Tanpa CORS, tanpa cookie. |
| `/v1/admin/auth/*` | Browser admin (`credentials: "include"`) | Sebagian tanpa sesi (login, undangan) | CORS allowlist `ADMIN_ORIGIN`. |
| `/v1/admin/*` | Browser admin | Cookie `__Host-osa_session` wajib | CORS allowlist `ADMIN_ORIGIN`, cek `Origin` untuk non-GET. |
| `/v1/internal/*` | Cron eksternal / operator | `Authorization: Bearer <INTERNAL_JOB_TOKEN>` | Tidak masuk CORS. Lihat §5.17. |
| `/v1/health` | Load balancer | — | `200 {"status":"ok"}` |

- **Versi di path** (`/v1`). Perubahan yang *breaking* (hapus/ganti nama field,
  ubah arti enum, ubah bentuk envelope) → `/v2` untuk rute terdampak. Menambah
  field respons, menambah endpoint, atau menambah nilai query opsional **bukan**
  breaking; klien wajib mengabaikan field yang tidak dikenal.
- Menambah nilai enum dianggap breaking untuk **respons** (frontend memetakan label),
  jadi dikoordinasikan lewat versi `@ornament/shared`, bukan lewat `/v2`.
- Path di ADR (`/admin/auth/login`, `/admin/media/uploads`, `/admin/media`)
  berlaku dengan prefix `/v1`.

### 1.2 Header

| Header | Arah | Keterangan |
| --- | --- | --- |
| `Content-Type: application/json` | req | **Wajib** untuk semua non-GET yang ber-body (ADR K7: memaksa preflight). Lainnya → `415 UNSUPPORTED_MEDIA_TYPE`. |
| `Origin` | req | `/v1/admin/*` non-GET: harus sama dengan `ADMIN_ORIGIN`, jika tidak → `403 ORIGIN_NOT_ALLOWED`. |
| `X-Internal-Key` | req | `/v1/public/*` POST. Salah/tidak ada → `401 INVALID_INTERNAL_KEY`. |
| `X-Client-Ip` | req | IP pengunjung yang diteruskan Next. **Hanya dipercaya bila `X-Internal-Key` valid**; selain itu diabaikan dan IP koneksi yang dipakai. API hanya menyimpan hash-nya (`ipHash`). |
| `X-Client-User-Agent` | req | User agent pengunjung yang diteruskan Next (opsional, aturan kepercayaan sama). |
| `Idempotency-Key` | req | §1.8 |
| `X-Request-Id` | res (dan req opsional) | Selalu dikembalikan; dipakai di log pino dan di `error.requestId`. |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` | res | Pada rute yang dibatasi; `Retry-After` hanya pada `429`. |
| `Cache-Control: no-store` | res | Semua `/v1/admin/*`. `/v1/public/*` GET: `private, max-age=0` (cache dikelola Next lewat tag, §6). |

### 1.3 Penamaan & format data

| Aspek | Aturan |
| --- | --- |
| JSON | camelCase, sama dengan model domain (`publishStatus`, `moqQuantity`). |
| Path | kebab-case, jamak (`/nav-items`, `/inquiry-uploads`). Resource publik diakses lewat `slug`; admin lewat `id` (uuid). |
| Enum | Kode stabil UPPER_SNAKE (`IN_STOCK`, `NEW`). Label tampilan dipetakan di frontend. |
| Tanggal-waktu | String ISO 8601 UTC dengan `Z` dan milidetik: `"2026-09-17T03:15:00.000Z"`. Tidak ada teks relatif. |
| Filter bulan | `YYYY-MM`, ditafsirkan pada `SiteSetting.timezone` (default `Asia/Jakarta`). |
| Uang (`Decimal(10,2)`) | String desimal `"42.00"` agar tidak kehilangan presisi (`fobPriceUsd`, `budgetPerUnitUsd`). |
| Ukuran (`Decimal(7,1)`/`(7,2)`) | `number` (`lengthCm: 45`, `weightKg: 3.2`). |
| `BigInt` (`Media.sizeBytes`) | `number` (aman < 2^53). |
| Rich text / blok | JSON sesuai skema Zod (`RichText`, `ArticleBlock[]`) dari `@ornament/shared`. |
| Nilai kosong | Field respons **selalu ada**; kosong = `null` (bukan dihilangkan). Array kosong = `[]`. |
| Request PATCH | Parsial. Field yang dikirim `null` = kosongkan. Field array (mis. `tags`, `images`, `specs`, `materials`) **mengganti seluruh isi** bila dikirim. |
| Field tak dikenal di body | Ditolak (`400 VALIDATION_FAILED`, `code: "unrecognized_keys"`). Zod `.strict()`. |
| Field turunan read-only | `sku`, `revision`, `wordCount`, `reference`, `subject`, `number`, `publishedAt`, hitungan → tidak boleh dikirim di body (strict → 400). |

### 1.4 Envelope sukses

```jsonc
// Objek tunggal
{ "data": { ... } }

// Daftar ber-halaman (admin, §1.6)
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3, "counts": { ... } } }

// Daftar kursor (publik & feed, §1.6)
{ "data": [ ... ], "meta": { "limit": 12, "nextCursor": "eyJwIjoi...", "total": 38 } }
```

`meta.counts` (opsional) berisi hitungan untuk tab UI, dihitung dengan filter yang
sama **kecuali** filter tab itu sendiri (mis. `{ "all": 57, "PUBLISHED": 41, "DRAFT": 16, "trash": 3 }`).

`204 No Content` tanpa body untuk logout dan hapus permanen.

### 1.5 Envelope error

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Beberapa field tidak valid.",
    "details": [
      { "path": "moqQuantity", "code": "too_small", "message": "Minimal 1." },
      { "path": "materials[0].materialId", "code": "invalid_string", "message": "Harus UUID." }
    ],
    "requestId": "01J8Y9K7Q2N5..."
  }
}
```

- `code`: kode stabil (katalog §1.10); klien bercabang berdasarkan `code`, **bukan**
  `message`. `message` bahasa Indonesia, untuk ditampilkan/log.
- `details`: opsional. Untuk validasi = daftar `{ path, code, message }`; `path` pakai
  notasi titik/indeks, `code` = kode issue Zod (`too_small`, `invalid_type`,
  `invalid_enum_value`, `custom`, …) atau kode kustom (`email_domain`, `slug_taken`).
  Untuk error domain = objek/array spesifik (didokumentasikan per error).
- Pesan validasi server dan form klien memakai skema Zod yang sama (ADR K6).

### 1.6 Pagination

| Konteks | Gaya | Parameter | Meta | Alasan |
| --- | --- | --- | --- | --- |
| Daftar admin (produk, artikel, pengrajin, media, komentar, inquiry, pengguna, halaman, kategori) | **Offset / nomor halaman** | `page` (int ≥1, default 1), `pageSize` (default 20, maks 100) | `page, pageSize, total, totalPages, counts?` | UI admin menampilkan nomor halaman & lompat halaman (`ProductTable` "‹ 1 2 3 ›") dan hitungan tab. Data admin kecil (ratusan–ribuan baris); `COUNT(*)` + `OFFSET` murah. Halaman di luar rentang → `200` dengan `data: []` (bukan 404), klien kembali ke halaman terakhir. |
| Daftar publik (katalog produk, journal, komentar artikel) | **Cursor (keyset)** | `limit` (default 12, maks 48), `cursor` (opaque base64url) | `limit, nextCursor, total` | UI memakai "Muat 12 lagi" (append), bukan nomor halaman. Keyset (`publishedAt DESC, id DESC`) stabil saat produk baru terbit di antara dua klik (tidak ada duplikat/lompatan), indeks-friendly, dan URL per kursor mudah di-cache Next. `total` tetap dikirim karena UI menulis "Menampilkan 12 dari 38 produk". |
| Activity log | **Cursor** | `limit` (default 20, maks 100), `cursor` | `limit, nextCursor` (tanpa `total`) | Append-only dan terus bertambah; feed "muat lebih lama". |

- `nextCursor: null` = tidak ada data lagi.
- Kursor mengikat filter & sort. Dipakai dengan filter/sort berbeda atau rusak →
  `400 INVALID_CURSOR`.
- Daftar kecil yang selalu dikirim utuh (kategori, material, menu, blok, dokumen
  pengrajin, balasan inquiry, revisi) **tidak** dipaginasi.

### 1.7 Filter, sort, search

| Aspek | Aturan |
| --- | --- |
| Filter | Query param bernama field/relasi: `publishStatus=DRAFT`, `categoryId=<uuid>`. Multi-nilai: dipisah koma `material=rotan-alami,jati-reclaimed`. Nilai enum tidak valid → `400 VALIDATION_FAILED`. |
| Semantik multi-nilai | Didokumentasikan per endpoint (katalog publik: material = **AND**). |
| Sort | `sort=<field>` naik, `sort=-<field>` turun; satu field, dari allowlist per endpoint. Tie-breaker `id` selalu ditambahkan server. Field di luar allowlist → `400`. |
| Search | `q` (string, 1–100 karakter, di-trim). `ILIKE` pada field yang disebut per endpoint (model §8: bukan full-text). |
| Trash | `trashed=true` hanya menampilkan baris `deletedAt IS NOT NULL`; default hanya `deletedAt IS NULL`. |
| Arsip | `archived=true` (Artisan) sama polanya dengan `trashed`. |

### 1.8 Idempotensi

- Header `Idempotency-Key` (string 16–128 karakter, disarankan UUID v4).
- **Wajib** pada: `POST /v1/public/inquiries`, `POST /v1/public/articles/:slug/comments`
  (Server Action membuat key saat form dirender, sehingga submit ganda/klik ganda/
  retry jaringan tidak membuat duplikat).
- **Disarankan** (opsional) pada: `POST /v1/admin/inquiries/:id/replies/:replyId/send`,
  `POST /v1/admin/invites`, `POST /v1/admin/invites/:id/resend`,
  `POST /v1/admin/products/:id/duplicate`, `POST /v1/admin/*/bulk`.
- Server menyimpan `(key, method+route, actor/ipHash) → status + body respons` selama
  **24 jam**. Pengulangan dengan body identik → respons tersimpan dikembalikan apa
  adanya plus header `Idempotent-Replayed: true`.
- Key sama + body berbeda → `422 IDEMPOTENCY_KEY_REUSED`. Request pertama masih
  berjalan → `409 IDEMPOTENCY_IN_PROGRESS`.
- `PUT`, `PATCH`, `DELETE`, dan aksi status (`/publish`, `/restore`, …) secara alami
  idempoten terhadap state akhir dan tidak memerlukan key.

### 1.9 Konkurensi (edit bersamaan)

| Resource | Mekanisme | Konflik |
| --- | --- | --- |
| `Product` | Body `expectedRevision: int` (wajib pada `PATCH`) dibandingkan dengan `Product.revision`. | `409 EDIT_CONFLICT`, `details: { currentRevision, updatedAt, updatedBy }` |
| `Article`, `Artisan`, `Page` (+ blok), `SiteSetting`, nav | Body `expectedUpdatedAt: iso` (wajib pada `PATCH`/`PUT`). | `409 EDIT_CONFLICT`, `details: { updatedAt, updatedBy }` |
| Lainnya (kategori, material, media, komentar, inquiry) | Last-write-wins. | — |

### 1.10 Status HTTP & katalog kode error

| HTTP | `code` | Kapan |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | JSON rusak. |
| 400 | `VALIDATION_FAILED` | Gagal skema Zod (body/query/params). `details[]` per field. |
| 400 | `INVALID_CURSOR` | §1.6 |
| 401 | `UNAUTHENTICATED` | Tidak ada / sesi kedaluwarsa / sesi dicabut. |
| 401 | `INVALID_CREDENTIALS` | Login gagal (email tak terdaftar, `REVOKED`, sandi salah — pesan sama). |
| 401 | `INVALID_INTERNAL_KEY` | `X-Internal-Key` / bearer internal salah. |
| 403 | `FORBIDDEN` | Peran tidak cukup. `details: { requiredRoles: UserRole[] }`. |
| 403 | `FORBIDDEN_FIELD` | Peran boleh memanggil endpoint tetapi tidak boleh mengubah field tertentu (mis. Contributor mengubah `slug`/`authorId`). `details: { fields: string[] }`. |
| 403 | `ORIGIN_NOT_ALLOWED` | CSRF guard (ADR K7). |
| 404 | `NOT_FOUND` | Tidak ada, **atau** tidak boleh terlihat (konten draf di `/public`, Media `PRIVATE` untuk Contributor). |
| 409 | `CONFLICT` | Pelanggaran unik generik. `details: { fields: string[] }` (mis. `["slug"]`, `["skuCode"]`, `["email"]`). |
| 409 | `EDIT_CONFLICT` | §1.9 |
| 409 | `INVALID_STATE` | Aksi tidak valid untuk state sekarang. `details: { current, allowed[] }` (mis. restore yang tidak di Trash, edit balasan `SENT`, hapus permanen yang tidak di Trash). |
| 409 | `IN_USE` | Hapus yang dicegah relasi `Restrict`. `details: { usages: [{ entityType, id, label }] , total }` (kategori punya produk/anak, material dipakai, media dirujuk). |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | §1.8 |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 1 MB, atau `sizeBytes` di atas batas upload. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Bukan `application/json`, atau MIME upload di luar allowlist. |
| 422 | `PUBLISH_REQUIREMENTS_NOT_MET` | Syarat publish §6.3 model. `details: [{ path, code }]` (mis. `{ "path": "primaryImageId", "code": "required" }`). |
| 422 | `BUSINESS_RULE_VIOLATION` | Aturan domain lain. `details: { rule: string }` — `rule` stabil, didaftar per endpoint (mis. `LAST_ADMINISTRATOR`, `SYSTEM_PAGE_PROTECTED`, `PUBLISH_AT_IN_PAST`, `ARTICLE_NOT_PUBLISHED`). |
| 422 | `UPLOAD_INVALID` | Konfirmasi upload gagal: objek tak ada di R2, ukuran/MIME tidak cocok, upload kedaluwarsa. `details: { reason: "NOT_FOUND" \| "MISMATCH" \| "EXPIRED" }`. |
| 422 | `IDEMPOTENCY_KEY_REUSED` | §1.8 |
| 429 | `RATE_LIMITED` | `details: { retryAfterSeconds }` + header `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Tak terduga. Tidak membocorkan stack. |
| 502 | `UPSTREAM_FAILED` | R2 gagal (presign/HeadObject). `details: { service: "R2" }`. Kegagalan Resend **tidak** menjadi 5xx (ADR K4: operasi tetap tersimpan, status kirim ditandai). |
| 503 | `SERVICE_UNAVAILABLE` | DB tidak tersedia / shutdown. |

Urutan evaluasi guard: `415/403 Origin` → `401` → `403` → `400` validasi → `404` →
`409/422`. Artinya pengguna tanpa hak **tidak** mendapat info validasi atau keberadaan
resource.

---

## 2. Auth

### 2.1 Mekanisme (ringkas ADR K7)

| Aspek | Nilai |
| --- | --- |
| Cookie | `__Host-osa_session=<token 32 byte base64url>; HttpOnly; Secure; SameSite=Strict; Path=/` tanpa `Domain`. `Max-Age` = 12 jam, atau 30 hari bila `rememberMe`. |
| Penyimpanan | `Session.tokenHash` = SHA-256 token. |
| Sliding | Setiap request admin yang sah memperpanjang `expiresAt` (maks `absoluteExpiresAt`), menyegarkan cookie maks 1×/menit bersama `lastSeenAt`/`User.lastActiveAt`. |
| Pencabutan | Logout (sesi ini), ganti sandi (semua sesi lain), `REVOKED` (semua sesi). |
| CORS admin | `Access-Control-Allow-Origin: <ADMIN_ORIGIN>`, `Allow-Credentials: true`, metode `GET,POST,PATCH,PUT,DELETE`, header `Content-Type, Idempotency-Key, X-Request-Id`. |

### 2.2 Endpoint

| Method & path | Sesi | Body / query | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `POST /v1/admin/auth/login` | — | `{ email: string (akhiran @ornament.id), password: string (8–128), rememberMe: bool }` | `200 { data: { user: Me } }` + `Set-Cookie` | `400 VALIDATION_FAILED` (`email_domain`), `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED` |
| `POST /v1/admin/auth/logout` | ✓ | — | `204` + cookie dihapus (`Max-Age=0`) | Idempoten: tanpa sesi valid tetap `204`. |
| `GET /v1/admin/auth/me` | ✓ | — | `200 { data: Me }` | `401 UNAUTHENTICATED` |
| `POST /v1/admin/auth/password` | ✓ | `{ currentPassword, newPassword (8–128) }` | `204`; sesi lain dicabut, sesi ini tetap | `401 INVALID_CREDENTIALS` (sandi lama salah), `429` |
| `GET /v1/admin/auth/invites/:token` | — | — | `200 { data: { email, role: UserRole, expiresAt: iso, invitedBy: { name } } }` | `404 NOT_FOUND` (token salah/kedaluwarsa/dicabut/sudah dipakai — **satu** respons untuk semua) |
| `POST /v1/admin/auth/invites/accept` | — | `{ token: string, name: string (1–100), password: string (8–128) }` | `201 { data: { user: Me } }` + `Set-Cookie` (langsung login, sesi 12 jam) | `404 NOT_FOUND` (sama seperti di atas), `409 CONFLICT` (`email` sudah jadi User), `429` |

Pembuatan, kirim ulang, dan pencabutan undangan ada di §5.13 (Administrator).

`Me`:

```ts
{ id: uuid; email: string; name: string; role: UserRole; avatar: MediaRef | null;
  lastActiveAt: iso | null; permissions: Permission[] }
```

`permissions` adalah daftar kode kemampuan yang **diturunkan** dari `role` (§3), dipakai
frontend untuk menyembunyikan tombol. Server tetap memeriksa di setiap rute.

### 2.3 Rate limit

| Rute | Kunci | Batas | Catatan |
| --- | --- | --- | --- |
| `POST /admin/auth/login` | IP | 20 / 15 menit | Dihitung semua percobaan. |
| `POST /admin/auth/login` | email (dinormalisasi) | 5 gagal / 15 menit | Reset saat sukses. Respons tetap `429` walau sandi benar selama terkunci. |
| `POST /admin/auth/password` | user | 5 / 15 menit | |
| `GET /admin/auth/invites/:token`, `POST .../accept` | IP | 10 / 15 menit | Anti enumerasi token. |
| `/v1/admin/*` lain | user | 600 / menit | Longgar; jaring pengaman. |
| `POST /public/inquiries` | `ipHash` | 5 / jam, 20 / hari | IP dari `X-Client-Ip` (§1.2). |
| `POST /public/inquiry-uploads` | `ipHash` | 15 / jam | |
| `POST /public/articles/:slug/comments` | `ipHash` | 5 / 10 menit, 30 / hari | |
| `/v1/public/*` GET | IP koneksi (server Next) | 1200 / menit | Pemanggilnya server Next, bukan pengunjung. |

### 2.4 Respons 401 vs 403

| Situasi | Respons |
| --- | --- |
| Tanpa cookie / token tak dikenal / `expiresAt` lewat / user `REVOKED` | `401 UNAUTHENTICATED` + `Set-Cookie` penghapus. Admin redirect ke `/admin/login`. |
| Sesi sah, peran tidak cukup | `403 FORBIDDEN`, `details.requiredRoles`. |
| Sesi sah, peran cukup tetapi kepemilikan/status tidak (Contributor mengedit draf orang lain atau konten terbit) | `403 FORBIDDEN`, `details: { reason: "NOT_OWNER" \| "NOT_DRAFT" }`. |
| Non-GET dengan `Origin` asing | `403 ORIGIN_NOT_ALLOWED` (sebelum cek sesi). |
| Login gagal | `401 INVALID_CREDENTIALS` (bukan `UNAUTHENTICATED`, agar klien tidak redirect). |

---

## 3. Matriks izin

Kode peran mengikuti enum `UserRole`: **ADM** = `ADMINISTRATOR`, **EDT** = `EDITOR`,
**CTR** = `CONTRIBUTOR`. Di tabel endpoint §5 kolom **Izin** memakai:
`ADM` (hanya Administrator), `EDT+` (Editor & Administrator), `CTR+` (semua peran),
`CTR*` (semua peran; Contributor dengan batasan yang dicatat).

### 3.1 Turunan dari `ROLE_CAPS` (`frontend/lib/data.ts`)

| Kemampuan UI | ADM | EDT | CTR | Penerapan di API |
| --- | --- | --- | --- | --- |
| Menerbitkan produk & artikel | Ya | Ya | Draf saja | `/publish`, `/unpublish`, jadwal, aksi massal publikasi: `EDT+`. CTR hanya membuat & mengedit **draf miliknya** (`Product.createdById` / `Article.authorId` = diri sendiri). CTR mengedit konten terbit/milik orang lain → `403 NOT_DRAFT`/`NOT_OWNER`. |
| Mengelola pengrajin | Ya | Ya | Lihat | Tulis `EDT+`. CTR hanya GET, **DTO tanpa field 🔒** (`ArtisanRedacted`), tanpa dokumen. |
| Membalas inquiry | Ya | Ya | — | Seluruh `/admin/inquiries/*`: `EDT+`. |
| Mengelola pengguna | Ya | — | — | `/admin/users/*`, `/admin/invites/*`: `ADM`. |
| Mengubah settings & tema | Ya | — | — | `/admin/settings`, `/admin/nav-items`: `ADM`. |

### 3.2 Keputusan untuk area yang tidak disebut `ROLE_CAPS`

| Area | ADM | EDT | CTR | Alasan |
| --- | --- | --- | --- | --- |
| Baca produk/artikel/kategori/material/tag (admin) | ✓ | ✓ | ✓ | Contributor butuh konteks untuk menulis draf. |
| Kategori & material (tulis) | ✓ | ✓ | — | Taksonomi memengaruhi katalog publik. |
| QC produk (ubah status) | ✓ | ✓ | — | Status QC tampil publik. |
| Revisi produk (lihat) | ✓ | ✓ | milik sendiri | |
| Pindah ke Trash | ✓ | ✓ | draf milik sendiri | |
| Pulihkan dari Trash | ✓ | ✓ | — | Q3: pemulihan bisa langsung menayangkan konten. |
| Hapus permanen (produk/artikel/halaman/media) | ✓ | — | — | Tidak bisa dibatalkan. |
| Komentar (moderasi & balas) | ✓ | ✓ | — | Setara "membalas inquiry": interaksi publik atas nama brand. |
| Media: upload & ubah alt `PUBLIC` | ✓ | ✓ | ✓ (ubah milik sendiri) | Dibutuhkan untuk draf. |
| Media `PRIVATE` (upload, list, URL) | ✓ | ✓ | — | Dokumen pengrajin & lampiran inquiry bersifat 🔒. |
| Halaman & blok (Page Builder) | ✓ | ✓ | — | Mengubah konten tayang langsung (model §8: tanpa draf halaman). |
| Dashboard | ✓ | ✓ | ✓ (tanpa statistik inquiry) | |
| Activity log | ✓ | ✓ | ✓ (tanpa `kind` `INQUIRY`, `USER`, `SETTING`) | |
| Revalidasi manual | ✓ | — | — | Operasional. |

### 3.3 Kode `Permission` di `Me.permissions`

`product.write_draft`, `product.publish`, `product.trash`, `product.restore`,
`product.purge`, `product.qc`, `article.write_draft`, `article.publish`,
`article.restore`, `article.purge`, `taxonomy.write`, `artisan.read_private`,
`artisan.write`, `comment.moderate`, `inquiry.manage`, `media.upload`,
`media.private`, `media.purge`, `page.write`, `page.purge`, `user.manage`,
`settings.manage`, `activity.read_all`, `cache.revalidate`.

---

## 4. Privasi DTO `/v1/public/*`

Aturan global (model D9): DTO publik ditulis eksplisit per resource (whitelist),
bukan hasil `omit` dari model. Tes kontrak wajib memastikan field di kolom kanan
**tidak pernah** muncul di respons `/v1/public/*`, termasuk di objek bersarang
(mis. `product.artisan`, `article.author`).

| Resource | Boleh di `/public` | **Tidak pernah** di `/public` |
| --- | --- | --- |
| Product | `id, slug, name, sku, excerpt, description, category, materials (name/slug/isPrimary), tags, moqQuantity, moqUnit, leadTimeDays, lengthCm, widthCm, heightCm, weightKg, stockStatus, stockQuantity, primaryImage, images, specs, qcChecks (stage, status, criteria), artisan (ringkas), origin, publishedAt` | 🔒 `stockNote`, 🔒 `fobPriceUsd` dan `fobPort` (sampai Q7), `qcChecks[].notes` 🔒, `qcChecks[].checkedBy/checkedAt`, `ProductRevision` 🔒, `revision`, `publishStatus`, `duplicatedFromId`, `createdById/updatedById`, `deletedAt`, `updatedAt`. Produk `DRAFT`/di Trash → `404`. |
| Artisan | `id, slug, name, village, regency, province, partnerSinceYear, craftsmenCount, monthlyCapacity, capacityUnit, avgLeadTimeDays, skills, summary, story, status (ACTIVE/FULL_CAPACITY), photo, images (caption), publishedProductCount` | 🔒 `contactName`, 🔒 `phone`, 🔒 `address`, 🔒 `internalNotes`, 🔒 `ArtisanDocument` (seluruhnya), Media `PRIVATE`, `archivedAt`. Artisan `VERIFICATION`/diarsipkan → `404` di `/public/artisans/:slug`; di dalam produk tampil ringkas dengan `slug: null` (§6.7). |
| Article | `id, slug, title, excerpt, content, category, tags, featuredImage, author: { name }, publishedAt, commentCount` | `author.email`, `authorId`, `status`, `publishAt` (terjadwal yang belum jatuh tempo → `404`), `wordCount`, `deletedAt`. |
| Comment | `id, authorName, body, createdAt, isStaffReply, replies[]` | 🔒 `authorEmail`, 🔒 `ipHash`, 🔒 `userAgent`, `authorUserId`, `moderatedById/At`, `status`. Hanya `APPROVED`. |
| Inquiry | Respons submit: `{ reference }` saja | 🔒 Seluruh isi `Inquiry`, `InquiryReply`, `InquiryAttachment` — tidak ada endpoint baca publik. |
| Media | `url, alt, width, height` | `id` media internal, `key`, `fileName`, `sizeBytes`, `uploadedById`, `visibility`. Media `PRIVATE` **tidak pernah** dirujuk (validasi saat simpan menolak Media `PRIVATE` di konten publik). |
| Category / Material | `id, slug, name, parentId, description, position, depth, productCount` / `id, slug, name, productCount` | `skuCode` (internal SKU). |
| Page / PageBlock | Page `PUBLISHED`: `path, title, metaTitle, metaDescription, blocks[]` (blok `ACTIVE` + `GLOBAL`) | Blok `HIDDEN`, `updatedById`, `systemKey`, `deletedAt`. |
| NavItem | `label, type, href, style, position` | `pageId`, `categoryId` (diganti `href` turunan). |
| SiteSetting | `siteName, tagline, contactEmail, instagramHandle, instagramUrl, siteLanguage, timezone, address, logo, icon, seoHomeTitle, seoKeywords, seoDescription, sitemapEnabled, allowIndexing` | `updatedById`. |
| User | Hanya `name` (sebagai penulis) | `email`, `role`, `status`, `lastActiveAt`, Session 🔒, Invite 🔒. |
| ActivityLog | — | Seluruhnya (admin saja). |

---

## 5. Endpoint per domain

Tipe bersama (didefinisikan sekali di `@ornament/shared/common`):

```ts
MediaRef        = { id: uuid; url: string | null; alt: string | null; width: int | null; height: int | null } // admin
PublicMedia     = { url: string; alt: string | null; width: int | null; height: int | null }
UserRef         = { id: uuid; name: string }
PageMeta        = { page: int; pageSize: int; total: int; totalPages: int; counts?: Record<string,int> }
CursorMeta      = { limit: int; nextCursor: string | null; total?: int }
BulkResult      = { succeeded: uuid[]; failed: { id: uuid; code: string; message: string }[] }
```

Aksi massal selalu `200` dengan `BulkResult` (sukses parsial diizinkan; tidak memakai
207). Maks 100 `ids` per request. Setiap item dicek izinnya sendiri-sendiri.

### 5.1 Publik — produk, kategori, material

| Method & path | Query / body | Respons | Error khusus |
| --- | --- | --- | --- |
| `GET /v1/public/products` | `category?: slug` (termasuk turunan), `material?: slug,slug` (**AND**: produk harus punya semua material), `tag?: slug`, `artisan?: slug`, `sort?: -publishedAt`(default) \| `name`, `limit?`, `cursor?` | `200 { data: PublicProductCard[], meta: CursorMeta(total) }` | `400 INVALID_CURSOR`. Slug filter tak dikenal → `200` dengan `data: []` (bukan 404, agar URL filter lama tidak error). |
| `GET /v1/public/products/:slug` | — | `200 { data: PublicProductDetail }` | `404` (draf/Trash/tidak ada) |
| `GET /v1/public/categories` | `withEmpty?: bool` (default false) | `200 { data: PublicCategory[] }` datar, urut pohon (`position`), `productCount` = produk terbit di kategori + turunannya | — |
| `GET /v1/public/materials` | `withEmpty?: bool` | `200 { data: PublicMaterial[] }` urut `name` | — |

```ts
PublicProductCard = { id; slug; name; sku; excerpt: string|null; primaryImage: PublicMedia|null;
  category: { slug; name }; primaryMaterial: { slug; name } | null; origin: string|null; // "Bangunjiwo, Bantul"
  stockStatus: StockStatus; moqQuantity: int; moqUnit: string; publishedAt: iso }

PublicProductDetail = PublicProductCard & {
  description: RichText|null; images: PublicMedia[]; tags: { slug; name }[];
  materials: { slug; name; isPrimary: bool }[];
  dimensions: { lengthCm: number|null; widthCm: number|null; heightCm: number|null };
  weightKg: number|null; leadTimeDays: int|null; stockQuantity: int|null;
  specs: { label; value }[];                        // baris ProductSpec, urut position
  qcChecks: { stage: QcStage; status: QcStatus; criteria: string|null }[]; // selalu 4, urut MATERIAL→PACKAGING
  artisan: { slug: string|null; name; village: string|null; regency; province;
             skills: string[]; photo: PublicMedia|null } | null;   // slug null bila profil tidak publik
  related: PublicProductCard[] }                    // maks 4: kategori sama, terbit, bukan dirinya, -publishedAt
```

`productCount` di kategori/material adalah hitungan total terbit, **tidak** bergantung
pada filter lain yang sedang aktif (sama dengan perilaku `CatalogBrowser` sekarang).

Contoh — muat halaman kedua katalog:

```http
GET /v1/public/products?category=furniture&material=rotan-alami,rangka-besi&limit=12&cursor=eyJwIjoiMjAyNi0wOC0yMVQwMjowMDowMC4wMDBaIiwiaSI6IjNmYTgifQ
```

```json
{
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "slug": "kursi-lounge-rotan-bangunjiwo",
      "name": "Kursi Lounge Rotan Bangunjiwo",
      "sku": "ORN-RTN-0142",
      "excerpt": "Rangka besi dengan anyaman rotan alami.",
      "primaryImage": { "url": "https://media.ornament.id/media/2026/08/9c1e-kursi-lounge.jpg", "alt": "Kursi lounge rotan tampak depan", "width": 1600, "height": 2000 },
      "category": { "slug": "furniture", "name": "Furniture" },
      "primaryMaterial": { "slug": "rotan-alami", "name": "Rotan alami" },
      "origin": "Bangunjiwo, Bantul",
      "stockStatus": "IN_STOCK",
      "moqQuantity": 50,
      "moqUnit": "pcs",
      "publishedAt": "2026-08-14T02:00:00.000Z"
    }
  ],
  "meta": { "limit": 12, "nextCursor": null, "total": 13 }
}
```

### 5.2 Publik — pengrajin

| Method & path | Query | Respons | Error |
| --- | --- | --- | --- |
| `GET /v1/public/artisans` | `regency?`, `limit?`, `cursor?` | `200 { data: PublicArtisanCard[], meta: CursorMeta }` hanya `ACTIVE`/`FULL_CAPACITY`, tidak diarsipkan | — |
| `GET /v1/public/artisans/:slug` | — | `200 { data: PublicArtisanDetail }` | `404` (`VERIFICATION`, diarsipkan, tidak ada) |

```ts
PublicArtisanCard   = { slug; name; village: string|null; regency; province; skills: string[];
                        summary: string|null; status: "ACTIVE"|"FULL_CAPACITY"; partnerSinceYear: int|null;
                        photo: PublicMedia|null; publishedProductCount: int }
PublicArtisanDetail = PublicArtisanCard & { story: RichText|null; craftsmenCount: int|null;
                        monthlyCapacity: int|null; capacityUnit: string; avgLeadTimeDays: int|null;
                        images: (PublicMedia & { caption: string|null })[];
                        products: PublicProductCard[] }   // maks 12 terbaru; selebihnya via /public/products?artisan=
```

Contoh `GET /v1/public/artisans/anyam-bangunjiwo` (dipangkas):

```json
{
  "data": {
    "slug": "anyam-bangunjiwo",
    "name": "Anyam Bangunjiwo",
    "village": "Bangunjiwo",
    "regency": "Bantul",
    "province": "DI Yogyakarta",
    "skills": ["anyaman rotan", "rangka besi"],
    "summary": "Workshop keluarga dengan 8 penganyam.",
    "status": "ACTIVE",
    "partnerSinceYear": 2018,
    "photo": null,
    "publishedProductCount": 14,
    "story": [{ "type": "paragraph", "text": [{ "text": "Berawal dari..." }] }],
    "craftsmenCount": 8,
    "monthlyCapacity": 600,
    "capacityUnit": "pcs",
    "avgLeadTimeDays": 45,
    "images": [],
    "products": []
  }
}
```

Tidak ada `contactName`, `phone`, `address`, `internalNotes`, atau dokumen (§4).

### 5.3 Publik — artikel & komentar

| Method & path | Query / body | Respons | Error khusus |
| --- | --- | --- | --- |
| `GET /v1/public/articles` | `category?: ArticleCategory`, `tag?: slug`, `limit?`, `cursor?` | `200 { data: PublicArticleCard[], meta: CursorMeta(total) }`; terbit = `PUBLISHED` atau `SCHEDULED && publishAt <= now()` (ADR K8), sort `-publishedAt` (untuk terjadwal: `publishAt`) | `400 INVALID_CURSOR` |
| `GET /v1/public/articles/:slug` | — | `200 { data: PublicArticleDetail }` | `404` |
| `GET /v1/public/articles/:slug/comments` | `limit?` (default 20), `cursor?` | `200 { data: PublicComment[], meta: CursorMeta(total) }`, komentar akar `APPROVED` urut `createdAt` naik, balasan bersarang 1 tingkat | `404` (artikel tidak terbit) |
| `POST /v1/public/articles/:slug/comments` | Header `X-Internal-Key`, `Idempotency-Key`. Body `{ authorName: string(1–80), authorEmail?: email\|null (Q9), body: string(1–2000), website?: string }` (`website` = honeypot, harus kosong) | `202 { data: { status: "PENDING" } }` | `404` (artikel tidak terbit), `401 INVALID_INTERNAL_KEY`, `429`. Honeypot terisi → **`202` palsu** tanpa menyimpan. |

```ts
PublicArticleCard   = { id; slug; title; excerpt: string; category: ArticleCategory;
                        featuredImage: PublicMedia|null; author: { name }; publishedAt: iso; commentCount: int }
PublicArticleDetail = PublicArticleCard & { content: PublicArticleBlock[]; tags: { slug; name }[] }
// PublicArticleBlock = ArticleBlock, tetapi blok image: { id; type: "image"; image: PublicMedia; caption? } (mediaId di-resolve)
PublicComment       = { id; authorName; body; createdAt: iso; isStaffReply: bool; replies: Omit<PublicComment,"replies">[] }
```

Contoh submit komentar (dari Server Action):

```http
POST /v1/public/articles/rotan-dari-hulu-ke-anyaman/comments
X-Internal-Key: •••
X-Client-Ip: 203.0.113.24
Idempotency-Key: 0d5c1a0e-6f1e-4f8e-9c55-2b8a1c2f7b10
Content-Type: application/json

{ "authorName": "Sofia L.", "authorEmail": "sofia@studio.se", "body": "Berapa lama rotan dikeringkan?", "website": "" }
```

```json
{ "data": { "status": "PENDING" } }
```

### 5.4 Publik — inquiry (+ lampiran)

Alur lampiran (browser pengunjung tidak memanggil API; berkas tidak melewati dua server):

1. Server Action memanggil `POST /v1/public/inquiry-uploads` → mendapat presigned `PUT`
   ke prefix `private/` R2.
2. Browser `PUT` berkas langsung ke R2 (CORS bucket R2 mengizinkan origin situs publik
   hanya untuk `PUT` pada prefix `private/inquiry-uploads/`).
3. Server Action mengirim `POST /v1/public/inquiries` dengan `attachmentUploadIds`.
   API `HeadObject` tiap upload, membuat `Media` (`PRIVATE`, `uploadedById = null`) dan
   `InquiryAttachment` (`replyId = null`) dalam transaksi yang sama dengan `Inquiry`.
4. Upload yang tidak diklaim dalam 24 jam dihapus job `cleanup-uploads`.

| Method & path | Body | Respons | Error khusus |
| --- | --- | --- | --- |
| `POST /v1/public/inquiry-uploads` | Header `X-Internal-Key`. `{ fileName: string(1–200), mimeType: "application/pdf"\|"image/jpeg"\|"image/png", sizeBytes: int (1–10 485 760) }` | `201 { data: { uploadId: string, uploadUrl: string, method: "PUT", headers: { "Content-Type": string, "Content-Length": string }, expiresAt: iso } }` (berlaku 10 menit) | `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`, `429`, `502 UPSTREAM_FAILED` |
| `POST /v1/public/inquiries` | Header `X-Internal-Key`, `Idempotency-Key`. Body di bawah | `201 { data: { reference: string } }` | `400 VALIDATION_FAILED`, `422 UPLOAD_INVALID` (`details.uploadId`), `429`. Honeypot terisi → `201` palsu dengan `reference` acak yang tidak tersimpan. |

```ts
PublicInquiryInput = {
  name: string(1–120); company?: string(≤120)|null; email: email;
  country?: string(≤80)|null;
  categoryId?: uuid|null;          // null = "Belum menentukan"; tak dikenal → 400 (details.code "not_found")
  materialId?: uuid|null;          // null = "Terbuka untuk saran"
  volumeQuantity: int (1–1 000 000);
  targetShipment?: string(≤40)|null;   // teks bebas (Q10)
  destinationPort?: string(≤80)|null;
  budgetPerUnitUsd?: money|null;
  message?: string(≤5000)|null;
  attachmentUploadIds?: string[] (≤3, unik);
  website?: string                  // honeypot
}
```

Server mengisi `number`, `reference`, `subject`, `categoryLabel`, `materialLabel`,
`status = NEW`, `ipHash`, `userAgent`; menulis `ActivityLog` (`actorId = null`); lalu
mengirim notifikasi ke `SiteSetting.contactEmail` setelah commit (gagal kirim tidak
mengubah respons).

Contoh:

```http
POST /v1/public/inquiries
X-Internal-Key: •••
X-Client-Ip: 198.51.100.7
Idempotency-Key: 7a0f6b2e-3c1d-4b9e-8e0a-5f2d9c4b1a33
Content-Type: application/json

{
  "name": "Erik Lindqvist", "company": "Nordhem AB", "email": "erik@nordhem.se",
  "country": "Swedia", "categoryId": "b0c7…", "materialId": "e41a…",
  "volumeQuantity": 400, "targetShipment": "Nov 2026", "destinationPort": "Göteborg",
  "budgetPerUnitUsd": "38.00", "message": "Butuh finishing natural, kemasan flat-pack.",
  "attachmentUploadIds": ["upl_01J8Z3…"], "website": ""
}
```

```json
{ "data": { "reference": "INQ-0043" } }
```

Validasi gagal:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Beberapa field tidak valid.",
    "details": [
      { "path": "email", "code": "invalid_string", "message": "Email tidak valid." },
      { "path": "volumeQuantity", "code": "too_small", "message": "Volume minimal 1 pcs." }
    ],
    "requestId": "01J8Z3N4…"
  }
}
```

### 5.5 Publik — situs: settings, menu, halaman & blok, sitemap

| Method & path | Query | Respons | Error |
| --- | --- | --- | --- |
| `GET /v1/public/settings` | — | `200 { data: PublicSiteSetting }` (field §4; `logo`/`icon`: `PublicMedia\|null`) | — |
| `GET /v1/public/nav-items` | — | `200 { data: { label; type: NavItemType; href: string; style: NavItemStyle; position: int }[] }`. `href` diturunkan: `PAGE` → `Page.path`, `CATEGORY` → `/catalog?category=<slug>`, `ARTICLE_ARCHIVE` → `/journal`, `CUSTOM_LINK` → `url`. Item yang menunjuk Page tidak terbit tidak dikirim. | — |
| `GET /v1/public/pages` | `path: string` (wajib, mis. `/our-story`) | `200 { data: PublicPage }` | `404` (tidak ada / `DRAFT` / Trash) |
| `GET /v1/public/blocks/global` | — | `200 { data: PublicBlock[] }` (untuk layout yang tidak punya Page, mis. `/produk/[slug]`) | — |
| `GET /v1/public/sitemap` | — | `200 { data: { enabled: bool; entries: { path: string; updatedAt: iso }[] } }` (halaman, produk, artikel, pengrajin publik) | — |

```ts
PublicPage  = { path; title; metaTitle: string|null; metaDescription: string|null;
                blocks: PublicBlock[] }  // blok ACTIVE halaman ini urut position, lalu blok GLOBAL urut position
PublicBlock = { id: uuid; type: BlockType; layout: BlockLayout; isGlobal: bool; title: string|null; body: string|null;
                cta1: { label: string; url: string } | null; cta2: { label: string; url: string } | null;
                image: PublicMedia|null; config: Record<string, unknown>|null }
```

Blok `PRODUCT_PREVIEW` hanya membawa `config` (mis. `{ "productCount": 6 }`); Next
mengambil produknya lewat `GET /v1/public/products?limit=6` (satu sumber aturan
visibilitas produk).

Contoh `GET /v1/public/pages?path=/`:

```json
{
  "data": {
    "path": "/",
    "title": "Beranda (Landing Page)",
    "metaTitle": null,
    "metaDescription": null,
    "blocks": [
      { "id": "a1…", "type": "HERO", "layout": "BLEED", "isGlobal": false, "title": "Good Value, Crafted by Hand",
        "body": "Sourcing ornamen dari pengrajin Jawa & Bali.", "cta1": { "label": "Lihat katalog", "url": "/catalog" },
        "cta2": { "label": "Consult Your Project", "url": "/kontak" }, "image": null, "config": null },
      { "id": "f9…", "type": "PRODUCT_PREVIEW", "layout": "LEFT", "isGlobal": false, "title": "Koleksi pilihan",
        "body": null, "cta1": null, "cta2": null, "image": null, "config": { "productCount": 6 } },
      { "id": "ff…", "type": "FOOTER", "layout": "LEFT", "isGlobal": true, "title": null,
        "body": "© Ornament Sourcing Agent", "cta1": null, "cta2": null, "image": null, "config": null }
    ]
  }
}
```

---

### 5.6 Admin — produk

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/products` | CTR+ | `publishStatus?`, `stockStatus?`, `categoryId?`, `materialId?` (material mana pun), `regency?` (`artisan.regency`), `artisanId?`, `trashed?`, `q?` (name, sku, material, regency), `sort?` `-updatedAt`(default)\|`name`\|`sku`\|`-publishedAt`, `page?`, `pageSize?` | `200 { data: AdminProductRow[], meta: PageMeta }`, `counts: { all, PUBLISHED, DRAFT, trash }` | — |
| `POST /v1/admin/products` | CTR+ | `ProductInput` | `201 { data: AdminProduct }` (`publishStatus = DRAFT`, `revision = 1`, SKU dibuat, 4 `qcChecks` `PENDING`) | `409 CONFLICT` (`slug`), `403 FORBIDDEN_FIELD` (CTR kirim `slug`), `422 BUSINESS_RULE_VIOLATION` (`PRIMARY_MATERIAL_REQUIRED`, `MATERIAL_SKU_CODE_MISSING`, `PRIVATE_MEDIA_NOT_ALLOWED`) |
| `GET /v1/admin/products/:id` | CTR+ | — (termasuk yang di Trash) | `200 { data: AdminProduct }` | `404` |
| `PATCH /v1/admin/products/:id` | CTR* (draf milik sendiri) | `Partial<ProductInput> & { expectedRevision: int }` | `200 { data: AdminProduct }` (`revision + 1` bila isi berubah; tanpa perubahan → revisi tetap) | `409 EDIT_CONFLICT`, `409 CONFLICT`, `409 INVALID_STATE` (di Trash), `403 NOT_DRAFT/NOT_OWNER`, `403 FORBIDDEN_FIELD`, `422 PUBLISH_REQUIREMENTS_NOT_MET` (bila produk `PUBLISHED` dan perubahan melanggar syarat, mis. `primaryImageId: null`) |
| `POST /v1/admin/products/:id/publish` | EDT+ | `{ expectedRevision?: int }` | `200 { data: AdminProduct }` (`publishedAt` diisi bila kosong) | `422 PUBLISH_REQUIREMENTS_NOT_MET`, `409 INVALID_STATE` (di Trash) |
| `POST /v1/admin/products/:id/unpublish` | EDT+ | — | `200 { data: AdminProduct }` (`DRAFT`) | `409 INVALID_STATE` |
| `POST /v1/admin/products/:id/duplicate` | CTR+ | — | `201 { data: AdminProduct }` (aturan §6.3 model) | `404` |
| `POST /v1/admin/products/bulk` | CTR* | `{ action: "PUBLISH"\|"UNPUBLISH"\|"TRASH"\|"RESTORE"\|"PURGE"\|"SET_STOCK_STATUS", ids: uuid[] (1–100), stockStatus?: StockStatus }` | `200 { data: BulkResult }` | `400` (`stockStatus` wajib untuk `SET_STOCK_STATUS`). Per item: kode seperti endpoint tunggal (`FORBIDDEN`, `PUBLISH_REQUIREMENTS_NOT_MET`, `INVALID_STATE`, `IN_USE`). |
| `DELETE /v1/admin/products/:id` | CTR* (draf milik sendiri) | — | `200 { data: { id, deletedAt } }` (Trash) | `409 INVALID_STATE` (sudah di Trash) |
| `POST /v1/admin/products/:id/restore` | EDT+ | — | `200 { data: AdminProduct }` (status publikasi lama dipertahankan, Q3) | `409 INVALID_STATE` (tidak di Trash) |
| `DELETE /v1/admin/products/:id/permanent` | ADM | — | `204` | `409 INVALID_STATE` (belum di Trash) |
| `PATCH /v1/admin/products/:id/qc/:stage` | EDT+ | `:stage` = `QcStage`. `{ status?: QcStatus, criteria?: string\|null, notes?: string\|null }` | `200 { data: AdminQcCheck }` (`checkedById/At` diisi saat `status` berubah). Tidak menaikkan `revision`; menulis `ActivityLog kind QC`. | `404` |
| `GET /v1/admin/products/:id/revisions` | CTR* | — | `200 { data: { number, editedBy: UserRef\|null, createdAt }[] }` urut `-number` | `403 NOT_OWNER` |
| `GET /v1/admin/products/:id/revisions/:number` | CTR* | — | `200 { data: { number, editedBy, createdAt, snapshot: AdminProductSnapshot } }` | `404` |

```ts
ProductInput = {
  name: string(1–160); slug?: string (EDT+; regex ^[a-z0-9]+(-[a-z0-9]+)*$, ≤80);
  description?: RichText|null; excerpt?: string(≤300)|null;
  categoryId: uuid; artisanId?: uuid|null;
  materials: { materialId: uuid; isPrimary: bool }[];   // ≥1, tepat satu isPrimary
  tags?: string[] (≤20; dinormalisasi & dibuat bila belum ada);
  moqQuantity: int ≥1; moqUnit: string(1–16);          // UI: pcs | set | panel
  leadTimeDays?: int|null; lengthCm?/widthCm?/heightCm?: number|null; weightKg?: number|null;
  fobPriceUsd?: money|null; fobPort?: string|null;
  stockStatus: StockStatus; stockQuantity?: int ≥0 | null;   // wajib null bila MADE_TO_ORDER → 400
  stockNote?: string(≤500)|null;
  primaryImageId?: uuid|null; images?: uuid[] (≤20, urutan = position, tidak boleh memuat primaryImageId);
  specs?: { label: string(1–60); value: string(1–200) }[] (≤30, urutan = position)
}

AdminProductRow = { id; name; slug; sku; primaryImage: MediaRef|null; category: { id; name };
  primaryMaterial: { id; name }|null; artisan: { id; name; regency }|null;
  publishStatus; stockStatus; stockQuantity: int|null; moqUnit; leadTimeDays: int|null;
  revision: int; updatedAt: iso; deletedAt: iso|null }

AdminProduct = Omit<ProductInput,"materials"|"images"|"primaryImageId"|"slug"> & {
  id; slug; sku; publishStatus; publishedAt: iso|null; revision: int;
  category: { id; name; slug }; artisan: { id; name; regency; archivedAt: iso|null }|null;
  materials: { id; name; slug; isPrimary: bool }[]; tags: { id; name; slug }[];
  primaryImage: MediaRef|null; images: MediaRef[]; specs: { id; label; value; position }[];
  qcChecks: AdminQcCheck[]; duplicatedFromId: uuid|null;
  createdBy: UserRef|null; updatedBy: UserRef|null; createdAt: iso; updatedAt: iso; deletedAt: iso|null;
  publishReadiness: { ready: bool; missing: string[] } }   // path field yang kurang, untuk UI tombol "Terbitkan"

AdminQcCheck = { stage: QcStage; status: QcStatus; criteria: string|null; notes: string|null;
                 checkedBy: UserRef|null; checkedAt: iso|null }
```

Contoh — simpan dengan revisi basi:

```http
PATCH /v1/admin/products/3fa85f64-5717-4562-b3fc-2c963f66afa6
Content-Type: application/json
Origin: https://admin.ornament.id
Cookie: __Host-osa_session=•••

{ "expectedRevision": 6, "stockStatus": "LOW_STOCK", "stockQuantity": 12 }
```

```json
{
  "error": {
    "code": "EDIT_CONFLICT",
    "message": "Produk sudah diubah orang lain. Muat ulang sebelum menyimpan.",
    "details": { "currentRevision": 7, "updatedAt": "2026-09-17T02:41:10.000Z", "updatedBy": { "id": "9b1…", "name": "Dimas" } },
    "requestId": "01J8Z4…"
  }
}
```

Contoh — aksi massal:

```http
POST /v1/admin/products/bulk
{ "action": "PUBLISH", "ids": ["3fa8…", "7c21…"] }
```

```json
{
  "data": {
    "succeeded": ["3fa8…"],
    "failed": [{ "id": "7c21…", "code": "PUBLISH_REQUIREMENTS_NOT_MET", "message": "Foto utama dan pengrajin belum diisi." }]
  }
}
```

### 5.7 Admin — kategori, material, tag

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/categories` | CTR+ | `q?` | `200 { data: AdminCategory[] }` datar urut pohon (tanpa paginasi) | — |
| `POST /v1/admin/categories` | EDT+ | `{ name: string(1–80), slug?: string, parentId?: uuid\|null, description?: string\|null, position?: int }` | `201 { data: AdminCategory }` | `409 CONFLICT` (`slug`), `422 BUSINESS_RULE_VIOLATION` (`PARENT_NOT_FOUND`) |
| `PATCH /v1/admin/categories/:id` | EDT+ | parsial dari body di atas | `200 { data: AdminCategory }` | `409 CONFLICT`, `422` (`CATEGORY_CYCLE` bila parent = diri/turunannya) |
| `PUT /v1/admin/categories/order` | EDT+ | `{ items: { id: uuid; parentId: uuid\|null; position: int }[] }` (seluruh pohon) | `200 { data: AdminCategory[] }` | `422` (`CATEGORY_CYCLE`, `CATEGORY_SET_MISMATCH`) |
| `DELETE /v1/admin/categories/:id` | EDT+ | — | `204` | `409 IN_USE` (`usages`: anak dan/atau produk termasuk Trash; Q5) |
| `GET /v1/admin/materials` | CTR+ | `q?` | `200 { data: AdminMaterial[] }` urut `name` | — |
| `POST /v1/admin/materials` | EDT+ | `{ name: string(1–80), slug?: string, skuCode?: string(3, ^[A-Z]{3}$)\|null }` | `201 { data: AdminMaterial }` | `409 CONFLICT` (`name`/`slug`/`skuCode`) |
| `PATCH /v1/admin/materials/:id` | EDT+ | parsial | `200 { data: AdminMaterial }` | `409 CONFLICT`. Mengubah `skuCode` tidak mengubah SKU produk lama (§6.2). |
| `DELETE /v1/admin/materials/:id` | EDT+ | — | `204` | `409 IN_USE` |
| `GET /v1/admin/tags` | CTR+ | `q?` (prefix), `limit?` (≤20) | `200 { data: { id; name; slug; usageCount: int }[] }` (autocomplete) | — |
| `DELETE /v1/admin/tags/:id` | EDT+ | — | `204` (lepas dari konten, Cascade) | — |

```ts
AdminCategory = { id; name; slug; parentId: uuid|null; description: string|null; position: int;
                  depth: int; productCount: int /* semua publishStatus, di luar Trash, termasuk turunan */;
                  createdAt: iso; updatedAt: iso }
AdminMaterial = { id; name; slug; skuCode: string|null; productCount: int; createdAt: iso; updatedAt: iso }
```

Contoh:

```http
DELETE /v1/admin/categories/b0c7a2d4-…
```

```json
{
  "error": {
    "code": "IN_USE",
    "message": "Kategori masih dipakai dan tidak bisa dihapus.",
    "details": { "total": 9, "usages": [
      { "entityType": "Category", "id": "c11…", "label": "Kursi" },
      { "entityType": "Product", "id": "3fa8…", "label": "Kursi Lounge Rotan Bangunjiwo" }
    ] },
    "requestId": "01J8Z5…"
  }
}
```

### 5.8 Admin — pengrajin

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/artisans` | CTR+ | `status?`, `regency?`, `archived?`, `q?` (name, village, regency, skills), `sort?` `name`(default)\|`-updatedAt`\|`-monthlyCapacity`, `page?`, `pageSize?` | `200 { data: AdminArtisanRow[], meta: PageMeta }`, `counts` per `ArtisanStatus` + `archived` | — |
| `POST /v1/admin/artisans` | EDT+ | `ArtisanInput` | `201 { data: AdminArtisan }` (`status = VERIFICATION` selalu) | `409 CONFLICT` (`slug`), `422` (`PRIVATE_MEDIA_NOT_ALLOWED` untuk `photoId`/`images`) |
| `GET /v1/admin/artisans/:id` | CTR+ | — | EDT+: `200 { data: AdminArtisan }`. CTR: `200 { data: ArtisanRedacted }` | `404` |
| `PATCH /v1/admin/artisans/:id` | EDT+ | `Partial<ArtisanInput> & { status?: ArtisanStatus; expectedUpdatedAt: iso }` | `200 { data: AdminArtisan }` | `409 EDIT_CONFLICT`, `409 CONFLICT`, `409 INVALID_STATE` (diarsipkan) |
| `POST /v1/admin/artisans/:id/archive` | EDT+ | — | `200 { data: AdminArtisan & { warnings: { code: "HAS_PUBLISHED_PRODUCTS"; count: int }[] } }` | `409 INVALID_STATE`. Produk terbit tetap tayang; profil publik `404` (A10). |
| `POST /v1/admin/artisans/:id/unarchive` | EDT+ | — | `200 { data: AdminArtisan }` | `409 INVALID_STATE` |
| `GET /v1/admin/artisans/:id/documents` | EDT+ | — | `200 { data: ArtisanDocumentDto[] }` | — |
| `POST /v1/admin/artisans/:id/documents` | EDT+ | `{ mediaId: uuid (Media PRIVATE terkonfirmasi), kind: ArtisanDocumentKind, title: string(1–120) }` | `201 { data: ArtisanDocumentDto }` | `422` (`MEDIA_NOT_PRIVATE`) |
| `PATCH /v1/admin/artisans/:id/documents/:documentId` | EDT+ | `{ kind?, title? }` | `200 { data: ArtisanDocumentDto }` | `404` |
| `DELETE /v1/admin/artisans/:id/documents/:documentId` | EDT+ | — | `204` (Media ikut dipindah ke Trash) | `404` |

Hapus pengrajin tidak tersedia (model D3: diarsipkan). "Riwayat order" di luar cakupan.

```ts
ArtisanInput = { name: string(1–120); slug?: string; contactName?: string|null; phone?: string (E.164)|null;
  partnerSinceYear?: int (1950–tahun ini)|null; village?: string|null; regency: string; province: string;
  address?: string|null; craftsmenCount?: int|null; monthlyCapacity?: int|null; capacityUnit?: string (default "pcs");
  avgLeadTimeDays?: int|null; skills: string[] (≥1); summary?: string(≤300)|null; story?: RichText|null;
  internalNotes?: string|null; photoId?: uuid|null; images?: { mediaId: uuid; caption?: string|null }[] }
AdminArtisanRow = { id; name; slug; village; regency; province; skills; status; monthlyCapacity; capacityUnit;
  photo: MediaRef|null; productCount: int; archivedAt: iso|null; updatedAt: iso }
AdminArtisan    = ArtisanInput-bentuk-respons & { id; status; archivedAt; photo: MediaRef|null;
  images: (MediaRef & { caption })[]; productCount: int; publishedProductCount: int; createdAt; updatedAt }
ArtisanRedacted = Omit<AdminArtisan, "contactName"|"phone"|"address"|"internalNotes">   // tanpa dokumen
ArtisanDocumentDto = { id; kind; title; media: { id; fileName; mimeType; sizeBytes }; uploadedBy: UserRef|null; createdAt }
```

Contoh — respons Contributor untuk `GET /v1/admin/artisans/:id` (perhatikan field 🔒
**tidak ada**, bukan `null`):

```json
{
  "data": {
    "id": "5e2…", "name": "Anyam Bangunjiwo", "slug": "anyam-bangunjiwo",
    "partnerSinceYear": 2018, "village": "Bangunjiwo", "regency": "Bantul", "province": "DI Yogyakarta",
    "craftsmenCount": 8, "monthlyCapacity": 600, "capacityUnit": "pcs", "avgLeadTimeDays": 45,
    "skills": ["anyaman rotan"], "summary": "Workshop keluarga.", "story": null,
    "status": "ACTIVE", "archivedAt": null, "photo": null, "images": [],
    "productCount": 16, "publishedProductCount": 14,
    "createdAt": "2026-01-10T03:00:00.000Z", "updatedAt": "2026-09-01T07:12:00.000Z"
  }
}
```

### 5.9 Admin — artikel

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/articles` | CTR+ | `status?`, `category?`, `authorId?`, `trashed?`, `q?` (title), `sort?` `-updatedAt`(default)\|`-publishedAt`\|`title`, `page?`, `pageSize?` | `200 { data: AdminArticleRow[], meta: PageMeta }`, `counts: { all, DRAFT, SCHEDULED, PUBLISHED, trash }` | — |
| `POST /v1/admin/articles` | CTR+ | `ArticleInput` (minimal `{ title }`; `content` default `[]`) — juga dipakai "Draf cepat" dashboard (Q1) | `201 { data: AdminArticle }` (`DRAFT`, `authorId` = diri sendiri) | `409 CONFLICT`, `403 FORBIDDEN_FIELD` (CTR kirim `authorId`/`slug`), `422` (`MEDIA_NOT_FOUND`, `PRIVATE_MEDIA_NOT_ALLOWED`) |
| `GET /v1/admin/articles/:id` | CTR+ | — | `200 { data: AdminArticle }` | `404` |
| `PATCH /v1/admin/articles/:id` | CTR* (draf milik sendiri) | `Partial<ArticleInput> & { expectedUpdatedAt: iso }` | `200 { data: AdminArticle }` (`wordCount` dihitung ulang) | `409 EDIT_CONFLICT`, `403 NOT_DRAFT/NOT_OWNER`, `409 INVALID_STATE` (Trash) |
| `POST /v1/admin/articles/:id/publish` | EDT+ | `{ publishAt?: iso\|null }` — kosong/`null` = terbit sekarang (`PUBLISHED`); masa depan = `SCHEDULED` | `200 { data: AdminArticle }` | `422 BUSINESS_RULE_VIOLATION` (`PUBLISH_AT_IN_PAST`), `422 PUBLISH_REQUIREMENTS_NOT_MET` (`title`, `content` tidak kosong, alt pada gambar) |
| `POST /v1/admin/articles/:id/unpublish` | EDT+ | — | `200 { data: AdminArticle }` (`DRAFT`, `publishAt = null`; `publishedAt` dipertahankan) | `409 INVALID_STATE` |
| `POST /v1/admin/articles/:id/preview` | CTR* | Body opsional `Partial<ArticleInput>` (isi editor yang belum disimpan) | `200 { data: PublicArticleDetail }` — hasil transformasi DTO publik **tanpa menyimpan**; `publishedAt` = sekarang bila belum terbit, `commentCount` = 0 | `403 NOT_OWNER` |
| `POST /v1/admin/articles/bulk` | CTR* | `{ action: "PUBLISH"\|"UNPUBLISH"\|"TRASH"\|"RESTORE"\|"PURGE", ids }` | `200 { data: BulkResult }` | per item |
| `DELETE /v1/admin/articles/:id` | CTR* (draf milik sendiri) | — | `200 { data: { id, deletedAt } }` | `409 INVALID_STATE` |
| `POST /v1/admin/articles/:id/restore` | EDT+ | — | `200 { data: AdminArticle }` | `409 INVALID_STATE` |
| `DELETE /v1/admin/articles/:id/permanent` | ADM | — | `204` (komentar ikut terhapus) | `409 INVALID_STATE` |

Pratinjau memakai `POST` + body agar tidak ada token pratinjau yang bisa bocor dan
Contributor bisa melihat hasil sebelum menyimpan; admin merender DTO ini dengan
komponen situs publik.

```ts
ArticleInput = { title: string(1–200); slug?: string (EDT+); excerpt?: string(≤300)|null;
  content?: ArticleBlock[] (≤200 blok; id blok unik); category?: ArticleCategory (default CRAFT_JOURNAL);
  tags?: string[] (≤20); featuredImageId?: uuid|null; authorId?: uuid (EDT+) }
AdminArticleRow = { id; title; slug; category; status: ArticleStatus; author: UserRef; publishAt: iso|null;
  publishedAt: iso|null; commentCount: int; pendingCommentCount: int; updatedAt: iso; deletedAt: iso|null }
AdminArticle    = AdminArticleRow & { excerpt: string|null; content: ArticleBlock[]; tags: { id; name; slug }[];
  featuredImage: MediaRef|null; wordCount: int; blockCount: int; createdAt: iso }
```

Contoh — jadwalkan:

```http
POST /v1/admin/articles/2d4e…/publish
{ "publishAt": "2026-09-20T01:00:00.000Z" }
```

```json
{ "data": { "id": "2d4e…", "title": "Rotan dari Hulu ke Anyaman", "slug": "rotan-dari-hulu-ke-anyaman",
  "category": "PROCESS", "status": "SCHEDULED", "author": { "id": "8a…", "name": "Rani" },
  "publishAt": "2026-09-20T01:00:00.000Z", "publishedAt": null, "commentCount": 0, "pendingCommentCount": 0,
  "updatedAt": "2026-09-17T04:00:00.000Z", "deletedAt": null, "excerpt": null,
  "content": [{ "id": "b1", "type": "paragraph", "text": [{ "text": "Rotan dipanen…" }] }],
  "tags": [{ "id": "t1", "name": "bantul", "slug": "bantul" }], "featuredImage": null,
  "wordCount": 612, "blockCount": 4, "createdAt": "2026-09-15T02:00:00.000Z" } }
```

### 5.10 Admin — komentar

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/comments` | EDT+ | `status?` (default `PENDING`), `articleId?`, `q?` (authorName, body), `sort?` `-createdAt`(default)\|`createdAt`, `page?`, `pageSize?` | `200 { data: AdminComment[], meta: PageMeta }`, `counts` per `CommentStatus` | — |
| `PATCH /v1/admin/comments/:id` | EDT+ | `{ status: "APPROVED"\|"SPAM"\|"DELETED"\|"PENDING" }` | `200 { data: AdminComment }` (`moderatedById/At` diisi) | `409 INVALID_STATE` (mis. `DELETED` → apa pun: tidak bisa dipulihkan dari UI) |
| `POST /v1/admin/comments/:id/replies` | EDT+ | `{ body: string(1–2000) }` | `201 { data: AdminComment }` (`authorUserId` = diri, `authorName` = `User.name`, `APPROVED`; komentar induk otomatis `APPROVED` bila masih `PENDING`) | `422` (`REPLY_DEPTH_EXCEEDED` bila induk sudah balasan, `ARTICLE_NOT_PUBLISHED`) |
| `POST /v1/admin/comments/bulk` | EDT+ | `{ action: "APPROVE"\|"SPAM"\|"DELETE", ids }` | `200 { data: BulkResult }` | per item |

```ts
AdminComment = { id; article: { id; title; slug }; parentId: uuid|null; authorName; authorEmail: string|null;
  isStaffReply: bool; author: UserRef|null; body; status: CommentStatus; moderatedBy: UserRef|null;
  moderatedAt: iso|null; createdAt: iso }   // ipHash & userAgent tidak dikirim bahkan ke admin
```

Contoh:

```http
PATCH /v1/admin/comments/61c…
{ "status": "APPROVED" }
```

```json
{ "data": { "id": "61c…", "article": { "id": "2d4e…", "title": "Rotan dari Hulu ke Anyaman", "slug": "rotan-dari-hulu-ke-anyaman" },
  "parentId": null, "authorName": "Sofia L.", "authorEmail": "sofia@studio.se", "isStaffReply": false, "author": null,
  "body": "Berapa lama rotan dikeringkan?", "status": "APPROVED", "moderatedBy": { "id": "8a…", "name": "Rani" },
  "moderatedAt": "2026-09-17T05:02:00.000Z", "createdAt": "2026-09-17T04:40:00.000Z" } }
```

### 5.11 Admin — inquiry

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/inquiries` | EDT+ | `status?`, `q?` (reference, name, company, email, subject), `sort?` `-createdAt`(default), `page?`, `pageSize?` | `200 { data: AdminInquiryRow[], meta: PageMeta }`, `counts: { all, NEW, IN_PROGRESS, DONE, unread }` | — |
| `GET /v1/admin/inquiries/:id` | EDT+ | — (GET tidak mengubah `readAt`) | `200 { data: AdminInquiry }` | `404` |
| `PATCH /v1/admin/inquiries/:id` | EDT+ | `{ read?: bool, status?: InquiryStatus }` | `200 { data: AdminInquiry }` | `409 INVALID_STATE` (transisi §6.5 model: `DONE → NEW` ditolak; `DONE → IN_PROGRESS` hanya lewat balasan baru) |
| `POST /v1/admin/inquiries/:id/replies` | EDT+ | `{ subject?: string(1–200), body: string(1–20000), attachmentMediaIds?: uuid[] (≤5, Media PRIVATE) }` | `201 { data: InquiryReplyDto }` (`DRAFT`, `toEmail` dari inquiry) | `422` (`MEDIA_NOT_PRIVATE`) |
| `PATCH /v1/admin/inquiries/:id/replies/:replyId` | EDT+ | sama, parsial | `200 { data: InquiryReplyDto }` | `409 INVALID_STATE` (`SENT` tidak bisa diedit) |
| `DELETE /v1/admin/inquiries/:id/replies/:replyId` | EDT+ | — | `204` | `409 INVALID_STATE` (hanya `DRAFT`) |
| `POST /v1/admin/inquiries/:id/replies/:replyId/send` | EDT+ | — (`Idempotency-Key` disarankan) | `200 { data: { reply: InquiryReplyDto, inquiry: AdminInquiryRow } }`. Resend gagal → **tetap `200`** dengan `reply.status = "FAILED"` dan `reply.emailError`; bisa dikirim ulang. Sukses → `SENT`; inquiry `NEW`/`DONE` → `IN_PROGRESS`. | `409 INVALID_STATE` (sudah `SENT`) |

Lampiran dibuka lewat `GET /v1/admin/media/:mediaId/url` (§5.12).

```ts
AdminInquiryRow = { id; number: int; reference; subject; name; company: string|null; email; country: string|null;
  volumeQuantity: int; status: InquiryStatus; readAt: iso|null; preview: string /* ±120 karakter message */;
  attachmentCount: int; replyCount: int; createdAt: iso }
AdminInquiry    = AdminInquiryRow & { category: { id; name }|null; categoryLabel: string|null;
  material: { id; name }|null; materialLabel: string|null; targetShipment: string|null; destinationPort: string|null;
  budgetPerUnitUsd: money|null; message: string|null; completedAt: iso|null;
  notificationError: string|null;
  attachments: InquiryAttachmentDto[];   // replyId null (dari pembeli)
  replies: InquiryReplyDto[] }           // urut createdAt
InquiryReplyDto = { id; author: UserRef; toEmail; subject; body; status: ReplyStatus; sentAt: iso|null;
  emailError: string|null; attachments: InquiryAttachmentDto[]; createdAt: iso; updatedAt: iso }
InquiryAttachmentDto = { id; mediaId: uuid; fileName; mimeType; sizeBytes: number }
```

Contoh — kirim balasan yang gagal di Resend:

```http
POST /v1/admin/inquiries/0c9…/replies/7ee…/send
Idempotency-Key: 5b3e…
```

```json
{
  "data": {
    "reply": { "id": "7ee…", "author": { "id": "8a…", "name": "Rani" }, "toEmail": "erik@nordhem.se",
      "subject": "Re: Rotan alami — 400 pcs", "body": "Terima kasih, terlampir penawaran…", "status": "FAILED",
      "sentAt": null, "emailError": "Resend 503: service unavailable",
      "attachments": [{ "id": "a01…", "mediaId": "m77…", "fileName": "penawaran-INQ-0043.pdf", "mimeType": "application/pdf", "sizeBytes": 184233 }],
      "createdAt": "2026-09-17T06:00:00.000Z", "updatedAt": "2026-09-17T06:01:00.000Z" },
    "inquiry": { "id": "0c9…", "number": 43, "reference": "INQ-0043", "subject": "Rotan alami — 400 pcs", "status": "NEW", "…": "…" }
  }
}
```

### 5.12 Admin — media

Alur upload (ADR K3): `POST /media/uploads` → `PUT` ke R2 → `POST /media` (konfirmasi).

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `POST /v1/admin/media/uploads` | CTR+ (`PRIVATE`: EDT+) | `{ fileName: string(1–200), mimeType: string, sizeBytes: int, visibility?: MediaVisibility (default PUBLIC) }` | `201 { data: { uploadId, uploadUrl, method: "PUT", headers: { "Content-Type", "Content-Length" }, key, expiresAt: iso } }` (10 menit) | `415 UNSUPPORTED_MEDIA_TYPE`, `413 PAYLOAD_TOO_LARGE`, `403 FORBIDDEN` (CTR + PRIVATE), `502 UPSTREAM_FAILED` |
| `POST /v1/admin/media` | CTR+ | `{ uploadId: string, alt?: string(≤300)\|null }` | `201 { data: AdminMedia }` (setelah `HeadObject` cocok; `width/height` dibaca untuk gambar) | `422 UPLOAD_INVALID` (`NOT_FOUND`/`MISMATCH`/`EXPIRED`), `409 CONFLICT` (sudah dikonfirmasi — idempoten: kembalikan `200` media yang sama bila `uploadId` sama dan pemanggil sama) |
| `GET /v1/admin/media` | CTR+ | `kind?: MediaKind`, `visibility?` (CTR: dipaksa `PUBLIC`), `month?: YYYY-MM`, `uploadedById?`, `unused?: bool`, `trashed?`, `q?` (fileName, alt), `sort?` `-createdAt`(default)\|`fileName`\|`-sizeBytes`, `page?`, `pageSize?` (default 40) | `200 { data: AdminMedia[], meta: PageMeta & { totalSizeBytes: number, months: string[] } }` | — |
| `GET /v1/admin/media/:id` | CTR+ | — | `200 { data: AdminMedia & { usages: MediaUsage[] } }` | `404` (CTR untuk `PRIVATE`) |
| `PATCH /v1/admin/media/:id` | CTR* (milik sendiri) | `{ alt?: string\|null, fileName?: string }` | `200 { data: AdminMedia }` | `422` (`ALT_REQUIRED` bila `alt: null` pada media yang dipakai konten terbit) |
| `GET /v1/admin/media/:id/url` | EDT+ (untuk `PRIVATE`); CTR+ (`PUBLIC`) | `download?: bool` (set `Content-Disposition: attachment`) | `200 { data: { url: string, expiresAt: iso\|null } }` — `PUBLIC`: URL domain publik, `expiresAt: null`; `PRIVATE`: presigned GET 5 menit | `404` |
| `DELETE /v1/admin/media/:id` | CTR* (milik sendiri, tidak dipakai) | — | `200 { data: { id, deletedAt } }` | `409 IN_USE` bila dirujuk konten **terbit** (model §5); `details.usages` |
| `POST /v1/admin/media/:id/restore` | EDT+ | — | `200 { data: AdminMedia }` | `409 INVALID_STATE` |
| `DELETE /v1/admin/media/:id/permanent` | ADM | — | `204` (baris DB dulu, lalu objek R2) | `409 INVALID_STATE` (belum di Trash), `409 IN_USE` (masih dirujuk apa pun) |

**Allowlist upload** (satu sumber di `@ornament/shared/media`):

| `visibility` | MIME | Maks |
| --- | --- | --- |
| `PUBLIC` | `image/jpeg`, `image/png`, `image/webp` | 10 MB |
| `PUBLIC` | `application/pdf` | 20 MB |
| `PRIVATE` | `application/pdf`, `image/jpeg`, `image/png` | 10 MB |

```ts
AdminMedia = { id; kind: MediaKind; visibility: MediaVisibility; url: string|null /* null bila PRIVATE */;
  fileName; mimeType; sizeBytes: number; width: int|null; height: int|null; alt: string|null;
  uploadedBy: UserRef|null; usageCount: int; createdAt: iso; deletedAt: iso|null }
MediaUsage = { entityType: "Product"|"ProductImage"|"Artisan"|"ArtisanImage"|"ArtisanDocument"|"Article"|"PageBlock"|"SiteSetting"|"InquiryAttachment";
  entityId: uuid; label: string; field: string; isPublished: bool }
```

Contoh — presign lalu konfirmasi:

```http
POST /v1/admin/media/uploads
{ "fileName": "Kursi Lounge Depan.jpg", "mimeType": "image/jpeg", "sizeBytes": 845112 }
```

```json
{ "data": { "uploadId": "upl_01J8Z6…", "uploadUrl": "https://<account>.r2.cloudflarestorage.com/ornament/media/2026/09/9c1e…-kursi-lounge-depan.jpg?X-Amz-…",
  "method": "PUT", "headers": { "Content-Type": "image/jpeg", "Content-Length": "845112" },
  "key": "media/2026/09/9c1e…-kursi-lounge-depan.jpg", "expiresAt": "2026-09-17T06:20:00.000Z" } }
```

```http
POST /v1/admin/media
{ "uploadId": "upl_01J8Z6…", "alt": "Kursi lounge rotan tampak depan" }
```

```json
{ "data": { "id": "9c1e…", "kind": "IMAGE", "visibility": "PUBLIC", "url": "https://media.ornament.id/media/2026/09/9c1e…-kursi-lounge-depan.jpg",
  "fileName": "Kursi Lounge Depan.jpg", "mimeType": "image/jpeg", "sizeBytes": 845112, "width": 1600, "height": 2000,
  "alt": "Kursi lounge rotan tampak depan", "uploadedBy": { "id": "8a…", "name": "Rani" }, "usageCount": 0,
  "createdAt": "2026-09-17T06:11:00.000Z", "deletedAt": null } }
```

`uploadId` adalah token bertanda tangan (HMAC) berisi `key`, `mimeType`, `sizeBytes`,
`visibility`, `userId`, `exp`; server tidak perlu tabel upload sementara.

### 5.13 Admin — pengguna & undangan

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/users` | ADM | `role?`, `status?` (default `ACTIVE`), `q?` (name, email), `sort?` `name`\|`-lastActiveAt`, `page?`, `pageSize?` | `200 { data: AdminUser[], meta: PageMeta }`, `counts` per `UserRole` | — |
| `GET /v1/admin/users/:id` | ADM | — | `200 { data: AdminUser }` | `404` |
| `PATCH /v1/admin/users/:id` | ADM | `{ name?: string(1–100), role?: UserRole }` | `200 { data: AdminUser }` | `422 BUSINESS_RULE_VIOLATION` (`LAST_ADMINISTRATOR`, `CANNOT_CHANGE_OWN_ROLE`) |
| `POST /v1/admin/users/:id/revoke` | ADM | — | `200 { data: AdminUser }` (`REVOKED`, semua sesi dihapus) | `422` (`CANNOT_REVOKE_SELF`, `LAST_ADMINISTRATOR`), `409 INVALID_STATE` |
| `POST /v1/admin/users/:id/reactivate` | ADM | — | `200 { data: AdminUser }` (`ACTIVE`, `revokedAt = null`; user login dengan sandi lama) | `409 INVALID_STATE` |
| `GET /v1/admin/invites` | ADM | `status?: "PENDING"\|"EXPIRED"\|"ACCEPTED"\|"REVOKED"` (default `PENDING`) | `200 { data: AdminInvite[] }` (tanpa paginasi) | — |
| `POST /v1/admin/invites` | ADM | `{ email: string (@ornament.id), role: UserRole }` | `201 { data: AdminInvite }`; email Resend setelah commit | `409 CONFLICT` (`email` sudah User **atau** sudah ada undangan aktif), `400` (`email_domain`) |
| `POST /v1/admin/invites/:id/resend` | ADM | — | `200 { data: AdminInvite }` (token baru, `expiresAt` +72 jam, token lama tidak berlaku) | `409 INVALID_STATE` (diterima/dicabut) |
| `DELETE /v1/admin/invites/:id` | ADM | — | `200 { data: AdminInvite }` (`revokedAt`) | `409 INVALID_STATE` |

`GET /v1/admin/users/roles` tidak perlu: matriks `ROLE_CAPS` ditampilkan dari konstanta
`@ornament/shared/permissions` (sama dengan yang dipakai guard API).

```ts
AdminUser   = { id; email; name; role: UserRole; status: UserStatus; avatar: MediaRef|null; lastActiveAt: iso|null;
  revokedAt: iso|null; contentCount: { articles: int; products: int; revisions: int }; createdAt: iso }
AdminInvite = { id; email; role: UserRole; status: "PENDING"|"EXPIRED"|"ACCEPTED"|"REVOKED" /* turunan */;
  invitedBy: UserRef; expiresAt: iso; acceptedAt: iso|null; revokedAt: iso|null;
  emailSentAt: iso|null; emailError: string|null; createdAt: iso }
```

Contoh:

```http
POST /v1/admin/invites
Idempotency-Key: 1f7b…
{ "email": "dimas@ornament.id", "role": "EDITOR" }
```

```json
{ "data": { "id": "c3a…", "email": "dimas@ornament.id", "role": "EDITOR", "status": "PENDING",
  "invitedBy": { "id": "8a…", "name": "Rani" }, "expiresAt": "2026-09-20T06:30:00.000Z", "acceptedAt": null,
  "revokedAt": null, "emailSentAt": "2026-09-17T06:30:01.000Z", "emailError": null, "createdAt": "2026-09-17T06:30:00.000Z" } }
```

### 5.14 Admin — halaman & blok

Sesuai ADR K11: tidak ada pembuatan halaman atau blok baru; hanya isi, urutan, dan
status. Perubahan langsung tayang (tanpa draf halaman, model §8).

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/pages` | CTR+ | `status?`, `trashed?`, `q?` (title, path), `page?`, `pageSize?` | `200 { data: AdminPageRow[], meta: PageMeta }` | — |
| `GET /v1/admin/pages/:id` | CTR+ | — | `200 { data: AdminPage }` (blok halaman + blok global) | `404` |
| `PATCH /v1/admin/pages/:id` | EDT+ | `{ expectedUpdatedAt: iso; title?; path?; status?: PublishStatus; metaTitle?: string\|null; metaDescription?: string(≤160)\|null }` | `200 { data: AdminPage }` | `409 EDIT_CONFLICT`, `409 CONFLICT` (`path`), `422` (`SYSTEM_PAGE_PROTECTED` bila ubah `path` halaman `systemKey`) |
| `PUT /v1/admin/pages/:id/blocks` | EDT+ | `{ expectedUpdatedAt: iso; blocks: PageBlockInput[] }` — **seluruh** blok milik halaman, urutan array = `position` | `200 { data: AdminPage }` (atomik; `Page.updatedAt` disentuh) | `409 EDIT_CONFLICT`, `422` (`BLOCK_SET_MISMATCH`: id tidak persis sama dengan blok yang ada; `BLOCK_VISIBILITY_INVALID`: blok halaman hanya `ACTIVE`/`HIDDEN`; `CTA_URL_INVALID`; `PRIVATE_MEDIA_NOT_ALLOWED`) |
| `PATCH /v1/admin/blocks/:id` | EDT+ | `Partial<Omit<PageBlockInput,"id">> & { expectedUpdatedAt: iso }` — satu blok (termasuk global, Q2) | `200 { data: AdminBlock }` | sama seperti di atas |
| `POST /v1/admin/pages/:id/preview` | EDT+ | Body opsional `{ blocks?: PageBlockInput[]; title?; metaTitle?; metaDescription? }` | `200 { data: PublicPage }` tanpa menyimpan (blok `HIDDEN` disaring seperti publik) | `422` seperti di atas |
| `DELETE /v1/admin/pages/:id` | EDT+ | — | `200 { data: { id, deletedAt } }` | `422` (`SYSTEM_PAGE_PROTECTED`) |
| `POST /v1/admin/pages/:id/restore` | EDT+ | — | `200 { data: AdminPage }` | `409 INVALID_STATE` |
| `DELETE /v1/admin/pages/:id/permanent` | ADM | — | `204` | `409 INVALID_STATE` |

```ts
PageBlockInput = { id: uuid; visibility: BlockVisibility; layout: BlockLayout; name: string(1–80);
  title?: string|null; body?: string(≤5000)|null; cta1Label?: string|null; cta1Url?: string|null;
  cta2Label?: string|null; cta2Url?: string|null;   // url: path internal "/…" atau "https://…" (model §3.8)
  imageId?: uuid|null; config?: object|null }        // skema config per BlockType di shared; `type` tidak bisa diubah
AdminBlock   = PageBlockInput & { type: BlockType; pageId: uuid|null; position: int; image: MediaRef|null; updatedAt: iso }
AdminPageRow = { id; title; path; systemKey: string|null; status: PublishStatus; blockCount: int;
  updatedBy: UserRef|null; updatedAt: iso; deletedAt: iso|null }
AdminPage    = AdminPageRow & { metaTitle: string|null; metaDescription: string|null;
  blocks: AdminBlock[]; globalBlocks: AdminBlock[] }
```

Contoh — "Perbarui" di Page Builder (sembunyikan testimoni, pindah Story ke atas):

```http
PUT /v1/admin/pages/1a2…/blocks
{
  "expectedUpdatedAt": "2026-09-17T05:59:00.000Z",
  "blocks": [
    { "id": "a1…", "visibility": "ACTIVE", "layout": "BLEED", "name": "Hero — Good Value", "title": "Good Value, Crafted by Hand",
      "body": "Sourcing ornamen dari pengrajin Jawa & Bali.", "cta1Label": "Lihat katalog", "cta1Url": "/catalog",
      "cta2Label": "Consult Your Project", "cta2Url": "/kontak", "imageId": null, "config": null },
    { "id": "b2…", "visibility": "ACTIVE", "layout": "LEFT", "name": "Story", "title": "Cerita kami", "body": "…",
      "cta1Label": null, "cta1Url": null, "cta2Label": null, "cta2Url": null, "imageId": "9c1e…", "config": null },
    { "id": "d4…", "visibility": "HIDDEN", "layout": "CENTER", "name": "Testimoni", "title": null, "body": null,
      "cta1Label": null, "cta1Url": null, "cta2Label": null, "cta2Url": null, "imageId": null, "config": null }
  ]
}
```

Respons `200 { data: AdminPage }`; API memicu revalidasi tag `page:/` (§6).

### 5.15 Admin — settings, menu, SEO

SEO disimpan di `SiteSetting` (`seoHomeTitle`, `seoKeywords`, `seoDescription`,
`sitemapEnabled`, `allowIndexing`), jadi tidak punya endpoint terpisah. Tab "Tema" dan
"Permalink" di luar cakupan (ADR K11) dan tidak punya endpoint.

| Method & path | Izin | Body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/settings` | ADM | — | `200 { data: AdminSiteSetting }` | — |
| `PATCH /v1/admin/settings` | ADM | `Partial<SiteSettingInput> & { expectedUpdatedAt: iso }` | `200 { data: AdminSiteSetting }` | `409 EDIT_CONFLICT`, `400` (`timezone` bukan IANA, `seoDescription` > 160), `422` (`PRIVATE_MEDIA_NOT_ALLOWED`) |
| `GET /v1/admin/nav-items` | ADM | — | `200 { data: AdminNavItem[], meta: { updatedAt: iso } }` | — |
| `PUT /v1/admin/nav-items` | ADM | `{ expectedUpdatedAt: iso; items: NavItemInput[] }` — daftar lengkap; item tanpa `id` dibuat, item lama yang tidak dikirim dihapus; urutan array = `position` | `200 { data: AdminNavItem[], meta }` | `409 EDIT_CONFLICT`, `422` (`NAV_TARGET_REQUIRED`: `pageId`/`categoryId`/`url` sesuai `type`; `NAV_TARGET_NOT_FOUND`), `400` (maks 12 item) |

```ts
SiteSettingInput = { siteName: string(1–80); tagline: string|null; contactEmail: email;
  instagramHandle: string|null; instagramUrl: url|null; siteLanguage: SiteLanguage; timezone: string;
  address: string|null; logoId: uuid|null; iconId: uuid|null; seoHomeTitle: string(≤70)|null;
  seoKeywords: string(≤255)|null; seoDescription: string(≤160)|null; sitemapEnabled: bool; allowIndexing: bool }
AdminSiteSetting = Omit<SiteSettingInput,"logoId"|"iconId"> & { logo: MediaRef|null; icon: MediaRef|null;
  updatedBy: UserRef|null; updatedAt: iso }
NavItemInput = { id?: uuid; label: string(1–40); type: NavItemType; pageId?: uuid|null; categoryId?: uuid|null;
  url?: string|null; style: NavItemStyle }
AdminNavItem = NavItemInput & { id: uuid; position: int; href: string; target: { title: string }|null }
```

Contoh:

```http
PATCH /v1/admin/settings
{ "expectedUpdatedAt": "2026-09-10T02:00:00.000Z", "seoDescription": "Sourcing agent ornamen & furniture kerajinan Indonesia.", "allowIndexing": true }
```

```json
{ "data": { "siteName": "Ornament Sourcing Agent", "tagline": "Good Value", "contactEmail": "hello@ornament.id",
  "instagramHandle": "ornament.id", "instagramUrl": "https://instagram.com/ornament.id", "siteLanguage": "ID",
  "timezone": "Asia/Jakarta", "address": "Bantul, DI Yogyakarta", "logo": null, "icon": null,
  "seoHomeTitle": "Ornament Sourcing Agent — Good Value", "seoKeywords": "rattan, teak, handicraft",
  "seoDescription": "Sourcing agent ornamen & furniture kerajinan Indonesia.", "sitemapEnabled": true, "allowIndexing": true,
  "updatedBy": { "id": "8a…", "name": "Rani" }, "updatedAt": "2026-09-17T06:40:00.000Z" } }
```

### 5.16 Admin — dashboard & activity log

| Method & path | Izin | Query | Respons | Catatan |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/dashboard` | CTR+ | — | `200 { data: DashboardDto }` | Field inquiry `null` untuk CTR. |
| `GET /v1/admin/activity` | CTR+ | `kind?: ActivityKind` (multi, koma), `entityType?`, `entityId?`, `actorId?`, `before?: iso`, `limit?`, `cursor?` | `200 { data: ActivityDto[], meta: CursorMeta }` urut `-createdAt` | CTR: `INQUIRY`, `USER`, `SETTING` disaring otomatis (meminta eksplisit → hasil kosong, bukan 403). |

```ts
DashboardDto = {
  products:  { published: int; draft: int; trash: int };
  inquiries: { new: int; inProgress: int; last7Days: int } | null;
  artisans:  { active: int; fullCapacity: int; verification: int };
  articles:  { published: int; scheduled: int; draft: int; nextScheduledAt: iso|null };
  comments:  { pending: int } | null;               // null untuk CTR
  media:     { count: int; totalSizeBytes: number };
  myDrafts:  { products: int; articles: int };
  recentActivity: ActivityDto[] }                   // 8 terbaru, sudah disaring per peran
ActivityDto = { id; kind: ActivityKind; action: string; message: string; actor: UserRef|null /* null = Sistem */;
  entityType: string|null; entityId: uuid|null; adminPath: string|null /* mis. "/admin/products/new?id=…" */; createdAt: iso }
```

"Order produksi" di dashboard di luar cakupan. "Draf cepat" memakai
`POST /v1/admin/articles` (Q1).

Contoh `GET /v1/admin/activity?kind=PRODUCT,QC&limit=2`:

```json
{
  "data": [
    { "id": "e1…", "kind": "QC", "action": "product.qc_updated", "message": "QC Frame lolos — Kursi Lounge Rotan Bangunjiwo",
      "actor": { "id": "9b1…", "name": "Dimas" }, "entityType": "Product", "entityId": "3fa8…",
      "adminPath": "/admin/products/3fa8…", "createdAt": "2026-09-17T03:10:00.000Z" },
    { "id": "e0…", "kind": "PRODUCT", "action": "product.published", "message": "Produk diterbitkan — Lampu Bambu Petung",
      "actor": { "id": "8a…", "name": "Rani" }, "entityType": "Product", "entityId": "7c21…",
      "adminPath": "/admin/products/7c21…", "createdAt": "2026-09-17T02:55:00.000Z" }
  ],
  "meta": { "limit": 2, "nextCursor": "eyJjIjoiMjAyNi0wOS0xN1QwMjo1NTowMC4wMDBaIiwiaSI6ImUwIn0" }
}
```

### 5.17 Internal — revalidasi & job

| Method & path | Auth | Body | Respons | Catatan |
| --- | --- | --- | --- | --- |
| `POST /v1/internal/jobs/publish-scheduled` | Bearer `INTERNAL_JOB_TOKEN` | — | `200 { data: { published: int, slugs: string[] } }` | Sama dengan job 60 detik in-process (ADR K8). Untuk cron eksternal bila deploy serverless. Idempoten. |
| `POST /v1/internal/jobs/purge-trash` | Bearer | `{ dryRun?: bool }` | `200 { data: { products: int, articles: int, pages: int, media: int, skippedMediaInUse: int } }` | Harian; `deletedAt < now() - 30 hari` (model §6.4). |
| `POST /v1/internal/jobs/cleanup-uploads` | Bearer | `{ olderThanHours?: int (default 24) }` | `200 { data: { deletedObjects: int } }` | Objek R2 tanpa record `Media` (ADR K3, lampiran inquiry tak diklaim). |
| `POST /v1/admin/revalidate` | Sesi `ADM` | `{ tags: string[] (1–50) }` atau `{ all: true }` | `200 { data: { tags: string[], ok: bool, error: string\|null } }` | Tombol operasional "bersihkan cache situs". |

Semua job menulis `ActivityLog` dengan `actorId = null` hanya bila ada perubahan.
Bearer salah → `401 INVALID_INTERNAL_KEY`. Bila dua instance menjalankan job
bersamaan, hasilnya tetap aman (UPDATE atomik).

---

## 6. Revalidasi cache Next (API → situs publik)

Ini kontrak **keluar** dari API ke Next, bukan endpoint API.

| Aspek | Nilai |
| --- | --- |
| Request | `POST ${SITE_URL}/api/revalidate`, header `X-Revalidate-Secret: <REVALIDATE_SECRET>`, `Content-Type: application/json`, body `{ "tags": string[] }` |
| Respons Next | `200 { "revalidated": string[] }`; `401` bila secret salah |
| Waktu | Setelah transaksi DB commit. Timeout 3 detik, 1× retry. Gagal → dicatat di log (bukan error respons admin); tombol §5.17 sebagai pemulihan manual. |

Tag yang dipakai `fetch(..., { next: { tags } })` di situs publik dan yang dipicu API:

| Tag | Dipakai oleh GET | Dipicu oleh perubahan |
| --- | --- | --- |
| `products` | `/public/products`, `/public/categories`, `/public/materials`, `/public/sitemap` | Produk: simpan (bila terbit/berubah status), publish/unpublish, Trash/restore/purge, bulk |
| `product:<slug>` | `/public/products/:slug` | Produk itu, QC-nya, slug lama & baru saat slug berubah |
| `taxonomy` | `/public/categories`, `/public/materials`, `/public/nav-items` | Kategori/material/tag |
| `artisans`, `artisan:<slug>` | `/public/artisans`, `/:slug`, detail produk (ringkas artisan) | Pengrajin: simpan/arsip; juga `products` karena data ringkas artisan ada di produk |
| `articles`, `article:<slug>` | `/public/articles`, `/:slug`, sitemap | Artikel: simpan (terbit), publish/jadwal/unpublish, job publish-scheduled, Trash/restore |
| `comments:<articleSlug>` | `/public/articles/:slug/comments` (+ `commentCount` di `article:<slug>`) | Moderasi & balasan komentar |
| `page:<path>` | `/public/pages?path=` | Page & bloknya |
| `blocks:global` | `/public/blocks/global`, semua `/public/pages` | Blok global |
| `nav` | `/public/nav-items` | Nav item, status Page |
| `settings` | `/public/settings`, `/public/sitemap` | SiteSetting |
| `media` | — | Tidak dipakai langsung; perubahan `alt` memicu tag konten yang merujuknya. |

---

## 7. Dampak pertanyaan terbuka model domain (Q1–Q15)

| Q | Dampak ke kontrak | Asumsi di dokumen ini |
| --- | --- | --- |
| Q1 Draf cepat | Tidak ada endpoint khusus. | `POST /v1/admin/articles { title, content }`. Bila entitas catatan terpisah dipilih → endpoint baru `/admin/notes`. |
| Q2 Blok global | `PATCH /v1/admin/blocks/:id` dan `globalBlocks` di `AdminPage`. | Bisa diedit dari halaman mana pun, berlaku global. |
| Q3 Pemulihan Trash | Respons `/restore` dan izin `EDT+`. | Status publikasi lama dipertahankan; bila diputuskan "selalu Draft", izin restore bisa diturunkan ke CTR untuk draf miliknya. |
| Q4 Kategori artikel | `category: ArticleCategory` (enum) di query & body. | Enum. Bila jadi tabel → `categoryId` + endpoint `/admin/article-categories` (breaking untuk DTO publik → koordinasi versi shared). |
| Q5 Hapus kategori berproduk | `DELETE /admin/categories/:id` → `409 IN_USE`. | Tolak. Alternatif: query `?moveProductsTo=parent`. |
| Q6 SKU manual & duplikat | `sku` read-only di `ProductInput`; duplikat mereset QC. | Bila SKU boleh diedit: tambah `sku?` (EDT+) + `409 CONFLICT`. |
| Q7 Harga FOB publik | `fobPriceUsd`/`fobPort` **tidak** ada di `PublicProductDetail`. | Privat. Bila publik: tambah `fobPriceUsd: money\|null, fobPort` ke DTO publik (non-breaking). |
| Q8 Redirect slug | `GET /public/products/:slug` dan `/articles/:slug`. | `404`. Bila redirect dipilih: `200 { data: { redirectTo: "/produk/<slugBaru>" } }` atau `301`-setara di Next — perlu tabel slug lama. |
| Q9 Email komentar | `authorEmail` opsional di body komentar publik. | Opsional. |
| Q10 Target kirim | `targetShipment: string` di inquiry. | Teks bebas. Bila terstruktur: `targetShipMonth: "YYYY-MM"` (breaking untuk form). |
| Q11 Retensi & GDPR | Belum ada endpoint hapus data pribadi. | Usulan bila diperlukan: `POST /v1/admin/privacy/erase { email }` (ADM) menganonimkan Inquiry & Comment. |
| Q12 Retensi log | `GET /admin/activity` tanpa `total`. | Tidak berdampak ke bentuk kontrak. |
| Q13 Low Stock | `stockStatus` dikirim klien di `ProductInput`. | Manual. Bila otomatis: `stockStatus` jadi read-only turunan. |
| Q14 Kontak pengrajin | DTO publik artisan (§4). | `phone`/`address`/`contactName` privat; publik hanya `village/regency/province`. |
| Q15 Multi-kategori | `categoryId: uuid` tunggal; filter `category` tunggal. | Satu kategori. Bila multi: `categoryIds: uuid[]` (breaking). |

## 8. Pertanyaan terbuka baru (kontrak API)

| # | Pertanyaan | Usulan sementara |
| --- | --- | --- |
| A1 | Contributor boleh mengedit draf **milik orang lain**? `ROLE_CAPS` hanya menyebut "Draf saja". | Hanya draf milik sendiri (`createdById`/`authorId`). |
| A2 | Contributor boleh memoderasi komentar dan melihat halaman/Page Builder? | Komentar: tidak. Halaman: baca saja. |
| A3 | Hapus permanen hanya Administrator? | Ya (produk, artikel, halaman, media). |
| A4 | Produk wajib punya material primer (dengan `skuCode`) sejak simpan pertama agar SKU bisa dibuat (model §6.2)? Ini memberatkan draf cepat. | Wajib. Alternatif: SKU dibuat saat publish, draf memakai SKU sementara `null` (ubah `sku` menjadi nullable di model). |
| A5 | Lampiran inquiry: presigned `PUT` dari browser pengunjung ke R2 (butuh CORS bucket untuk origin situs publik) vs multipart lewat Server Action → API. | Presigned (§5.4); maks 3 berkas × 10 MB. |
| A6 | Honeypot terisi dijawab sukses palsu (`202`/`201`) atau `400`? | Sukses palsu, agar bot tidak belajar. |
| A7 | Balasan admin di komentar otomatis menyetujui komentar induk yang masih `PENDING`? | Ya. |
| A8 | Perlu endpoint daftar sesi aktif + "keluar dari semua perangkat"? | Tidak di fase ini; ganti sandi sudah mencabut sesi lain. |
| A9 | `GET /public/*` juga mewajibkan `X-Internal-Key` (menutup API dari scraping langsung)? ADR hanya mewajibkan untuk submit. | Tidak wajib; cukup rate limit. Mudah diubah tanpa mengubah bentuk kontrak. |
| A10 | Arsip pengrajin yang masih punya produk terbit: tolak, peringatkan, atau otomatis unpublish produknya? | Izinkan + `warnings` di respons; produk tetap tayang, profil publik `404`. |
| A11 | Batas `stockQuantity` untuk `LOW_STOCK`/`IN_STOCK` divalidasi (mis. `IN_STOCK` wajib `stockQuantity > 0`)? | Tidak divalidasi selain `MADE_TO_ORDER ⇒ null` (terkait Q13). |
