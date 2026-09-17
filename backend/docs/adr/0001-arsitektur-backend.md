# ADR-0001: Arsitektur backend fase pertama

- **Status:** Diterima
- **Tanggal:** 2026-09-17
- **Issue:** #1 — [T0.1] Catat keputusan arsitektur (ADR)

## Konteks

- `frontend/` adalah Next.js 14 (App Router) + TypeScript + Tailwind yang saat ini
  hanya UI statis: semua daftar dari `frontend/lib/data.ts`, semua "simpan" hanya
  state lokal + toast. `backend/` masih kosong.
- Ada dua permukaan: **situs publik** (katalog, produk, journal, pengrajin, form
  kontak/inquiry, form komentar) dan **admin CMS** (16 layar: produk, taksonomi,
  halaman + Page Builder, pengrajin, artikel, media, komentar, inquiry, pengguna &
  peran, pengaturan).
- Keduanya **dideploy pada domain terpisah**; admin privat dan tidak ditautkan dari
  situs publik.
- Server state yang dibutuhkan: produk, kategori & material, halaman + blok,
  pengrajin, artikel (termasuk status `Scheduled`), media, komentar, inquiry,
  pengguna, pengaturan situs. Login admin memakai email + kata sandi dengan
  pembatasan domain `@ornament.id`.
- `frontend/lib/types.ts` sudah berisi bentuk `Product`, `Artisan`, `Article`,
  `Comment`, `Inquiry`, tetapi nilai enum-nya adalah label tampilan campuran
  bahasa (`"In Stock"`, `"Baru"`, `"Kapasitas penuh"`).
- Tim kecil; prioritasnya sistem yang mudah dirawat, bukan skala besar.

## Keputusan

### K1. API terpisah di `backend/` (Node + TypeScript) — *sudah disetujui*

Satu API melayani situs publik dan admin. Rute dipisah per audiens:
`/public/*` (baca konten terbit + submit form) dan `/admin/*` (butuh sesi).
Kode diorganisasi per domain: `src/modules/<domain>/{routes,service}.ts`, dengan
infrastruktur bersama di `src/lib/` (prisma, r2, email, auth) dan job di `src/jobs/`.
Ini *modular monolith*: satu proses, satu database, batas modul lewat folder.

### K2. Prisma + PostgreSQL — *sudah disetujui*

Skema dan migrasi dikelola `prisma migrate`. `frontend/lib/data.ts` menjadi
sumber seed awal (`prisma/seed.ts`), bukan data produksi. Enum DB memakai kode
stabil (`IN_STOCK`, `MADE_TO_ORDER`, `NEW`, `IN_PROGRESS`, ...), bukan label UI.

### K3. Cloudflare R2 untuk media, upload via presigned URL — *sudah disetujui*

Alur: admin `POST /admin/media/uploads` (nama file, MIME, ukuran) → API memvalidasi
allowlist MIME + batas ukuran, membuat key `media/<yyyy>/<mm>/<id>-<slug>.<ext>`,
mengembalikan presigned `PUT` (berlaku singkat, `Content-Type` dan
`Content-Length` ikut ditandatangani) → browser upload langsung ke R2 →
admin `POST /admin/media` untuk konfirmasi; API melakukan `HeadObject` sebelum
membuat record `Media`. File dilayani lewat custom domain publik R2.
Objek tanpa konfirmasi dibersihkan belakangan (lifecycle rule / job).

### K4. Resend untuk email — *sudah disetujui*

Dipakai untuk balasan inquiry, notifikasi inquiry/komentar baru, dan undangan
pengguna. Email dikirim setelah transaksi DB commit; hasil kirim (id Resend atau
error) disimpan pada record terkait agar gagal kirim terlihat dan bisa diulang
dari admin.

### K5. Framework HTTP: **Fastify**

Alasan:
- API ini berjalan sebagai proses Node yang hidup lama (Prisma, job terjadwal
  in-process — lihat K8). Fastify dirancang untuk runtime itu dan matang di sana.
- Ekosistem plugin resmi menutup kebutuhan kita tanpa kode lem:
  `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/helmet`.
- Hook `onRequest`/`preHandler` dan dekorator cocok untuk guard sesi & peran;
  logging terstruktur (pino) sudah bawaan.
- Validasi + inferensi tipe dari Zod lewat `fastify-type-provider-zod`
  (juga membuka jalan ke OpenAPI bila perlu).

Ditolak — **Hono**: keunggulan utamanya (portabilitas Web Standard ke edge/Workers
dan klien RPC bertipe) tidak kita butuhkan. Prisma + PostgreSQL + job in-process
mengarah ke Node biasa, dan klien RPC akan mengikat frontend ke tipe implementasi
router, padahal kontrak sudah dibagi lewat skema Zod (K6). **Express**: tanpa
validasi/tipe bawaan, async error handling lemah.

### K6. Validasi skema: **Zod**, dibagi lewat paket `@ornament/shared`

- Semua kontrak request/response didefinisikan sebagai skema Zod di
  `packages/shared/src/<domain>.ts`; tipe TS diturunkan dengan `z.infer`.
- Backend memakai skema yang sama untuk validasi runtime (body, query, params)
  dan serialisasi response.
- Frontend mengimpor skema/tipe dari `@ornament/shared`: untuk tipe data dari API
  dan untuk validasi form di sisi klien (pesan error konsisten dengan server).
  `frontend/lib/types.ts` bertahap diganti re-export dari paket ini.
- Enum di kontrak memakai kode stabil (K2); pemetaan kode → label tampilan
  (`IN_STOCK` → "In Stock", `NEW` → "Baru") tinggal di frontend.
- Tanggal dikirim sebagai string ISO 8601; teks relatif ("2 jam lalu") dihitung
  di frontend.
- Tipe model Prisma **tidak** diekspor ke frontend; DTO ditulis eksplisit agar
  kolom internal (hash kata sandi, token) tidak bocor dan skema DB bebas berubah.

Ditolak — **tipe ditulis manual di dua sisi**: pasti drift. **Generate klien dari
OpenAPI**: menambah langkah build dan tooling untuk tim kecil; bisa ditambahkan
kemudian karena skema Zod sudah ada. **Valibot/TypeBox**: Zod paling dikenal dan
integrasi Fastify/React form-nya paling matang.

### K7. Autentikasi: sesi di DB + cookie httpOnly

**Mekanisme**
- Login `POST /admin/auth/login` (email + kata sandi). Email wajib berakhiran
  `@ornament.id` **dan** terdaftar sebagai `User` aktif. Kata sandi di-hash
  **argon2id**. Rate limit per IP dan per email.
- Sukses → buat token acak 32 byte; DB menyimpan **SHA-256 dari token** di tabel
  `Session` (userId, expiresAt, lastSeenAt, userAgent, ip). Token mentah hanya ada
  di cookie, sehingga dump DB tidak bisa dipakai membajak sesi.
- Masa berlaku: 12 jam default; 30 hari bila "Ingat saya" (radio di layar login).
  Sliding refresh `lastSeenAt`, dengan batas absolut. Logout, ganti kata sandi,
  dan penonaktifan user menghapus sesi terkait.
- Otorisasi per peran (Admin / Editor / Contributor) dicek di `preHandler` rute.
- Undangan pengguna: token sekali pakai (hash di DB, kedaluwarsa 72 jam) dikirim
  via Resend; pengguna menetapkan kata sandi sendiri.

**Cookie**
- Nama `__Host-osa_session`; atribut `HttpOnly; Secure; SameSite=Strict; Path=/`,
  **tanpa** atribut `Domain` (prefix `__Host-` mewajibkannya). Cookie hanya milik
  host API, tidak terkirim ke subdomain lain.

**Implikasi dua domain**
- Admin (mis. `admin.ornament.id`) memanggil API dari browser dengan
  `fetch(..., { credentials: "include" })`.
- **Syarat deploy:** API admin di-host sebagai subdomain dari *registrable domain*
  yang sama dengan admin (mis. `api.ornament.id`). Dengan begitu request
  admin → API berstatus *same-site*: cookie `SameSite=Strict` tetap terkirim dan
  tidak terkena pemblokiran cookie pihak ketiga browser.
- CORS di API: allowlist **eksplisit** origin admin (dari env
  `ADMIN_ORIGIN`), `Access-Control-Allow-Credentials: true`, tanpa wildcard,
  metode dan header dibatasi. Situs publik **tidak** masuk allowlist.
- CSRF: `SameSite=Strict` + untuk metode non-GET API menolak request yang header
  `Origin`-nya bukan `ADMIN_ORIGIN` dan yang `Content-Type`-nya bukan
  `application/json` (memaksa preflight). Tidak perlu token CSRF terpisah.
- Situs publik **dirender server-side oleh Next.js** (Server Components /
  Route Handlers / Server Actions). Semua panggilan publik adalah
  **server-to-server** dari server Next ke `/public/*`; browser pengunjung tidak
  memanggil API langsung, sehingga tidak ada CORS maupun cookie di sisi publik.
  - Baca konten: `fetch` dengan cache + `next: { tags }`. Saat konten berubah
    (simpan admin, publikasi terjadwal), API memanggil endpoint revalidasi Next
    (`POST /api/revalidate`, dilindungi secret) untuk `revalidateTag`.
  - Submit inquiry/komentar: Server Action memanggil API dengan header
    `X-Internal-Key` (secret bersama) dan meneruskan IP pengunjung untuk rate
    limit; tanpa key yang valid, IP yang diteruskan diabaikan. Ditambah honeypot
    field.

Ditolak — **JWT di localStorage/header**: rentan XSS dan tidak bisa dicabut
tanpa denylist. **JWT di cookie**: pencabutan tetap butuh lookup DB, jadi tidak
ada untung dibanding sesi. **Auth-as-a-service (Clerk/Auth0)**: biaya dan
ketergantungan untuk segelintir pengguna internal. **Auth.js di Next**: auth
menjadi milik frontend, padahal API adalah pemilik data dan dipakai dua klien.
**Cookie `Domain=.ornament.id` dibagi lintas subdomain**: memperluas permukaan
serangan ke semua subdomain tanpa manfaat.

*Fallback* bila domain admin dan API tidak bisa dibuat same-site: admin Next
mem-proxy `/api/*` ke API lewat `rewrites`, sehingga browser hanya melihat origin
admin (tanpa CORS). Diputuskan saat deploy, bukan sekarang.

### K8. Publikasi terjadwal artikel: job interval in-process + guard di query

- `Article` punya `status` (`DRAFT | SCHEDULED | PUBLISHED`) dan `publishAt`.
- `src/jobs/publish-scheduled.ts` berjalan tiap 60 detik di proses API
  (`setInterval`, dimulai saat boot, dihentikan saat shutdown):
  satu query atomik
  `UPDATE article SET status='PUBLISHED' WHERE status='SCHEDULED' AND publish_at <= now() RETURNING slug`,
  lalu memicu revalidasi Next untuk slug yang terbit.
- Idempoten: bila ada lebih dari satu instance, UPDATE yang sama aman dijalankan
  bersamaan; revalidasi ganda tidak berbahaya.
- **Guard baca:** query publik memperlakukan
  `status = PUBLISHED OR (status = SCHEDULED AND publishAt <= now())` sebagai
  terbit, sehingga keterlambatan job atau API yang sempat mati tidak menunda
  artikel. Job hanya merapikan status dan memicu revalidasi.
- Semua waktu disimpan UTC (`timestamptz`); admin menampilkan WIB (Asia/Jakarta).

Ditolak — **pg-boss/BullMQ**: antrean penuh (dan Redis) berlebihan untuk satu
jenis job per menit. **Cron platform eksternal**: mengikat ke penyedia hosting;
tetap bisa dipakai nanti dengan mengekspos job yang sama sebagai endpoint internal
bila API dideploy serverless. **Hanya guard baca tanpa job**: status di admin
tidak pernah berubah dan cache Next tidak ter-revalidasi.

### K9. Struktur monorepo: **npm workspaces**

```
package.json            workspaces: ["frontend", "backend", "packages/*"]
package-lock.json       satu lockfile di root
.nvmrc                  24
frontend/               Next.js (situs publik + admin)
backend/                Fastify API, prisma/, docs/adr/
packages/shared/        @ornament/shared — skema Zod + tipe
```

- `@ornament/shared` di-build dengan `tsc` ke `dist/` (ESM + `.d.ts`); root script
  `build` membangun shared lebih dulu. Frontend juga memakai
  `transpilePackages: ["@ornament/shared"]`.
- Backend: ESM, `tsx watch` untuk dev, `tsc` untuk build, Vitest untuk test.

Alasan: satu-satunya kebutuhan lintas paket adalah berbagi skema (K6), dan npm
sudah dipakai frontend. Workspaces memberi symlink paket lokal tanpa tool baru.

Ditolak — **pnpm/Turborepo/Nx**: tool tambahan untuk tiga paket; bisa diadopsi
nanti tanpa mengubah struktur folder. **Tanpa workspace (salin tipe / path alias
relatif)**: drift, dan alias lintas folder merusak build Next dan deploy terpisah.

### K10. Versi Node: **Node.js 24 LTS**

Dikunci lewat `.nvmrc` (`24`) dan `"engines": { "node": ">=24 <25" }` di root,
serta image deploy yang sama. Node 24 adalah LTS dengan dukungan terpanjang saat
ini (hingga April 2028) dan didukung Next 14, Prisma, dan Fastify 5. Node 22 ditolak
karena masuk fase maintenance lebih awal (April 2027) tanpa keuntungan apa pun
bagi proyek baru.

### K11. Cakupan fase pertama yang dikunci — *sudah disetujui*

- Permalink tetap `/produk/<slug>` dan `/journal/<slug>`; tidak ada pengaturan
  struktur permalink.
- Page Builder hanya mengubah **isi, urutan, dan status** blok pada halaman yang
  sudah ada; tidak ada pembuatan tipe blok atau layout baru.
- Tema dan font tetap dari design system (`globals.css`, `next/font`).

## Konsekuensi

**Menjadi lebih mudah**
- Satu kontrak (Zod) untuk validasi server, validasi form, dan tipe frontend.
- Situs publik tidak mengekspos API ke browser; CORS hanya untuk satu origin admin.
- Sesi bisa dicabut seketika (logout, nonaktifkan user) karena tersimpan di DB.
- Publikasi terjadwal tetap benar walau job terlambat.
- Tanpa Redis atau layanan antrean; infrastruktur = Node + PostgreSQL + R2 + Resend.

**Menjadi lebih sulit / harus diterima**
- **Syarat deploy:** API dan admin harus same-site (atau pakai fallback proxy).
  Situs publik butuh `API_URL`, `INTERNAL_API_KEY`, dan `REVALIDATE_SECRET`.
- Setiap request admin melakukan lookup sesi ke DB (murah, tapi ada).
- API harus berjalan sebagai proses yang hidup terus agar job K8 jalan; platform
  serverless murni memerlukan pemicu cron eksternal.
- Frontend yang sekarang berdiri sendiri harus dipindah ke workspace: lockfile
  pindah ke root, `npm install` dijalankan dari root.
- Label enum di UI harus dipetakan dari kode API; `lib/types.ts` dan
  `lib/data.ts` perlu penyesuaian bertahap.
- Email dikirim sinkron setelah commit; bila Resend gagal, operasi tetap tersimpan
  dan status kirim ditandai gagal (tidak ada retry otomatis di fase ini).
- Bila kebutuhan job bertambah (resize gambar, digest email, retry), K8 perlu
  ditinjau ulang menuju antrean berbasis PostgreSQL (mis. pg-boss).

## Di luar cakupan

- Preset tema/font dinamis, pilihan struktur permalink, dan fitur "Order produksi".
- Pembuatan tipe blok atau halaman baru di Page Builder.
- Pemrosesan gambar (resize/varian), CDN transform, dan pembersihan media yatim
  selain yang disebut di K3.
- SSO/OAuth, 2FA, dan reset kata sandi mandiri (admin mengirim ulang undangan).
- Pencarian full-text, multi-bahasa konten, dan analytics.
- Pilihan penyedia hosting, CI/CD, observability, dan backup — ADR terpisah.
- Pemisahan frontend menjadi dua aplikasi Next (publik vs admin); saat ini satu
  aplikasi dideploy ke dua domain, dibahas saat tugas deploy.
- Captcha (mis. Turnstile) pada form publik; ditambahkan bila honeypot + rate
  limit tidak cukup.
