# Kontrak API

- **Issue:** #3 — [T0.3] Kontrak API
- **Status:** Draf untuk ditinjau; keputusan pemilik Q1–Q15 dan A1–A11 sudah diterapkan (#48, lihat §7–§8)
- **Tanggal:** 2026-09-17
- **Dasar:** [ADR-0001](adr/0001-arsitektur-backend.md) (K1–K11) dan
  [Model domain](domain-model.md) (D1–D11, §6, keputusan Q1–Q15 di §9). Nama entitas, field, dan
  enum mengikuti model domain **persis**. Bila dokumen ini berbeda dengan ADR, ADR
  yang berlaku; bila berbeda dengan model domain untuk nama/field, model domain yang
  berlaku.
- **Sumber kebenaran implementasi:** skema Zod di `packages/shared/src/<domain>.ts`
  (ADR K6). Dokumen ini adalah spesifikasi yang harus diterjemahkan ke skema tersebut.

Notasi tipe ringkas: `uuid`, `string`, `int`, `number`, `bool`, `iso` (string
ISO 8601 UTC), `money` (string desimal, mis. `"42.00"`), `T?` = boleh dihilangkan
di request, `T|null` = selalu ada di respons tetapi bisa `null`, `T[]` = array,
`date` (string `YYYY-MM-DD`), `Enum` = kode dari §4 model domain.

---

## 1. Konvensi umum

### 1.1 Base path, audiens, versi

| Prefix | Pemanggil | Auth | Catatan |
| --- | --- | --- | --- |
| `/v1/public/*` | Server Next.js situs publik (server-to-server) | GET: tanpa auth (A9; dilindungi rate limit + cache CDN). POST: header `X-Internal-Key` wajib | Hanya konten terbit. Tanpa CORS, tanpa cookie. |
| `/v1/admin/auth/*` | Browser admin (`credentials: "include"`) | Sebagian tanpa sesi (login, undangan) | CORS allowlist `ADMIN_ORIGIN`. |
| `/v1/admin/*` | Browser admin | Cookie `__Host-osa_session` wajib | CORS allowlist `ADMIN_ORIGIN`, cek `Origin` untuk non-GET. |
| `/v1/internal/*` | Cron eksternal / operator | `Authorization: Bearer <INTERNAL_JOB_TOKEN>` | Tidak masuk CORS. Lihat §5.17. |
| `/v1/health` | Load balancer (liveness) | — | `200 {"data":{"status":"ok"}}`, tanpa cek DB. |
| `/v1/health/ready` | Load balancer (readiness) | — | `200 {"data":{"status":"ok"}}` bila `SELECT 1` ke DB berhasil (timeout 2 dtk); selain itu `503 SERVICE_UNAVAILABLE`. |

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
| `X-Internal-Key` | req | `/v1/public/*` POST: wajib; salah/tidak ada → `401 INVALID_INTERNAL_KEY`. `/v1/public/*` GET: **tidak wajib** (A9); bila dikirim dan valid (server Next), batas rate limit lebih longgar dan cache CDN dilewati (§2.3). Key salah pada GET diperlakukan seperti tanpa key (bukan 401). |
| `X-Client-Ip` | req | IP pengunjung yang diteruskan Next. **Hanya dipercaya bila `X-Internal-Key` valid**; selain itu diabaikan dan IP koneksi yang dipakai. API hanya menyimpan hash-nya (`ipHash`). |
| `X-Client-User-Agent` | req | User agent pengunjung yang diteruskan Next (opsional, aturan kepercayaan sama). |
| `Idempotency-Key` | req | §1.8 |
| `X-Request-Id` | res (dan req opsional) | Selalu dikembalikan; dipakai di log pino dan di `error.requestId`. |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After` | res | Pada rute yang dibatasi; `Retry-After` hanya pada `429`. |
| `Cache-Control` | res | Semua `/v1/admin/*`: `no-store`. `/v1/public/*` GET: `public, max-age=0, s-maxage=60, stale-while-revalidate=300` agar bisa di-cache di edge Cloudflare untuk pemanggil langsung (A9). Aturan CDN **melewati cache** untuk request yang membawa `X-Internal-Key`, sehingga Next selalu mendapat data segar setelah revalidasi tag (§6). POST publik: `no-store`. |

### 1.3 Penamaan & format data

| Aspek | Aturan |
| --- | --- |
| JSON | camelCase, sama dengan model domain (`publishStatus`, `moqQuantity`). |
| Path | kebab-case, jamak (`/nav-items`, `/inquiry-uploads`). Resource publik diakses lewat `slug`; admin lewat `id` (uuid). |
| Enum | Kode stabil UPPER_SNAKE (`IN_STOCK`, `NEW`). Label tampilan dipetakan di frontend. |
| Tanggal-waktu | String ISO 8601 UTC dengan `Z` dan milidetik: `"2026-09-17T03:15:00.000Z"`. Tidak ada teks relatif. |
| Filter bulan | `YYYY-MM`, ditafsirkan pada `SiteSetting.timezone` (default `Asia/Jakarta`). |
| Tanggal tanpa waktu (`@db.Date`) | String `YYYY-MM-DD` (`targetShipDate`). |
| Uang (`Decimal(10,2)`) | String desimal `"42.00"` agar tidak kehilangan presisi (`fobPriceUsd`, `budgetPerUnitUsd`). |
| Ukuran (`Decimal(7,1)`/`(7,2)`) | `number` (`lengthCm: 45`, `weightKg: 3.2`). |
| `BigInt` (`Media.sizeBytes`) | `number` (aman < 2^53). |
| Rich text / blok | JSON sesuai skema Zod (`RichText`, `ArticleBlock[]`) dari `@ornament/shared`. |
| Nilai kosong | Field respons **selalu ada**; kosong = `null` (bukan dihilangkan). Array kosong = `[]`. |
| Request PATCH | Parsial. Field yang dikirim `null` = kosongkan. Field array (mis. `tags`, `images`, `specs`, `materials`) **mengganti seluruh isi** bila dikirim. |
| Field tak dikenal di body | Ditolak (`400 VALIDATION_FAILED`, `code: "unrecognized_keys"`). Zod `.strict()`. |
| Field turunan read-only | `stockStatus` (produk), `revision`, `wordCount`, `reference`, `subject`, `number`, `publishedAt`, `anonymizedAt`, `isGlobal`, hitungan → tidak boleh dikirim di body (strict → 400). `sku` **bukan** read-only lagi (Q6). |

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
      { "path": "materials[0].materialId", "code": "invalid_format", "message": "Harus UUID." }
    ],
    "requestId": "01J8Y9K7Q2N5..."
  }
}
```

- `code`: kode stabil (katalog §1.10); klien bercabang berdasarkan `code`, **bukan**
  `message`. `message` bahasa Indonesia, untuk ditampilkan/log.
- `details`: opsional. Untuk validasi = daftar `{ path, code, message }`; `path` pakai
  notasi titik/indeks, `code` = kode issue Zod (`too_small`, `invalid_type`,
  `invalid_format`, `invalid_value`, `unrecognized_keys`, `custom`, …; kode Zod 4) atau kode kustom (`email_domain`, `slug_taken`).
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
| 409 | `INVALID_STATE` | Aksi tidak valid untuk state sekarang. `details: { current, allowed[] }` (mis. restore yang tidak di Trash, edit balasan `SENT`, hapus permanen yang tidak di Trash, membalas inquiry yang sudah dianonimkan). |
| 409 | `IN_USE` | Hapus yang dicegah relasi `Restrict`. `details: { usages: [{ entityType, id, label }], total, counts?: Record<string,int> }` (kategori punya produk/artikel/anak, material dipakai, media dirujuk). `usages` maks 20 contoh; `counts` = jumlah per `entityType` (mis. `{ "Product": 9, "Category": 1 }`), dipakai UI untuk pesan "masih digunakan oleh 9 produk" (Q5). |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | §1.8 |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 1 MB, atau `sizeBytes` di atas batas upload. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Bukan `application/json`, atau MIME upload di luar allowlist. |
| 422 | `PUBLISH_REQUIREMENTS_NOT_MET` | Syarat publish §6.3/§6.6 model. `details: [{ path, code }]` (mis. `{ "path": "primaryImageId", "code": "required" }`, `{ "path": "sku", "code": "required" }`, `{ "path": "categoryId", "code": "required" }`). |
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
| Pencabutan | Logout (sesi ini), ganti sandi (semua sesi lain), `REVOKED` (semua sesi). Daftar sesi per perangkat ditunda (A8). |
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
| `/v1/public/*` GET dengan `X-Internal-Key` valid | IP koneksi (server Next) | 1200 / menit | Pemanggil utama: server Next. |
| `/v1/public/*` GET tanpa key | IP koneksi | 120 / menit | Pemanggil langsung (A9); sebagian besar dijawab cache CDN (§1.2). |

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
| Menerbitkan produk & artikel | Ya | Ya | Draf saja | `/publish`, `/unpublish`, jadwal, aksi massal publikasi: `EDT+`. CTR hanya membuat, mengedit, memindahkan ke Trash, dan memulihkan **draf miliknya** (`Product.createdById` / `Article.authorId` = diri sendiri, A1). CTR mengakses konten terbit/milik orang lain untuk ditulis → `403 NOT_DRAFT`/`NOT_OWNER`. |
| Mengelola pengrajin | Ya | Ya | Lihat | Tulis `EDT+`. CTR hanya GET, **DTO tanpa field 🔒** (`ArtisanRedacted`), tanpa dokumen. |
| Membalas inquiry | Ya | Ya | — | Seluruh `/admin/inquiries/*`: `EDT+`, kecuali anonimisasi (`ADM`, §3.2). |
| Mengelola pengguna | Ya | — | — | `/admin/users/*`, `/admin/invites/*`: `ADM`. |
| Mengubah settings & tema | Ya | — | — | `/admin/settings`, `/admin/nav-items`: `ADM`. |

### 3.2 Keputusan untuk area yang tidak disebut `ROLE_CAPS`

| Area | ADM | EDT | CTR | Alasan |
| --- | --- | --- | --- | --- |
| Baca produk/artikel/kategori (produk & artikel)/material/tag (admin) | ✓ | ✓ | ✓ | Contributor butuh konteks untuk menulis draf. |
| Kategori produk & artikel, material (tulis) | ✓ | ✓ | — | Taksonomi memengaruhi katalog dan journal publik. |
| QC produk (ubah status) | ✓ | ✓ | — | Status QC tampil publik. |
| Revisi produk (lihat) | ✓ | ✓ | milik sendiri | |
| Pindah ke Trash | ✓ | ✓ | draf milik sendiri | |
| Pulihkan dari Trash (produk/artikel/media) | ✓ | ✓ | milik sendiri | Q3: pemulihan selalu menjadi `DRAFT`, jadi tidak pernah menayangkan konten. Halaman: `EDT+`. |
| Hapus permanen (produk/artikel/halaman/media) | ✓ | — | — | A3: tidak bisa dibatalkan. |
| Komentar (lihat, moderasi & balas) | ✓ | ✓ | — | A2. Setara "membalas inquiry": interaksi publik atas nama brand. |
| Anonimisasi data pribadi (inquiry & komentar) | ✓ | — | — | Q11. Tidak bisa dibatalkan (sejalan dengan A3). |
| Media: upload & ubah alt `PUBLIC` | ✓ | ✓ | ✓ (ubah milik sendiri) | Dibutuhkan untuk draf. |
| Media `PRIVATE` (upload, list, URL) | ✓ | ✓ | — | Dokumen pengrajin & lampiran inquiry bersifat 🔒. |
| Halaman & blok (Page Builder) | ✓ | ✓ | baca saja | A2. Menulis mengubah konten tayang langsung (model §8: tanpa draf halaman); GET boleh untuk referensi tata letak. |
| Dashboard | ✓ | ✓ | ✓ (tanpa statistik inquiry) | |
| Activity log | ✓ | ✓ | ✓ (tanpa `kind` `INQUIRY`, `USER`, `SETTING`) | |
| Revalidasi manual | ✓ | — | — | Operasional. |

### 3.3 Kode `Permission` di `Me.permissions`

`product.write_draft`, `product.publish`, `product.trash`, `product.restore`,
`product.purge`, `product.qc`, `article.write_draft`, `article.publish`,
`article.restore`, `article.purge`, `taxonomy.write`, `artisan.read_private`,
`artisan.write`, `comment.moderate`, `inquiry.manage`, `media.upload`,
`media.private`, `media.purge`, `page.read`, `page.write`, `page.purge`,
`privacy.anonymize`, `user.manage`, `settings.manage`, `activity.read_all`,
`cache.revalidate`.

`product.restore`/`article.restore` juga dimiliki CTR, dengan pembatasan kepemilikan
yang dicek server. `taxonomy.write` mencakup kategori produk, kategori artikel, dan material.

---

## 4. Privasi DTO `/v1/public/*`

Aturan global (model D9): DTO publik ditulis eksplisit per resource (whitelist),
bukan hasil `omit` dari model. Tes kontrak wajib memastikan field di kolom kanan
**tidak pernah** muncul di respons `/v1/public/*`, termasuk di objek bersarang
(mis. `product.artisan`, `article.author`).

| Resource | Boleh di `/public` | **Tidak pernah** di `/public` |
| --- | --- | --- |
| Product | `id, slug, name, sku, excerpt, description, category, materials (name/slug/isPrimary), tags, moqQuantity, moqUnit, leadTimeDays, lengthCm, widthCm, heightCm, weightKg, fobPriceUsd, fobPort (Q7), stockStatus (efektif), stockQuantity, primaryImage, images, specs, qcChecks (stage, status, criteria), artisan (ringkas), origin, publishedAt` | 🔒 `stockNote`, 🔒 `stockStatusOverride`, 🔒 `lowStockThreshold`, `qcChecks[].notes` 🔒, `qcChecks[].checkedBy/checkedAt`, `ProductRevision` 🔒, `SlugRedirect`, `revision`, `publishStatus`, `duplicatedFromId`, `createdById/updatedById`, `deletedAt`, `updatedAt`. Produk `DRAFT`/di Trash → `404`. |
| Artisan | `id, slug, name, village, regency, province, partnerSinceYear, craftsmenCount, monthlyCapacity, capacityUnit, avgLeadTimeDays, skills, summary, story, status (ACTIVE/FULL_CAPACITY), photo, images (caption), publishedProductCount` | 🔒 `contactName`, 🔒 `phone`, 🔒 `address`, 🔒 `internalNotes`, 🔒 `ArtisanDocument` (seluruhnya, termasuk dokumen identitas), Media `PRIVATE`, `archivedAt` (Q14). Artisan `VERIFICATION`/diarsipkan → `404` di `/public/artisans/:slug`; di dalam produk tampil ringkas tanpa tautan (`slug: null`, A10, model §6.7). |
| Article | `id, slug, title, excerpt, content, category ({ slug, name }), tags, featuredImage, author: { name }, publishedAt, commentCount` | `author.email`, `authorId`, `categoryId`, `status`, `publishAt` (terjadwal yang belum jatuh tempo → `404`), `wordCount`, `deletedAt`. |
| ArticleCategory | `id, slug, name, description, position, articleCount` | — (konsisten dengan `Category`/`Material` publik, yang `id`-nya dipakai `PublicInquiryInput`). |
| Comment | `id, authorName, body, createdAt, isStaffReply, replies[]` | 🔒 `authorEmail` (termasuk turunannya, mis. hash Gravatar — Q9), 🔒 `ipHash`, 🔒 `userAgent`, `authorUserId`, `moderatedById/At`, `status`, `anonymizedAt`. Hanya `APPROVED`. |
| Inquiry | Respons submit: `{ reference }` saja | 🔒 Seluruh isi `Inquiry`, `InquiryReply`, `InquiryAttachment` — tidak ada endpoint baca publik. |
| Media | `url, alt, width, height` | `id` media internal, `key`, `fileName`, `sizeBytes`, `uploadedById`, `visibility`. Media `PRIVATE` **tidak pernah** dirujuk (validasi saat simpan menolak Media `PRIVATE` di konten publik). |
| Category / Material | `id, slug, name, parentId, description, position, depth, productCount` / `id, slug, name, productCount` | `skuCode` (internal SKU). |
| Page / PageBlock | Page `PUBLISHED`: `path, title, metaTitle, metaDescription, blocks[]` (blok `ACTIVE` + `GLOBAL`, dengan `isGlobal`) | Blok `HIDDEN`, `updatedById`, `systemKey`, `deletedAt`. |
| SlugRedirect | Hasil resolusi: `type, fromSlug, toSlug, path, statusCode` | `id`, `productId`/`articleId`. Redirect ke konten yang tidak tayang → `404`. |
| NavItem | `label, type, href, style, position` | `pageId`, `categoryId` (diganti `href` turunan). |
| SiteSetting | `siteName, tagline, contactEmail, instagramHandle, instagramUrl, siteLanguage, timezone, address, logo, icon, seoHomeTitle, seoKeywords, seoDescription, sitemapEnabled, allowIndexing` | `lowStockThreshold`, `updatedById`. |
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
| `GET /v1/public/products/:slug` | — | `200 { data: PublicProductDetail }` | `404` (draf/Trash/tidak ada). Pada 404, Next memeriksa `GET /v1/public/redirects` (§5.5). |
| `GET /v1/public/categories` | `withEmpty?: bool` (default false) | `200 { data: PublicCategory[] }` datar, urut pohon (`position`), `productCount` = produk terbit di kategori + turunannya | — |
| `GET /v1/public/materials` | `withEmpty?: bool` | `200 { data: PublicMaterial[] }` urut `name` | — |

```ts
PublicProductCard = { id; slug; name; sku: string|null; excerpt: string|null; primaryImage: PublicMedia|null;
  category: { slug; name }; primaryMaterial: { slug; name } | null; origin: string|null; // "Bangunjiwo, Bantul"
  stockStatus: StockStatus; moqQuantity: int; moqUnit: string; publishedAt: iso }

PublicProductDetail = PublicProductCard & {
  description: RichText|null; images: PublicMedia[]; tags: { slug; name }[];
  materials: { slug; name; isPrimary: bool }[];
  dimensions: { lengthCm: number|null; widthCm: number|null; heightCm: number|null };
  weightKg: number|null; leadTimeDays: int|null; stockQuantity: int|null;
  fobPriceUsd: money|null; fobPort: string|null;    // Q7: null → UI menampilkan "Inquire for pricing"
  specs: { label; value }[];                        // baris ProductSpec, urut position
  qcChecks: { stage: QcStage; status: QcStatus; criteria: string|null }[]; // selalu 4, urut MATERIAL→PACKAGING
  artisan: { slug: string|null; name; village: string|null; regency; province;
             skills: string[]; photo: PublicMedia|null } | null;   // slug null bila profil tidak publik (VERIFICATION/diarsipkan, A10) → UI tanpa tautan
  related: PublicProductCard[] }                    // maks 4: kategori sama, terbit, bukan dirinya, -publishedAt
```

`productCount` di kategori/material adalah hitungan total terbit, **tidak** bergantung
pada filter lain yang sedang aktif (sama dengan perilaku `CatalogBrowser` sekarang).

`PublicProductCard` sengaja tidak memuat harga; harga FOB hanya di detail produk.
`sku` produk terbit selalu terisi (syarat publish).

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
| `GET /v1/public/artisans` | `regency?`, `limit?`, `cursor?` | `200 { data: PublicArtisanCard[], meta: CursorMeta(total) }` hanya `ACTIVE`/`FULL_CAPACITY`, tidak diarsipkan | — |
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
| `GET /v1/public/article-categories` | `withEmpty?: bool` (default false) | `200 { data: PublicArticleCategory[] }` urut `position`, `articleCount` = artikel terbit | — |
| `GET /v1/public/articles` | `category?: slug` (`ArticleCategory.slug`; tak dikenal → `data: []`), `tag?: slug`, `limit?`, `cursor?` | `200 { data: PublicArticleCard[], meta: CursorMeta(total) }`; terbit = `PUBLISHED` atau `SCHEDULED && publishAt <= now()` (ADR K8), sort `-publishedAt` (untuk terjadwal: `publishAt`) | `400 INVALID_CURSOR` |
| `GET /v1/public/articles/:slug` | — | `200 { data: PublicArticleDetail }` | `404`. Pada 404, Next memeriksa `GET /v1/public/redirects` (§5.5). |
| `GET /v1/public/articles/:slug/comments` | `limit?` (default 20), `cursor?` | `200 { data: PublicComment[], meta: CursorMeta(total) }`, komentar akar `APPROVED` urut `createdAt` naik, balasan bersarang 1 tingkat. `meta.total` = jumlah komentar **akar** yang cocok filter (semantik pagination §1.6); angka "Diskusi (n)" di UI memakai `PublicArticleCard.commentCount`, yang menghitung balasan juga (§6.8) | `404` (artikel tidak terbit) |
| `POST /v1/public/articles/:slug/comments` | Header `X-Internal-Key`, `Idempotency-Key`. Body `{ authorName: string(1–80), authorEmail: email (wajib, Q9), body: string(1–2000), website?: string }` (`website` = honeypot, harus kosong) | `202 { data: { status: "PENDING" } }` | `400 VALIDATION_FAILED` (mis. `authorEmail` kosong), `404` (artikel tidak terbit), `401 INVALID_INTERNAL_KEY`, `429`. Honeypot terisi → **`202` palsu** tanpa menyimpan (A6). |

```ts
PublicArticleCategory = { id; slug; name; description: string|null; position: int; articleCount: int }
// `id` disertakan agar konsisten dengan §4 dan dengan PublicCategory/PublicMaterial.
PublicArticleCard   = { id; slug; title; excerpt: string; category: { slug; name };   // selalu terisi untuk artikel terbit
                        featuredImage: PublicMedia|null; author: { name }; publishedAt: iso; commentCount: int }
PublicArticleDetail = PublicArticleCard & { content: PublicArticleBlock[]; tags: { slug; name }[] }
// PublicArticleBlock = ArticleBlock, tetapi blok image: { id; type: "image"; image: PublicMedia; caption? } (mediaId di-resolve)
PublicComment       = { id; authorName; body; createdAt: iso; isStaffReply: bool; replies: Omit<PublicComment,"replies">[] }
```

Avatar komentar dirender dari inisial `authorName` di frontend; tidak ada URL avatar
maupun hash email di DTO (Q9: tanpa Gravatar).

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

Alur lampiran (A5: presigned `PUT` ke R2, maks 3 berkas × 10 MB per inquiry; browser
pengunjung tidak memanggil API; berkas tidak melewati dua server):

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
| `POST /v1/public/inquiries` | Header `X-Internal-Key`, `Idempotency-Key`. Body di bawah | `201 { data: { reference: string } }` | `400 VALIDATION_FAILED`, `422 UPLOAD_INVALID` (`details.uploadId`), `429`. Honeypot terisi → `201` palsu dengan `reference` acak yang tidak tersimpan (A6). |

```ts
PublicInquiryInput = {
  name: string(1–120); company?: string(≤120)|null; email: email;
  country?: string(≤80)|null;
  categoryId?: uuid|null;          // null = "Belum menentukan"; tak dikenal → 400 (details.code "not_found")
  materialId?: uuid|null;          // null = "Terbuka untuk saran"
  volumeQuantity: int (1–1 000 000);
  targetShipText?: string(≤80)|null;   // teks bebas (Q10); server menurunkan targetShipDate bila terbaca (model §6.5)
  destinationPort?: string(≤80)|null;
  budgetPerUnitUsd?: money|null;
  message?: string(≤5000)|null;
  attachmentUploadIds?: string[] (≤3, unik);
  website?: string                  // honeypot
}
```

Server mengisi `number`, `reference`, `subject`, `categoryLabel`, `materialLabel`,
`targetShipDate`, `status = NEW`, `ipHash`, `userAgent`; menulis `ActivityLog` (`actorId = null`); lalu
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
  "volumeQuantity": 400, "targetShipText": "Nov 2026", "destinationPort": "Göteborg",
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
      { "path": "email", "code": "invalid_format", "message": "Email tidak valid." },
      { "path": "volumeQuantity", "code": "too_small", "message": "Volume minimal 1 pcs." }
    ],
    "requestId": "01J8Z3N4…"
  }
}
```

### 5.5 Publik — situs: settings, menu, halaman & blok, sitemap, redirect

| Method & path | Query | Respons | Error |
| --- | --- | --- | --- |
| `GET /v1/public/settings` | — | `200 { data: PublicSiteSetting }` (field §4; `logo`/`icon`: `PublicMedia\|null`) | `404 NOT_FOUND` bila baris singleton `SiteSetting` belum ada (API tidak mengarang nilai default) |
| `GET /v1/public/nav-items` | — | `200 { data: { label; type: NavItemType; href: string; style: NavItemStyle; position: int }[] }`. `href` diturunkan: `PAGE` → `Page.path`, `CATEGORY` → `/catalog?category=<slug>`, `ARTICLE_ARCHIVE` → `/journal`, `CUSTOM_LINK` → `url`. Item yang menunjuk Page tidak terbit tidak dikirim. | — |
| `GET /v1/public/pages` | `path: string` (wajib, mis. `/our-story`) | `200 { data: PublicPage }` | `404` (tidak ada / `DRAFT` / Trash) |
| `GET /v1/public/blocks/global` | — | `200 { data: PublicBlock[] }` (untuk layout yang tidak punya Page, mis. `/produk/[slug]`) | — |
| `GET /v1/public/sitemap` | — | `200 { data: { enabled: bool; entries: { path: string; updatedAt: iso }[] } }` (halaman, produk, artikel, pengrajin publik; tanpa slug lama). `entries` selalu dikirim walau `sitemapEnabled = false` — isinya memang konten publik; `enabled` yang menentukan apakah Next menyajikan `/sitemap.xml` | — |
| `GET /v1/public/redirects` | `type: SlugRedirectType` (wajib), `slug: string` (wajib, slug lama) | `200 { data: PublicRedirect }` | `404` (tidak ada redirect, atau konten tujuan tidak tayang). Q8, model §6.10. |

Tidak ada endpoint `robots`: kebijakan indeks mesin pencari dibaca dari `allowIndexing` pada `GET /v1/public/settings`, dan `robots.txt` disusun oleh situs Next.

```ts
PublicPage  = { path; title; metaTitle: string|null; metaDescription: string|null;
                blocks: PublicBlock[] }  // blok ACTIVE halaman ini urut position, lalu blok GLOBAL urut position
PublicBlock = { id: uuid; type: BlockType; layout: BlockLayout; isGlobal: bool; title: string|null; body: string|null;
                cta1: { label: string; url: string } | null; cta2: { label: string; url: string } | null;
                image: PublicMedia|null; config: Record<string, unknown>|null }
```

```ts
PublicRedirect = { type: SlugRedirectType; fromSlug: string; toSlug: string;
                   path: string;          // "/produk/<toSlug>" atau "/journal/<toSlug>"
                   statusCode: 301 }
```

Alur redirect (Q8): halaman `/produk/[slug]` atau `/journal/[slug]` mendapat `404` dari
API → memanggil `GET /v1/public/redirects?type=PRODUCT&slug=<slug>` → bila `200`, Next
memanggil `permanentRedirect(data.path)` (HTTP 301); bila `404`, `notFound()`.
Contoh: `GET /v1/public/redirects?type=PRODUCT&slug=kursi-rotan-lama` →
`{ "data": { "type": "PRODUCT", "fromSlug": "kursi-rotan-lama", "toSlug": "kursi-lounge-rotan-bangunjiwo", "path": "/produk/kursi-lounge-rotan-bangunjiwo", "statusCode": 301 } }`.

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
| `POST /v1/admin/products` | CTR+ | `ProductInput` | `201 { data: AdminProduct }` (`publishStatus = DRAFT`, `revision = 1`, `sku` sesuai input atau `null`, `stockStatus` dihitung, 4 `qcChecks` `PENDING`) | `409 CONFLICT` (`slug`, `sku`), `403 FORBIDDEN_FIELD` (CTR kirim `slug`), `422 BUSINESS_RULE_VIOLATION` (`PRIVATE_MEDIA_NOT_ALLOWED`) |
| `POST /v1/admin/products/sku-suggestions` | CTR+ | `{ materialId?: uuid\|null }` (material primer yang sedang dipilih di form) | `200 { data: { sku: string } }` — `ORN-<skuCode>-<NNNN>`, atau `ORN-<YYMM>-<NNNN>` bila material kosong/tanpa `skuCode` (model §6.2). Tidak menyimpan apa pun; `POST` karena mengambil nomor sequence. | `404` (`materialId` tak dikenal) |
| `GET /v1/admin/products/:id` | CTR+ | — (termasuk yang di Trash) | `200 { data: AdminProduct }` | `404` |
| `PATCH /v1/admin/products/:id` | CTR* (draf milik sendiri) | `Partial<ProductInput> & { expectedRevision: int }` | `200 { data: AdminProduct }` (`revision + 1` bila isi berubah; tanpa perubahan → revisi tetap; `stockStatus` dihitung ulang; slug berubah → `SlugRedirect` dibuat, model §6.10) | `409 EDIT_CONFLICT`, `409 CONFLICT` (`slug`, `sku`), `409 INVALID_STATE` (di Trash), `403 NOT_DRAFT/NOT_OWNER`, `403 FORBIDDEN_FIELD`, `400` (`stockQuantity` tidak null saat status efektif `MADE_TO_ORDER`), `422 PUBLISH_REQUIREMENTS_NOT_MET` (bila produk `PUBLISHED` dan perubahan melanggar syarat, mis. `primaryImageId: null`, `sku: null`) |
| `POST /v1/admin/products/:id/publish` | EDT+ | `{ expectedRevision?: int }` | `200 { data: AdminProduct }` (`publishedAt` diisi bila kosong) | `422 PUBLISH_REQUIREMENTS_NOT_MET` (termasuk `sku` kosong, A4), `409 INVALID_STATE` (di Trash) |
| `POST /v1/admin/products/:id/unpublish` | EDT+ | — | `200 { data: AdminProduct }` (`DRAFT`) | `409 INVALID_STATE` |
| `POST /v1/admin/products/:id/duplicate` | CTR+ | — | `201 { data: AdminProduct }` (aturan §6.3 model: `DRAFT`, `sku = null`, QC direset `PENDING`) | `404` |
| `POST /v1/admin/products/bulk` | CTR* | `{ action: "PUBLISH"\|"UNPUBLISH"\|"TRASH"\|"RESTORE"\|"PURGE"\|"SET_STOCK_OVERRIDE", ids: uuid[] (1–100), stockStatusOverride?: StockStatus\|null }` | `200 { data: BulkResult }` | `400` (`stockStatusOverride` wajib ada untuk `SET_STOCK_OVERRIDE`; `null` = kembali otomatis). Per item: kode seperti endpoint tunggal (`FORBIDDEN`, `PUBLISH_REQUIREMENTS_NOT_MET`, `INVALID_STATE`, `IN_USE`; `VALIDATION_FAILED` bila override `MADE_TO_ORDER` pada produk dengan `stockQuantity`). |
| `DELETE /v1/admin/products/:id` | CTR* (draf milik sendiri) | — | `200 { data: { id, deletedAt } }` (Trash) | `409 INVALID_STATE` (sudah di Trash) |
| `POST /v1/admin/products/:id/restore` | CTR* (milik sendiri) | — | `200 { data: AdminProduct }` (**selalu** `publishStatus = DRAFT`, Q3) | `409 INVALID_STATE` (tidak di Trash), `403 NOT_OWNER` |
| `DELETE /v1/admin/products/:id/permanent` | ADM | — | `204` | `409 INVALID_STATE` (belum di Trash) |
| `PATCH /v1/admin/products/:id/qc/:stage` | EDT+ | `:stage` = `QcStage`. `{ status?: QcStatus, criteria?: string\|null, notes?: string\|null }` | `200 { data: AdminQcCheck }` (`checkedById/At` diisi saat `status` berubah). Tidak menaikkan `revision`; menulis `ActivityLog kind QC`. | `404` |
| `GET /v1/admin/products/:id/revisions` | CTR* | — | `200 { data: { number, editedBy: UserRef\|null, createdAt }[] }` urut `-number` | `403 NOT_OWNER` |
| `GET /v1/admin/products/:id/revisions/:number` | CTR* | — | `200 { data: { number, editedBy, createdAt, snapshot: AdminProductSnapshot } }` | `404` |

```ts
ProductInput = {
  name: string(1–160); slug?: string (EDT+; regex ^[a-z0-9]+(-[a-z0-9]+)*$, ≤80);
  sku?: string(≤32; dinormalisasi huruf besar; ^[A-Z0-9]+(-[A-Z0-9]+)*$)|null;   // Q6/A4: null boleh saat draf
  description?: RichText|null; excerpt?: string(≤300)|null;
  categoryId: uuid; artisanId?: uuid|null;
  materials?: { materialId: uuid; isPrimary: bool }[];  // ≤20; bila tidak kosong maks satu isPrimary; tepat satu wajib saat publish
  tags?: string[] (≤20; dinormalisasi & dibuat bila belum ada);
  moqQuantity: int ≥1; moqUnit: string(1–16);          // UI: pcs | set | panel
  leadTimeDays?: int|null; lengthCm?/widthCm?/heightCm?: number|null; weightKg?: number|null;
  fobPriceUsd?: money|null; fobPort?: string|null;     // publik (Q7)
  stockQuantity?: int ≥0 | null;                       // null = MADE_TO_ORDER bila tanpa override (Q13)
  stockStatusOverride?: StockStatus|null;              // null = otomatis; MADE_TO_ORDER ⇒ stockQuantity wajib null → 400 (A11)
  lowStockThreshold?: int ≥0 | null;                   // null = SiteSetting.lowStockThreshold
  stockNote?: string(≤500)|null;
  primaryImageId?: uuid|null; images?: uuid[] (≤20, urutan = position, tidak boleh memuat primaryImageId);
  specs?: { label: string(1–60); value: string(1–200) }[] (≤30, urutan = position)
}

AdminProductRow = { id; name; slug; sku: string|null; primaryImage: MediaRef|null; category: { id; name };
  primaryMaterial: { id; name }|null; artisan: { id; name; regency }|null;
  publishStatus; stockStatus; stockQuantity: int|null; moqUnit; leadTimeDays: int|null;
  revision: int; updatedAt: iso; deletedAt: iso|null }

AdminProduct = Omit<ProductInput,"materials"|"images"|"primaryImageId"|"slug"|"sku"> & {
  id; slug; sku: string|null; publishStatus; publishedAt: iso|null; revision: int;
  stockStatus: StockStatus;                 // efektif (turunan)
  effectiveLowStockThreshold: int;          // lowStockThreshold ?? SiteSetting.lowStockThreshold
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

{ "expectedRevision": 6, "stockQuantity": 12 }
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
    "failed": [{ "id": "7c21…", "code": "PUBLISH_REQUIREMENTS_NOT_MET", "message": "SKU, foto utama, dan pengrajin belum diisi." }]
  }
}
```

Contoh — minta saran SKU untuk draf yang material primernya rotan:

```http
POST /v1/admin/products/sku-suggestions
{ "materialId": "e41a…" }
```

```json
{ "data": { "sku": "ORN-RTN-0143" } }
```

### 5.7 Admin — kategori (produk & artikel), material, tag

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/categories` | CTR+ | `type?: CategoryType` (default `PRODUCT`), `q?` | `200 { data: AdminCategory[] }` datar urut pohon, atau `AdminArticleCategory[]` urut `position` untuk `ARTICLE` (tanpa paginasi) | — |
| `POST /v1/admin/categories` | EDT+ | `type?` (query, default `PRODUCT`). Body `{ name: string(1–80), slug?: string, parentId?: uuid\|null (hanya PRODUCT), description?: string\|null, position?: int }` | `201 { data: AdminCategory \| AdminArticleCategory }` | `409 CONFLICT` (`name` untuk ARTICLE, `slug`), `400` (`parentId` pada `ARTICLE`), `422 BUSINESS_RULE_VIOLATION` (`PARENT_NOT_FOUND`) |
| `PATCH /v1/admin/categories/:id` | EDT+ | `type?` (query) + parsial dari body di atas | `200 { data: AdminCategory \| AdminArticleCategory }` | `404` (id tidak ada pada tipe itu), `409 CONFLICT`, `422` (`CATEGORY_CYCLE` bila parent = diri/turunannya) |
| `PUT /v1/admin/categories/order` | EDT+ | `type?` (query). `{ items: { id: uuid; parentId: uuid\|null; position: int }[] }` (seluruh pohon; `ARTICLE`: `parentId` selalu `null`) | `200 { data: AdminCategory[] \| AdminArticleCategory[] }` | `422` (`CATEGORY_CYCLE`, `CATEGORY_SET_MISMATCH`) |
| `DELETE /v1/admin/categories/:id` | EDT+ | `type?` (query) | `204` | `409 IN_USE` (Q5): `PRODUCT` → anak dan/atau produk termasuk Trash; `ARTICLE` → artikel termasuk Trash. `details.counts` memuat jumlahnya. |
| `GET /v1/admin/materials` | CTR+ | `q?` | `200 { data: AdminMaterial[] }` urut `name` | — |
| `POST /v1/admin/materials` | EDT+ | `{ name: string(1–80), slug?: string, skuCode?: string(3, ^[A-Z]{3}$)\|null }` | `201 { data: AdminMaterial }` | `409 CONFLICT` (`name`/`slug`/`skuCode`) |
| `PATCH /v1/admin/materials/:id` | EDT+ | parsial | `200 { data: AdminMaterial }` | `409 CONFLICT`. Mengubah `skuCode` tidak mengubah SKU produk lama (§6.2). |
| `DELETE /v1/admin/materials/:id` | EDT+ | — | `204` | `409 IN_USE` |
| `GET /v1/admin/tags` | CTR+ | `q?` (prefix), `limit?` (≤20) | `200 { data: { id; name; slug; usageCount: int }[] }` (autocomplete) | — |
| `DELETE /v1/admin/tags/:id` | EDT+ | — | `204` (lepas dari konten, Cascade) | — |

```ts
CategoryType  = "PRODUCT" | "ARTICLE"   // hanya di API: memilih tabel Category atau ArticleCategory (Q4)
AdminCategory = { id; type: "PRODUCT"; name; slug; parentId: uuid|null; description: string|null; position: int;
                  depth: int; productCount: int /* semua publishStatus, di luar Trash, termasuk turunan */;
                  createdAt: iso; updatedAt: iso }
AdminArticleCategory = { id; type: "ARTICLE"; name; slug; description: string|null; position: int;
                  articleCount: int /* semua status, di luar Trash */; createdAt: iso; updatedAt: iso }
AdminMaterial = { id; name; slug; skuCode: string|null; productCount: int; createdAt: iso; updatedAt: iso }
```

Layar `/admin/taxonomy` menampilkan kedua tipe sebagai tab **Produk / Artikel** dan
memanggil endpoint yang sama dengan `type` berbeda; tidak ada modul admin baru.

Contoh:

```http
DELETE /v1/admin/categories/b0c7a2d4-…
```

```json
{
  "error": {
    "code": "IN_USE",
    "message": "Kategori tidak dapat dihapus karena masih digunakan oleh 8 produk dan 1 subkategori. Pindahkan terlebih dahulu.",
    "details": { "total": 9, "counts": { "Product": 8, "Category": 1 }, "usages": [
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
| `POST /v1/admin/artisans/:id/archive` | EDT+ | — | `200 { data: AdminArtisan & { warnings: { code: "HAS_PUBLISHED_PRODUCTS"; count: int }[] } }` | `409 INVALID_STATE`. Tidak ditolak walau ada produk terbit (A10): `warnings` berisi jumlahnya, produk tetap tayang, profil publik `404`, dan ringkas pengrajin di produk publik menjadi `slug: null` (tanpa tautan). `warnings: []` bila tidak ada. |
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
| `GET /v1/admin/articles` | CTR+ | `status?`, `categoryId?`, `authorId?`, `trashed?`, `q?` (title), `sort?` `-updatedAt`(default)\|`-publishedAt`\|`title`, `page?`, `pageSize?` | `200 { data: AdminArticleRow[], meta: PageMeta }`, `counts: { all, DRAFT, SCHEDULED, PUBLISHED, trash }` | — |
| `POST /v1/admin/articles` | CTR+ | `ArticleInput` (minimal `{ title }`; `content` default `[]`, `categoryId` default `null`) — juga dipakai "Draf cepat" dashboard (Q1) | `201 { data: AdminArticle }` (`DRAFT`, `authorId` = diri sendiri). UI draf cepat menautkan ke `/admin/articles/<data.id>`. | `409 CONFLICT`, `403 FORBIDDEN_FIELD` (CTR kirim `authorId`/`slug`), `422` (`MEDIA_NOT_FOUND`, `PRIVATE_MEDIA_NOT_ALLOWED`, `CATEGORY_NOT_FOUND`) |
| `GET /v1/admin/articles/:id` | CTR+ | — | `200 { data: AdminArticle }` | `404` |
| `PATCH /v1/admin/articles/:id` | CTR* (draf milik sendiri) | `Partial<ArticleInput> & { expectedUpdatedAt: iso }` | `200 { data: AdminArticle }` (`wordCount` dihitung ulang; slug berubah → `SlugRedirect` dibuat, model §6.10) | `409 EDIT_CONFLICT`, `403 NOT_DRAFT/NOT_OWNER`, `409 INVALID_STATE` (Trash), `422 PUBLISH_REQUIREMENTS_NOT_MET` (artikel terbit/terjadwal dan `categoryId: null`) |
| `POST /v1/admin/articles/:id/publish` | EDT+ | `{ publishAt?: iso\|null }` — kosong/`null` = terbit sekarang (`PUBLISHED`); masa depan = `SCHEDULED` | `200 { data: AdminArticle }` | `422 BUSINESS_RULE_VIOLATION` (`PUBLISH_AT_IN_PAST`), `422 PUBLISH_REQUIREMENTS_NOT_MET` (`title`, `categoryId`, `content` tidak kosong, alt pada gambar) |
| `POST /v1/admin/articles/:id/unpublish` | EDT+ | — | `200 { data: AdminArticle }` (`DRAFT`, `publishAt = null`; `publishedAt` dipertahankan) | `409 INVALID_STATE` |
| `POST /v1/admin/articles/:id/preview` | CTR* | Body opsional `Partial<ArticleInput>` (isi editor yang belum disimpan) | `200 { data: PublicArticleDetail }` — hasil transformasi DTO publik **tanpa menyimpan**; `publishedAt` = sekarang bila belum terbit, `commentCount` = 0 | `403 NOT_OWNER` |
| `POST /v1/admin/articles/bulk` | CTR* | `{ action: "PUBLISH"\|"UNPUBLISH"\|"TRASH"\|"RESTORE"\|"PURGE", ids }` | `200 { data: BulkResult }` | per item |
| `DELETE /v1/admin/articles/:id` | CTR* (draf milik sendiri) | — | `200 { data: { id, deletedAt } }` | `409 INVALID_STATE` |
| `POST /v1/admin/articles/:id/restore` | CTR* (milik sendiri) | — | `200 { data: AdminArticle }` (**selalu** `status = DRAFT`, `publishAt = null`, Q3) | `409 INVALID_STATE`, `403 NOT_OWNER` |
| `DELETE /v1/admin/articles/:id/permanent` | ADM | — | `204` (komentar ikut terhapus) | `409 INVALID_STATE` |

Pratinjau memakai `POST` + body agar tidak ada token pratinjau yang bisa bocor dan
Contributor bisa melihat hasil sebelum menyimpan; admin merender DTO ini dengan
komponen situs publik.

```ts
ArticleInput = { title: string(1–200); slug?: string (EDT+); excerpt?: string(≤300)|null;
  content?: ArticleBlock[] (≤200 blok; id blok unik); categoryId?: uuid|null (ArticleCategory; wajib saat publish);
  tags?: string[] (≤20); featuredImageId?: uuid|null; authorId?: uuid (EDT+) }
AdminArticleRow = { id; title; slug; category: { id; name; slug }|null; status: ArticleStatus; author: UserRef; publishAt: iso|null;
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
  "category": { "id": "ac2…", "name": "Process", "slug": "process" }, "status": "SCHEDULED", "author": { "id": "8a…", "name": "Rani" },
  "publishAt": "2026-09-20T01:00:00.000Z", "publishedAt": null, "commentCount": 0, "pendingCommentCount": 0,
  "updatedAt": "2026-09-17T04:00:00.000Z", "deletedAt": null, "excerpt": null,
  "content": [{ "id": "b1", "type": "paragraph", "text": [{ "text": "Rotan dipanen…" }] }],
  "tags": [{ "id": "t1", "name": "bantul", "slug": "bantul" }], "featuredImage": null,
  "wordCount": 612, "blockCount": 4, "createdAt": "2026-09-15T02:00:00.000Z" } }
```

### 5.10 Admin — komentar

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/comments` | EDT+ (CTR tanpa akses, A2) | `status?` (default `PENDING`), `articleId?`, `q?` (authorName, body), `sort?` `-createdAt`(default)\|`createdAt`, `page?`, `pageSize?` | `200 { data: AdminComment[], meta: PageMeta }`, `counts` per `CommentStatus` | — |
| `PATCH /v1/admin/comments/:id` | EDT+ | `{ status: "APPROVED"\|"SPAM"\|"DELETED"\|"PENDING" }` | `200 { data: AdminComment }` (`moderatedById/At` diisi) | `409 INVALID_STATE` (mis. `DELETED` → apa pun: tidak bisa dipulihkan dari UI) |
| `POST /v1/admin/comments/:id/replies` | EDT+ | `{ body: string(1–2000) }` | `201 { data: AdminComment }` (`authorUserId` = diri, `authorName` = `User.name`, `APPROVED`; komentar induk otomatis `APPROVED` bila masih `PENDING`, A7) | `422` (`REPLY_DEPTH_EXCEEDED` bila induk sudah balasan, `ARTICLE_NOT_PUBLISHED`) |
| `POST /v1/admin/comments/:id/anonymize` | ADM | `{ sameEmail?: bool }` (default `false`; `true` = juga semua komentar dan inquiry dengan `authorEmail`/`email` yang sama) | `200 { data: { comment: AdminComment; affected: { comments: int; inquiries: int } } }` (aturan model §6.11; idempoten) | `409 INVALID_STATE` (balasan admin, bukan data pengunjung) |
| `POST /v1/admin/comments/bulk` | EDT+ (`ANONYMIZE`: ADM) | `{ action: "APPROVE"\|"SPAM"\|"DELETE"\|"ANONYMIZE", ids }` | `200 { data: BulkResult }` | per item |

```ts
AdminComment = { id; article: { id; title; slug }; parentId: uuid|null; authorName;
  authorEmail: string|null /* null = balasan admin atau sudah dianonimkan */;
  isStaffReply: bool; author: UserRef|null; body; status: CommentStatus; moderatedBy: UserRef|null;
  moderatedAt: iso|null; anonymizedAt: iso|null; createdAt: iso }   // ipHash & userAgent tidak dikirim bahkan ke admin
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
  "moderatedAt": "2026-09-17T05:02:00.000Z", "anonymizedAt": null, "createdAt": "2026-09-17T04:40:00.000Z" } }
```

### 5.11 Admin — inquiry

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/inquiries` | EDT+ | `status?`, `q?` (reference, name, company, email, subject), `sort?` `-createdAt`(default), `page?`, `pageSize?` | `200 { data: AdminInquiryRow[], meta: PageMeta }`, `counts: { all, NEW, IN_PROGRESS, DONE, unread }` | — |
| `GET /v1/admin/inquiries/:id` | EDT+ | — (GET tidak mengubah `readAt`) | `200 { data: AdminInquiry }` | `404` |
| `PATCH /v1/admin/inquiries/:id` | EDT+ | `{ read?: bool, status?: InquiryStatus, targetShipDate?: date\|null }` (`targetShipDate` = koreksi manual tanggal turunan, Q10) | `200 { data: AdminInquiry }` | `409 INVALID_STATE` (transisi §6.5 model: `DONE → NEW` ditolak; `DONE → IN_PROGRESS` hanya lewat balasan baru) |
| `POST /v1/admin/inquiries/:id/anonymize` | ADM | `{ sameEmail?: bool }` (default `false`; `true` = juga semua inquiry dan komentar dengan email yang sama) | `200 { data: { inquiry: AdminInquiry; affected: { inquiries: int; comments: int } } }` (aturan model §6.11: data pribadi dikosongkan, lampiran dihapus, balasan dikosongkan; idempoten) | `404` |
| `POST /v1/admin/inquiries/:id/replies` | EDT+ | `{ subject?: string(1–200), body: string(1–20000), attachmentMediaIds?: uuid[] (≤5, Media PRIVATE) }` | `201 { data: InquiryReplyDto }` (`DRAFT`, `toEmail` dari inquiry) | `422` (`MEDIA_NOT_PRIVATE`), `409 INVALID_STATE` (inquiry sudah dianonimkan) |
| `PATCH /v1/admin/inquiries/:id/replies/:replyId` | EDT+ | sama, parsial | `200 { data: InquiryReplyDto }` | `409 INVALID_STATE` (`SENT` tidak bisa diedit) |
| `DELETE /v1/admin/inquiries/:id/replies/:replyId` | EDT+ | — | `204` | `409 INVALID_STATE` (hanya `DRAFT`) |
| `POST /v1/admin/inquiries/:id/replies/:replyId/send` | EDT+ | — (`Idempotency-Key` disarankan) | `200 { data: { reply: InquiryReplyDto, inquiry: AdminInquiryRow } }`. Resend gagal → **tetap `200`** dengan `reply.status = "FAILED"` dan `reply.emailError`; bisa dikirim ulang. Sukses → `SENT`; inquiry `NEW`/`DONE` → `IN_PROGRESS`. | `409 INVALID_STATE` (sudah `SENT`, atau inquiry sudah dianonimkan) |

Lampiran dibuka lewat `GET /v1/admin/media/:mediaId/url` (§5.12).

```ts
AdminInquiryRow = { id; number: int; reference; subject; name; company: string|null; email: string|null /* null bila dianonimkan */;
  country: string|null; volumeQuantity: int; status: InquiryStatus; readAt: iso|null; preview: string /* ±120 karakter message; "" bila dianonimkan */;
  attachmentCount: int; replyCount: int; anonymizedAt: iso|null; createdAt: iso }
AdminInquiry    = AdminInquiryRow & { category: { id; name }|null; categoryLabel: string|null;
  material: { id; name }|null; materialLabel: string|null; targetShipText: string|null; targetShipDate: date|null;
  destinationPort: string|null;
  budgetPerUnitUsd: money|null; message: string|null; completedAt: iso|null;
  notificationError: string|null;
  attachments: InquiryAttachmentDto[];   // replyId null (dari pembeli)
  replies: InquiryReplyDto[] }           // urut createdAt
InquiryReplyDto = { id; author: UserRef; toEmail: string|null; subject; body: string|null /* null bila dianonimkan */; status: ReplyStatus; sentAt: iso|null;
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
| `POST /v1/admin/media/:id/restore` | CTR* (milik sendiri) | — | `200 { data: AdminMedia }` (hanya `deletedAt = null`; Media tidak punya status terbit, Q3) | `409 INVALID_STATE`, `403 NOT_OWNER` |
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
status. Perubahan langsung tayang (tanpa draf halaman, model §8). Contributor hanya
boleh `GET` (A2).

| Method & path | Izin | Query / body | Respons | Error khusus |
| --- | --- | --- | --- | --- |
| `GET /v1/admin/pages` | CTR+ | `status?`, `trashed?`, `q?` (title, path), `page?`, `pageSize?` | `200 { data: AdminPageRow[], meta: PageMeta }` | — |
| `GET /v1/admin/pages/:id` | CTR+ | — | `200 { data: AdminPage }` (blok halaman + blok global) | `404` |
| `PATCH /v1/admin/pages/:id` | EDT+ | `{ expectedUpdatedAt: iso; title?; path?; status?: PublishStatus; metaTitle?: string\|null; metaDescription?: string(≤160)\|null }` | `200 { data: AdminPage }` | `409 EDIT_CONFLICT`, `409 CONFLICT` (`path`), `422` (`SYSTEM_PAGE_PROTECTED` bila ubah `path` halaman `systemKey`) |
| `PUT /v1/admin/pages/:id/blocks` | EDT+ | `{ expectedUpdatedAt: iso; blocks: PageBlockInput[] }` — **seluruh** blok milik halaman, urutan array = `position` | `200 { data: AdminPage }` (atomik; `Page.updatedAt` disentuh) | `409 EDIT_CONFLICT`, `422` (`BLOCK_SET_MISMATCH`: id tidak persis sama dengan blok yang ada; `BLOCK_VISIBILITY_INVALID`: blok halaman hanya `ACTIVE`/`HIDDEN`; `CTA_URL_INVALID`; `PRIVATE_MEDIA_NOT_ALLOWED`) |
| `PATCH /v1/admin/blocks/:id` | EDT+ | `Partial<Omit<PageBlockInput,"id">> & { expectedUpdatedAt: iso }` — satu blok (termasuk global; perubahan blok global berlaku di **semua** halaman, Q2) | `200 { data: AdminBlock }` | sama seperti di atas |
| `POST /v1/admin/pages/:id/preview` | EDT+ | Body opsional `{ blocks?: PageBlockInput[]; title?; metaTitle?; metaDescription? }` | `200 { data: PublicPage }` tanpa menyimpan (blok `HIDDEN` disaring seperti publik) | `422` seperti di atas |
| `DELETE /v1/admin/pages/:id` | EDT+ | — | `200 { data: { id, deletedAt } }` | `422` (`SYSTEM_PAGE_PROTECTED`) |
| `POST /v1/admin/pages/:id/restore` | EDT+ | — | `200 { data: AdminPage }` (**selalu** `status = DRAFT`, Q3) | `409 INVALID_STATE` |
| `DELETE /v1/admin/pages/:id/permanent` | ADM | — | `204` | `409 INVALID_STATE` |

```ts
PageBlockInput = { id: uuid; visibility: BlockVisibility; layout: BlockLayout; name: string(1–80);
  title?: string|null; body?: string(≤5000)|null; cta1Label?: string|null; cta1Url?: string|null;
  cta2Label?: string|null; cta2Url?: string|null;   // url: path internal "/…" atau "https://…" (model §3.8)
  imageId?: uuid|null; config?: object|null }        // skema config per BlockType di shared; `type` tidak bisa diubah
AdminBlock   = PageBlockInput & { type: BlockType; pageId: uuid|null; isGlobal: bool /* pageId null; UI wajib memberi badge/peringatan sebelum simpan (Q2) */;
  position: int; image: MediaRef|null; updatedAt: iso }
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
| `PATCH /v1/admin/settings` | ADM | `Partial<SiteSettingInput> & { expectedUpdatedAt: iso }` | `200 { data: AdminSiteSetting }`. Mengubah `lowStockThreshold` menghitung ulang `stockStatus` produk yang memakai ambang global (model §6.3). | `409 EDIT_CONFLICT`, `400` (`timezone` bukan IANA, `seoDescription` > 160, `lowStockThreshold` < 0), `422` (`PRIVATE_MEDIA_NOT_ALLOWED`) |
| `GET /v1/admin/nav-items` | ADM | — | `200 { data: AdminNavItem[], meta: { updatedAt: iso } }` | — |
| `PUT /v1/admin/nav-items` | ADM | `{ expectedUpdatedAt: iso; items: NavItemInput[] }` — daftar lengkap; item tanpa `id` dibuat, item lama yang tidak dikirim dihapus; urutan array = `position` | `200 { data: AdminNavItem[], meta }` | `409 EDIT_CONFLICT`, `422` (`NAV_TARGET_REQUIRED`: `pageId`/`categoryId`/`url` sesuai `type`; `NAV_TARGET_NOT_FOUND`), `400` (maks 12 item) |

```ts
SiteSettingInput = { siteName: string(1–80); tagline: string|null; contactEmail: email;
  instagramHandle: string|null; instagramUrl: url|null; siteLanguage: SiteLanguage; timezone: string;
  address: string|null; logoId: uuid|null; iconId: uuid|null; seoHomeTitle: string(≤70)|null;
  seoKeywords: string(≤255)|null; seoDescription: string(≤160)|null; sitemapEnabled: bool; allowIndexing: bool;
  lowStockThreshold: int ≥0 /* default 10, Q13; tidak publik */ }
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
  "lowStockThreshold": 10, "updatedBy": { "id": "8a…", "name": "Rani" }, "updatedAt": "2026-09-17T06:40:00.000Z" } }
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
`POST /v1/admin/articles` dengan `{ title, content: [paragraf catatan] }` (Q1); respons
`201` memberi `data.id`, lalu UI menampilkan toast dengan tautan `/admin/articles/<id>`.

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
| `POST /v1/internal/jobs/data-retention` | Bearer | `{ dryRun?: bool }` | `200 { data: { ipHashCleared: { inquiries: int, comments: int }, anonymized: { inquiries: int, comments: int }, activityLogsDeleted: int } }` | Harian (Q11, Q12; model §6.11): `ipHash`/`userAgent` > 30 hari dikosongkan, inquiry & komentar > 24 bulan dianonimkan, `ActivityLog` > 12 bulan dihapus. |
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
| `products` | `/public/products`, `/public/categories`, `/public/materials`, `/public/sitemap` | Produk: simpan (bila terbit/berubah status), publish/unpublish, Trash konten terbit, purge, bulk; perubahan `SiteSetting.lowStockThreshold`. Restore tidak memicu (hasilnya `DRAFT`, Q3). |
| `product:<slug>` | `/public/products/:slug` | Produk itu, QC-nya, slug lama & baru saat slug berubah |
| `taxonomy` | `/public/categories`, `/public/materials`, `/public/article-categories`, `/public/nav-items` | Kategori produk/artikel, material, tag; perubahan kategori artikel juga memicu `articles` |
| `artisans`, `artisan:<slug>` | `/public/artisans`, `/:slug`, detail produk (ringkas artisan) | Pengrajin: simpan/arsip; juga `products` karena data ringkas artisan ada di produk |
| `articles`, `article:<slug>` | `/public/articles`, `/:slug`, sitemap | Artikel: simpan (terbit), publish/jadwal/unpublish, job publish-scheduled, Trash konten terbit; kategori artikel |
| `redirects` | `/public/redirects` | Perubahan slug produk/artikel, dan perubahan visibilitas publik produk/artikel yang punya `SlugRedirect` (publish/unpublish/Trash/purge) |
| `comments:<articleSlug>` | `/public/articles/:slug/comments` (+ `commentCount` di `article:<slug>`) | Moderasi & balasan komentar, anonimisasi komentar `APPROVED` (nama publik berubah) |
| `page:<path>` | `/public/pages?path=` | Page & bloknya |
| `blocks:global` | `/public/blocks/global`, semua `/public/pages` | Blok global |
| `nav` | `/public/nav-items` | Nav item, status Page |
| `settings` | `/public/settings`, `/public/sitemap` | SiteSetting |
| `media` | — | Tidak dipakai langsung; perubahan `alt` memicu tag konten yang merujuknya. |

---

## 7. Keputusan pemilik Q1–Q15 (model domain)

Sumber: [komentar pemilik di PR #46](https://github.com/haritsrhn/ornament-project/pull/46#issuecomment-5714288028).
Rincian model ada di [model domain §9](domain-model.md#9-keputusan-pemilik).

| ID | Keputusan | Dampak ke kontrak |
| --- | --- | --- |
| Q1 | Draf cepat membuat `Article` `DRAFT`; UI menautkan ke editor. | Tanpa endpoint khusus: `POST /v1/admin/articles` → `data.id` untuk tautan `/admin/articles/<id>` (§5.9, §5.16). |
| Q2 | Blok global berlaku di semua halaman, dengan indikator visual. | `isGlobal` di `AdminBlock` dan `PublicBlock`; `PATCH /v1/admin/blocks/:id` berlaku global (§5.14). |
| Q3 | Pemulihan dari Trash selalu `DRAFT`. | `/restore` produk, artikel, halaman selalu mengembalikan `DRAFT`; Media hanya `deletedAt = null`. Restore produk/artikel/media diturunkan ke `CTR*` milik sendiri; restore tidak memicu revalidasi (§3.2, §5.6, §5.9, §5.12, §5.14, §6). |
| Q4 | Kategori artikel = tabel `ArticleCategory`, dikelola di layar taksonomi (tipe Produk/Artikel). | `/v1/admin/categories?type=ARTICLE`, `AdminArticleCategory`; `categoryId` di `ArticleInput`; filter publik `category=<slug>`; `GET /v1/public/article-categories`; `category` di DTO artikel menjadi objek `{ slug, name }` (§5.3, §5.7, §5.9). |
| Q5 | Hapus kategori berproduk ditolak (Restrict), dengan jumlah produk. | `409 IN_USE` dengan `details.counts` dan pesan jumlah produk (§1.10, §5.7). |
| Q6 | SKU diedit manual (unik) dengan saran otomatis; duplikat mereset QC. | `sku?` di `ProductInput`, `409 CONFLICT` (`sku`), `POST /v1/admin/products/sku-suggestions`; duplikat `sku = null`, QC `PENDING` (§5.6). |
| Q7 | Harga FOB tampil publik bila diisi; bila kosong "Inquire for pricing". | `fobPriceUsd: money\|null`, `fobPort` di `PublicProductDetail`; keluar dari daftar 🔒 (§4, §5.1). |
| Q8 | Redirect 301 untuk slug lama produk & artikel. | `GET /v1/public/redirects`, tag `redirects`; PATCH slug membuat `SlugRedirect` (§5.5, §5.6, §5.9, §6). |
| Q9 | Email komentar wajib dan privat; **tanpa Gravatar** (avatar = inisial nama). | `authorEmail: email` wajib di `POST /v1/public/articles/:slug/comments`; tidak ada URL/hash avatar di DTO (§4, §5.3). |
| Q10 | Target kirim teks bebas + tanggal nullable bila terdeteksi. | `targetShipText` di input publik; `targetShipText`/`targetShipDate` di `AdminInquiry`; koreksi via `PATCH` (§5.4, §5.11). |
| Q11 | IP hash anonim setelah 30 hari; inquiry & komentar 24 bulan; tombol "Anonymize data pribadi". | `POST /v1/admin/inquiries/:id/anonymize`, `POST /v1/admin/comments/:id/anonymize`, bulk `ANONYMIZE` (ADM); `anonymizedAt` di DTO admin; job `data-retention` (§3.2, §5.10, §5.11, §5.17). |
| Q12 | ActivityLog dipangkas 12 bulan. | Job `data-retention`; bentuk `GET /v1/admin/activity` tidak berubah (§5.17). |
| Q13 | Low Stock otomatis dari ambang (default 10) + override manual. | `stockStatus` read-only turunan; `stockStatusOverride`, `lowStockThreshold` di `ProductInput`; bulk `SET_STOCK_OVERRIDE`; `SiteSetting.lowStockThreshold` (§1.3, §5.6, §5.15). |
| Q14 | Telepon, alamat detail, identitas pengrajin privat. | Tetap di daftar 🔒 DTO publik dan `ArtisanRedacted` (§4, §5.8). |
| Q15 | Satu kategori utama; pengelompokan silang lewat material & tag. | Tetap `categoryId` tunggal dan filter `category` tunggal. |

## 8. Keputusan pemilik A1–A11 (kontrak API)

Sumber: [komentar pemilik di PR #47](https://github.com/haritsrhn/ornament-project/pull/47#issuecomment-5714350684).

| ID | Keputusan | Dampak ke kontrak |
| --- | --- | --- |
| A1 | Contributor hanya CRUD draf miliknya (`createdById`/`authorId`). | `CTR*` + `403 NOT_OWNER`/`NOT_DRAFT` (§2.4, §3.1). |
| A2 | Contributor tanpa akses komentar; Page Builder read-only. | `/admin/comments/*` `EDT+`; `/admin/pages` GET `CTR+`, tulis `EDT+`; kode `page.read` (§3.2, §3.3, §5.10, §5.14). |
| A3 | Hapus permanen hanya Administrator. | Semua `/permanent` dan bulk `PURGE`: `ADM` (§3.2). |
| A4 | `sku` nullable; wajib saat publish. | `sku` di `PUBLISH_REQUIREMENTS_NOT_MET`; tidak ada lagi `PRIMARY_MATERIAL_REQUIRED`/`MATERIAL_SKU_CODE_MISSING` saat simpan draf; `materials` opsional saat draf (§1.10, §5.6). |
| A5 | Lampiran inquiry lewat presigned `PUT` ke R2, maks 3 berkas × 10 MB. | `POST /v1/public/inquiry-uploads` + `attachmentUploadIds` ≤3 (§5.4). |
| A6 | Honeypot → sukses palsu tanpa menyimpan. | Inquiry `201` dengan `reference` acak; komentar `202` (§5.3, §5.4). |
| A7 | Balasan admin otomatis menyetujui komentar induk `PENDING`. | `POST /v1/admin/comments/:id/replies` (§5.10). |
| A8 | Manajemen sesi multi-perangkat ditunda; ganti kata sandi mencabut sesi lain. | Tidak ada endpoint sesi (§2.1, §2.2). |
| A9 | GET publik tanpa `X-Internal-Key` (rate limit + cache CDN); key wajib untuk POST publik. | §1.1, §1.2 (`Cache-Control`, bypass CDN untuk request ber-key), §2.3 (batas tanpa key). |
| A10 | Arsip pengrajin diizinkan dengan `warnings`; produk tetap tayang; tautan pengrajin di publik dinonaktifkan. | `POST /v1/admin/artisans/:id/archive` → `warnings`; `artisan.slug: null` di `PublicProductDetail` (§5.1, §5.8). |
| A11 | Tanpa validasi stok kaku selain `MADE_TO_ORDER ⇒ stockQuantity null`. | `400` hanya untuk kombinasi itu (§5.6). |

### 8.1 Keputusan turunan dan lanjutan

Keputusan turunan yang diambil saat menerapkan (bisa dikoreksi saat review):

- `CategoryType` hanya ada di API; satu set rute `/v1/admin/categories` melayani dua tabel lewat query `type` (default `PRODUCT`, tidak breaking).
- Anonimisasi hanya `ADM` dan bisa diperluas ke semua data dengan email yang sama (`sameEmail`).
- GET publik dengan key valid mendapat batas 1200/menit dan melewati cache CDN; tanpa key 120/menit dan boleh dilayani cache edge 60 detik.
- Saran SKU memakai `POST` karena mengambil nomor sequence; server tidak mengisi SKU diam-diam.
- `PublicProductCard` tidak memuat harga FOB (hanya detail).
- Redirect tidak mencakup halaman (`Page.path`) dan pengrajin.

Keputusan lanjutan (komentar #49), lihat [model domain §9.2](domain-model.md#92-keputusan-lanjutan-komentar-49):

- `ArtisanDocumentKind` = `CONTRACT | IDENTITY | BANK_ACCOUNT | MATERIAL_ORIGIN | OTHER`. KTP & rekening hanya lewat dokumen privat; tidak ada field terstruktur di `ArtisanInput`.
- `Comment.notifyOnReply` belum diekspos: tidak diterima `POST /v1/public/articles/:slug/comments` dan tidak ada di DTO sampai fitur notifikasi dijadwalkan.
