# Model Domain & ERD

- **Issue:** #2 — [T0.2] Model domain & ERD
- **Status:** Draf untuk ditinjau; keputusan pemilik Q1–Q15 sudah diterapkan (#48, lihat §9)
- **Tanggal:** 2026-09-17
- **Dasar:** UI di `frontend/` (tipe, data contoh, 16 layar admin, halaman publik)
  dan [ADR-0001](adr/0001-arsitektur-backend.md). Bila dokumen ini dan ADR
  berbeda, ADR yang berlaku.

## 1. Ringkasan

Model ini adalah rancangan skema Prisma + PostgreSQL untuk situs publik dan admin
CMS. Nama entitas dan field memakai camelCase Inggris agar bisa langsung dipakai
di `schema.prisma`. Nilai enum memakai kode yang stabil (ADR K2), sedangkan label
Indonesia/Inggris di UI dipetakan di frontend.

Keputusan inti:

| # | Keputusan |
| --- | --- |
| D1 | **ID** `String @id @default(uuid()) @db.Uuid`; semua waktu `DateTime @db.Timestamptz` (UTC). Setiap entitas utama punya `createdAt` dan `updatedAt`. |
| D2 | **Status terbit dan status stok produk dipisah**: `publishStatus` (DRAFT/PUBLISHED) dan `stockStatus` (IN_STOCK/LOW_STOCK/MADE_TO_ORDER). Di frontend lama, `"Draft"` masih menjadi salah satu nilai stok. `stockStatus` dihitung server dari stok dan ambang, dengan override manual (§6.3, Q13). |
| D3 | **Soft delete (Trash)** lewat `deletedAt` pada `Product`, `Article`, `Page`, dan `Media`. Isi Trash bisa dipulihkan selama 30 hari lalu dihapus permanen oleh job. Pemulihan selalu kembali ke `DRAFT` (Q3). `Artisan` tidak masuk Trash; datanya diarsipkan (`archivedAt`) karena menyimpan dokumen dan riwayat. |
| D4 | **Kategori produk** memakai tabel hierarkis (`Category.parentId`), menggantikan union hardcoded. **Kategori artikel** memakai tabel datar `ArticleCategory` yang dikelola di layar taksonomi yang sama (tipe Produk/Artikel, Q4). |
| D5 | **Material** punya tabel sendiri (taksonomi yang bisa difilter di katalog, M:N dengan produk, dan satu material ditandai primer). **Tag** adalah label bebas yang dipakai bersama oleh produk dan artikel. |
| D6 | **Spesifikasi dan QC dicatat per produk**: field inti terstruktur di `Product`, baris tambahan di `ProductSpec`, dan empat titik QC di `ProductQcCheck`. Konstanta global `PRODUCT_SPEC`/`QC_POINTS` tidak dipakai lagi. |
| D7 | **Isi rich text dan blok disimpan sebagai JSON** (`Product.description`, `Article.content`) dan divalidasi skema Zod di `@ornament/shared`. Pilihan ini membuat urutan blok tersimpan atomik dalam satu dokumen. Media yang dirujuk di dalam blok aman dari referensi rusak karena `Media` memakai soft delete. |
| D8 | **Media punya `visibility`**. `PUBLIC` dilayani lewat domain publik R2 (ADR K3). `PRIVATE` (dokumen pengrajin, lampiran inquiry/balasan) disimpan di prefix/bucket privat dan hanya diakses lewat presigned GET dari admin. |
| D9 | **Data PRIVAT** (ditandai 🔒 di tabel) tidak boleh masuk DTO `/public/*`. |
| D10 | **Blok global** (mis. Footer) adalah `PageBlock` dengan `pageId = null` dan `visibility = GLOBAL`. Satu baris dipakai di semua halaman, jadi mengeditnya dari halaman mana pun berlaku di semua halaman. API menandainya `isGlobal` agar editor memberi peringatan (Q2). |
| D11 | **Pengaturan situs** disimpan di satu baris bertipe (`SiteSetting`, id tetap `1`), bukan key-value. Alasannya agar tipe dan validasinya dijaga oleh Prisma dan Zod. |

## 2. ERD

Diagram hanya memuat PK, FK, dan beberapa field kunci. Daftar field lengkap ada di §3.

```mermaid
erDiagram
    User ||--o{ Session : has
    User ||--o{ Invite : "invites (invitedBy)"
    User ||--o{ Media : uploads
    User ||--o{ Article : authors
    User ||--o{ ProductRevision : edits
    User ||--o{ InquiryReply : writes
    User ||--o{ Comment : "replies as admin"
    User ||--o{ ActivityLog : acts

    Category ||--o{ Category : parent
    Category ||--o{ Product : classifies
    Category ||--o{ NavItem : "target"
    Category ||--o{ Inquiry : "requested"

    Artisan ||--o{ Product : makes
    Artisan ||--o{ ArtisanImage : gallery
    Artisan ||--o{ ArtisanDocument : "private docs"
    Media ||--o{ Artisan : "photo"

    Product ||--o{ ProductMaterial : ""
    Material ||--o{ ProductMaterial : ""
    Material ||--o{ Inquiry : "requested"
    Product ||--o{ ProductTag : ""
    Tag ||--o{ ProductTag : ""
    Product ||--o{ ProductImage : gallery
    Product ||--o{ ProductSpec : specs
    Product ||--|{ ProductQcCheck : "4 QC stages"
    Product ||--o{ ProductRevision : revisions
    Media ||--o{ Product : "primaryImage"
    Media ||--o{ ProductImage : ""
    Media ||--o{ ArtisanImage : ""
    Media ||--o{ ArtisanDocument : ""

    ArticleCategory ||--o{ Article : classifies
    Article ||--o{ ArticleTag : ""
    Tag ||--o{ ArticleTag : ""
    Product ||--o{ SlugRedirect : "old slugs"
    Article ||--o{ SlugRedirect : "old slugs"
    Article ||--o{ Comment : has
    Comment ||--o{ Comment : "replies"
    Media ||--o{ Article : "featuredImage"

    Inquiry ||--o{ InquiryReply : replies
    Inquiry ||--o{ InquiryAttachment : attachments
    InquiryReply ||--o{ InquiryAttachment : attachments
    Media ||--o{ InquiryAttachment : ""

    Page ||--o{ PageBlock : blocks
    Media ||--o{ PageBlock : image
    Page ||--o{ NavItem : "target"
    Media ||--o{ SiteSetting : "logo / icon"

    User {
        uuid id PK
        string email UK
        enum role
        enum status
    }
    Session {
        uuid id PK
        uuid userId FK
        string tokenHash UK
    }
    Invite {
        uuid id PK
        uuid invitedById FK
        string tokenHash UK
    }
    Media {
        uuid id PK
        string key UK
        enum visibility
        uuid uploadedById FK
    }
    Category {
        uuid id PK
        uuid parentId FK
        string slug UK
    }
    Material {
        uuid id PK
        string slug UK
    }
    ArticleCategory {
        uuid id PK
        string slug UK
        int position
    }
    Tag {
        uuid id PK
        string slug UK
    }
    Artisan {
        uuid id PK
        string slug UK
        enum status
        uuid photoId FK
    }
    ArtisanImage {
        uuid artisanId FK
        uuid mediaId FK
        int position
    }
    ArtisanDocument {
        uuid id PK
        uuid artisanId FK
        uuid mediaId FK
        enum kind
    }
    Product {
        uuid id PK
        string slug UK
        string sku UK "nullable"
        enum publishStatus
        enum stockStatus
        enum stockStatusOverride
        uuid categoryId FK
        uuid artisanId FK
        uuid primaryImageId FK
        datetime deletedAt
    }
    ProductMaterial {
        uuid productId PK
        uuid materialId PK
        bool isPrimary
    }
    ProductTag {
        uuid productId PK
        uuid tagId PK
    }
    ProductImage {
        uuid productId FK
        uuid mediaId FK
        int position
    }
    ProductSpec {
        uuid id PK
        uuid productId FK
        int position
    }
    ProductQcCheck {
        uuid id PK
        uuid productId FK
        enum stage
        enum status
    }
    ProductRevision {
        uuid id PK
        uuid productId FK
        int number
        uuid editedById FK
    }
    Article {
        uuid id PK
        string slug UK
        enum status
        datetime publishAt
        uuid categoryId FK
        uuid authorId FK
        uuid featuredImageId FK
    }
    ArticleTag {
        uuid articleId PK
        uuid tagId PK
    }
    Comment {
        uuid id PK
        uuid articleId FK
        uuid parentId FK
        uuid authorUserId FK
        enum status
        datetime anonymizedAt
    }
    Inquiry {
        uuid id PK
        int number UK
        string reference UK
        enum status
        uuid categoryId FK
        uuid materialId FK
        datetime anonymizedAt
    }
    InquiryReply {
        uuid id PK
        uuid inquiryId FK
        uuid authorId FK
        enum status
    }
    InquiryAttachment {
        uuid id PK
        uuid inquiryId FK
        uuid replyId FK
        uuid mediaId FK
    }
    Page {
        uuid id PK
        string path UK
        enum status
    }
    PageBlock {
        uuid id PK
        uuid pageId FK
        enum visibility
        int position
        uuid imageId FK
    }
    NavItem {
        uuid id PK
        enum type
        uuid pageId FK
        uuid categoryId FK
        int position
    }
    SiteSetting {
        int id PK
        uuid logoId FK
        uuid iconId FK
    }
    SlugRedirect {
        uuid id PK
        enum type
        string fromSlug
        uuid productId FK
        uuid articleId FK
    }
    ActivityLog {
        uuid id PK
        uuid actorId FK
        enum kind
        string entityType
    }
```

## 3. Entitas

Kolom **Wajib**: ✓ = NOT NULL. Kolom **Indeks**: `PK`, `UK` (unik), `IX` (indeks
biasa). 🔒 = PRIVAT, hanya untuk admin. `createdAt`/`updatedAt` tidak ditulis
ulang di setiap tabel kecuali ada catatan khusus.

### 3.1 Akses

#### User

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| email | String (citext) | ✓ | UK | Wajib berakhiran `@ornament.id` (dicek di API). |
| name | String | ✓ | | |
| passwordHash | String | ✓ | | 🔒 argon2id. Tidak pernah masuk DTO. |
| role | `UserRole` | ✓ | IX | |
| status | `UserStatus` | ✓ | IX | Default `ACTIVE`. "Cabut akses" → `REVOKED` dan hapus semua sesi user. |
| avatarId | Uuid → Media | | | Opsional; UI saat ini hanya memakai inisial. |
| lastActiveAt | DateTime | | | Diperbarui bersamaan dengan `Session.lastSeenAt` (dibatasi, mis. maks 1×/menit). |
| revokedAt | DateTime | | | |

User **tidak pernah dihapus permanen** karena menjadi penulis artikel dan pelaku di log.
Kolom "Konten" di UI diturunkan saat query (jumlah artikel/produk/revisi).

#### Session 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| userId | Uuid → User | ✓ | IX | Cascade |
| tokenHash | String | ✓ | UK | SHA-256 dari token cookie (ADR K7). |
| expiresAt | DateTime | ✓ | IX | 12 jam; 30 hari bila "Ingat saya". |
| absoluteExpiresAt | DateTime | ✓ | | Batas atas untuk sliding refresh. |
| lastSeenAt | DateTime | ✓ | | |
| userAgent | String | | | |
| ip | String | | | |

#### Invite 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| email | String (citext) | ✓ | IX | `@ornament.id`. Hanya boleh ada satu undangan aktif per email (unik parsial `WHERE acceptedAt IS NULL AND revokedAt IS NULL`, lewat migrasi SQL). |
| role | `UserRole` | ✓ | | |
| tokenHash | String | ✓ | UK | |
| expiresAt | DateTime | ✓ | | 72 jam (ADR K7). |
| invitedById | Uuid → User | ✓ | | Restrict |
| acceptedAt | DateTime | | | Saat diterima, `User` dibuat dalam transaksi yang sama. |
| revokedAt | DateTime | | | |
| emailMessageId / emailError | String | | | Hasil kirim Resend (ADR K4). |

Undangan yang tertunda tampil di tabel Users sebagai baris "Belum masuk".

### 3.2 Media

#### Media

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| key | String | ✓ | UK | Key R2 `media/<yyyy>/<mm>/<id>-<slug>.<ext>`. File privat memakai prefix `private/`. |
| visibility | `MediaVisibility` | ✓ | IX | Default `PUBLIC`. |
| kind | `MediaKind` | ✓ | IX | Diturunkan dari MIME. Dipakai untuk filter "Gambar / Dokumen". |
| fileName | String | ✓ | | Nama file asli. |
| mimeType | String | ✓ | | Harus lolos allowlist. |
| sizeBytes | BigInt | ✓ | | Total terpakai = `SUM(sizeBytes)`. |
| width / height | Int | | | Hanya untuk gambar. |
| alt | String | | | Wajib diisi sebelum dipakai pada konten publik (validasi di API). |
| uploadedById | Uuid → User | | IX | SetNull. Null bila diunggah pengunjung (lampiran inquiry). |
| createdAt | DateTime | ✓ | IX | Untuk filter bulan. |
| deletedAt | DateTime | | IX | Trash |

Media dipakai oleh: `Product.primaryImageId`, `ProductImage`, `Artisan.photoId`,
`ArtisanImage`, `ArtisanDocument`, `Article.featuredImageId`, blok gambar di
`Article.content`, `PageBlock.imageId`, `SiteSetting.logoId/iconId`, dan
`InquiryAttachment`.

### 3.3 Taksonomi

#### Category

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | | |
| slug | String | ✓ | UK | Dibuat dari `name`; lihat §6.1. |
| parentId | Uuid → Category | | IX | Restrict: kategori yang masih punya anak tidak bisa dihapus. |
| description | String | | | |
| position | Int | ✓ | | Default 0. Menentukan urutan dalam satu induk. |

Kolom "Produk" di UI adalah jumlah produk yang diturunkan (bukan disimpan) dari
kategori itu beserta turunannya.

#### Material

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | UK | Contoh: "Rotan alami", "Jati reclaimed". |
| slug | String | ✓ | UK | |
| skuCode | String(3) | | UK | Kode SKU, mis. `RTN`, `TEK`, `WHY` (§6.2). |

Hitungan dan ukuran tag di layar taksonomi diturunkan dari `ProductMaterial`.

#### ArticleCategory

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | UK | Contoh: "Craft Journal", "Process". |
| slug | String | ✓ | UK | Dipakai filter journal publik (`?category=<slug>`). |
| description | String | | | |
| position | Int | ✓ | | Default 0. Urutan chip/filter. |

Datar (tanpa induk). Dikelola di layar `/admin/taxonomy` yang sama dengan kategori
produk, dengan tipe **Produk / Artikel** (Q4); tipe itu hanya pembeda di API, bukan
kolom. Seed awal dari `ARTICLE_CATEGORIES` (Craft Journal, Process, Material, Artisan
Story). Kolom "Artikel" di UI diturunkan dari jumlah `Article`.

#### Tag

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | | Contoh: "handwoven", "bantul". |
| slug | String | ✓ | UK | Dinormalisasi huruf kecil; tag yang sama dipakai ulang, tidak diduplikasi. |

### 3.4 Pengrajin

#### Artisan

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | | Nama workshop. |
| slug | String | ✓ | UK | `/pengrajin/<slug>` |
| contactName | String | | | 🔒 Nama penanggung jawab. |
| phone | String | | | 🔒 Format E.164. |
| partnerSinceYear | Int | | | Ditampilkan sebagai "Mitra sejak 2018". |
| village | String | | | Desa/kelurahan, mis. "Bangunjiwo". |
| regency | String | ✓ | IX | Kabupaten, mis. "Bantul". Dipakai filter "daerah" di tabel produk. |
| province | String | ✓ | | |
| address | String | | | 🔒 Alamat detail (jalan, RT/RW). |
| craftsmenCount | Int | | | "8 penganyam" |
| monthlyCapacity | Int | | | |
| capacityUnit | String | ✓ | | Default `pcs`. |
| avgLeadTimeDays | Int | | | |
| skills | String[] | ✓ | | Keahlian. Elemen pertama ditampilkan sebagai keahlian utama. |
| summary | String | | | Ringkasan untuk kartu/daftar (dulu `note`). **Publik.** |
| story | Json | | | Profil publik (rich text) di halaman pengrajin. |
| internalNotes | String | | | 🔒 Kekuatan, keterbatasan, catatan negosiasi. |
| status | `ArtisanStatus` | ✓ | IX | Default `VERIFICATION`. |
| photoId | Uuid → Media | | | Foto workshop utama. SetNull. |
| archivedAt | DateTime | | IX | "Arsipkan". Produk terbitnya tetap tayang (§6.7). |

Data identitas pengrajin (Q14) yang sudah dimodelkan: `contactName`, `phone`,
`address`, `internalNotes`, dan `ArtisanDocument`, semuanya 🔒. Kolom KTP atau nomor
rekening **tidak** ditambahkan karena belum ada field-nya di layar admin; bila
dibutuhkan, lihat §9.2.

#### ArtisanImage

`artisanId` (Cascade), `mediaId` (Restrict), `position` Int, `caption` String?.
PK komposit (`artisanId`, `mediaId`). Galeri publik seperti "Proses anyam" dan "Detail material".

#### ArtisanDocument 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| artisanId | Uuid → Artisan | ✓ | IX | Cascade |
| mediaId | Uuid → Media | ✓ | | Restrict; Media harus `PRIVATE`. |
| kind | `ArtisanDocumentKind` | ✓ | | |
| title | String | ✓ | | |
| uploadedById | Uuid → User | | | SetNull |

### 3.5 Produk

#### Product

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| name | String | ✓ | | |
| slug | String | ✓ | UK | `/produk/<slug>` |
| sku | String | | UK | Boleh null saat draf, **wajib saat publish**. Diisi/diedit manual dengan saran otomatis (§6.2). |
| description | Json | | | Rich text: tebal/miring/garis bawah/daftar/tautan/gambar. |
| excerpt | String | | | Teks singkat untuk kartu dan meta description; bila kosong, dibuat dari `description`. |
| categoryId | Uuid → Category | ✓ | IX | Restrict |
| artisanId | Uuid → Artisan | | IX | Restrict. Boleh null saat draf, **wajib saat publish**. |
| moqQuantity | Int | ✓ | | |
| moqUnit | String | ✓ | | `pcs` / `set` / `panel`. Juga menjadi satuan stok. |
| leadTimeDays | Int | | | |
| lengthCm / widthCm / heightCm | Decimal(7,1) | | | Ditampilkan "45 × 45 × 38 cm". |
| weightKg | Decimal(7,2) | | | Berat per pcs. |
| fobPriceUsd | Decimal(10,2) | | | Harga FOB per unit. **Publik** bila diisi; null → UI publik menampilkan "Inquire for pricing" (Q7). |
| fobPort | String | | | Default "Semarang". Publik. |
| stockStatus | `StockStatus` | ✓ | IX | **Turunan** yang disimpan (untuk filter/indeks), dihitung server setiap simpan (§6.3, Q13). Tidak dikirim klien. |
| stockStatusOverride | `StockStatus` | | | 🔒 Override manual. Null = otomatis. |
| stockQuantity | Int | | | Wajib null bila status efektif `MADE_TO_ORDER`. |
| lowStockThreshold | Int | | | 🔒 Ambang Low Stock per produk (≥0). Null = pakai `SiteSetting.lowStockThreshold`. |
| stockNote | String | | | 🔒 Catatan internal, mis. "Menunggu foto produk". |
| publishStatus | `PublishStatus` | ✓ | IX | Default `DRAFT`. |
| publishedAt | DateTime | | IX | Diisi saat pertama kali publish. |
| primaryImageId | Uuid → Media | | | SetNull. Wajib saat publish. |
| revision | Int | ✓ | | Default 1. §6.3 |
| duplicatedFromId | Uuid → Product | | | SetNull. Jejak asal duplikat. |
| createdById / updatedById | Uuid → User | | | SetNull |
| deletedAt | DateTime | | IX | Trash (§6.4) |

Indeks komposit `(publishStatus, deletedAt, categoryId)` untuk katalog publik.
`origin` pada tipe lama diturunkan dari `artisan.village/regency`.

#### ProductMaterial

`productId` (Cascade) + `materialId` (Restrict) sebagai PK komposit, ditambah
`isPrimary` Boolean. Maksimal satu baris `isPrimary = true` per produk (unik parsial
`(productId) WHERE isPrimary`); tepat satu wajib saat publish. Material primer
ditampilkan di kolom "Material" dan dipakai untuk saran SKU.

#### ProductTag

`productId` (Cascade) + `tagId` (Cascade). PK komposit.

#### ProductImage

`productId` (Cascade), `mediaId` (Restrict), `position` Int. PK komposit
(`productId`, `mediaId`). Galeri **tidak** berisi foto utama.

#### ProductSpec

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| productId | Uuid → Product | ✓ | IX | Cascade |
| label | String | ✓ | | Contoh: "Finishing", "Panjang kabel". |
| value | String | ✓ | | Contoh: "Natural clear coat". |
| position | Int | ✓ | | |

Tabel spesifikasi publik adalah gabungan field inti `Product` (Dimensi, Material,
MOQ, Lead time, Harga FOB <port>) dan baris `ProductSpec`, sesuai urutannya.

#### ProductQcCheck

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| productId | Uuid → Product | ✓ | UK(productId, stage) | Cascade |
| stage | `QcStage` | ✓ | | |
| status | `QcStatus` | ✓ | | Default `PENDING`. |
| criteria | String | | | Kriteria lulus yang ditampilkan publik, mis. "Diameter dan kadar air rotan dicatat…". |
| notes | String | | | 🔒 |
| checkedById | Uuid → User | | | SetNull |
| checkedAt | DateTime | | | |

Empat baris (satu per `stage`) dibuat bersamaan dengan produk. Ini adalah
checklist **per produk**. QC per batch produksi ("Frame check lolos untuk batch
…") ikut Order produksi yang masih ditunda.

#### ProductRevision 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| productId | Uuid → Product | ✓ | UK(productId, number) | Cascade |
| number | Int | ✓ | | |
| snapshot | Json | ✓ | | Isi produk beserta relasinya pada revisi ini. |
| editedById | Uuid → User | | | SetNull |
| createdAt | DateTime | ✓ | | |

### 3.6 Artikel & komentar

#### Article

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| title | String | ✓ | | |
| slug | String | ✓ | UK | `/journal/<slug>` |
| excerpt | String | | | Bila kosong, dibuat dari paragraf pertama (maks 200 karakter). |
| content | Json | ✓ | | Array blok, lihat format di bawah. |
| categoryId | Uuid → ArticleCategory | | IX | Restrict. Boleh null saat draf (draf cepat Q1), **wajib saat jadwal/publish**. |
| authorId | Uuid → User | ✓ | IX | Restrict |
| featuredImageId | Uuid → Media | | | SetNull |
| status | `ArticleStatus` | ✓ | IX | Default `DRAFT`. |
| publishAt | DateTime | | IX | Wajib bila `SCHEDULED`. |
| publishedAt | DateTime | | IX | Tanggal yang ditampilkan publik (menggantikan `date`). |
| wordCount | Int | ✓ | | Diturunkan saat simpan; ditampilkan "Kata: 612". |
| deletedAt | DateTime | | IX | Trash |

Format `content` (Zod di `@ornament/shared`):

```ts
type ArticleBlock =
  | { id: string; type: "paragraph"; text: RichInline[] }
  | { id: string; type: "heading2"; text: string }
  | { id: string; type: "quote"; text: string; cite?: string }
  | { id: string; type: "image"; mediaId: string; caption?: string };
// RichInline = teks dengan mark bold/italic/link(href)
```

#### ArticleTag

`articleId` (Cascade) + `tagId` (Cascade). PK komposit.

#### Comment

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| articleId | Uuid → Article | ✓ | IX(articleId, status, createdAt) | Cascade (hanya berlaku saat artikel dihapus permanen). |
| parentId | Uuid → Comment | | IX | Cascade. Dipakai untuk "Balas" dari admin; nesting maksimal 1 tingkat. |
| authorName | String | ✓ | | |
| authorEmail | String | | | 🔒 **Wajib untuk komentar pengunjung** (Q9), tidak pernah tampil publik. Null hanya untuk balasan admin atau setelah dianonimkan (CHECK `authorUserId IS NOT NULL OR authorEmail IS NOT NULL OR anonymizedAt IS NOT NULL`). |
| authorUserId | Uuid → User | | | SetNull. Terisi bila yang menulis admin (balasan). |
| body | String | ✓ | | Teks polos, maks 2000 karakter. |
| status | `CommentStatus` | ✓ | IX | Default `PENDING`. Balasan admin langsung `APPROVED` dan menyetujui induk yang masih `PENDING` (§6.8). |
| moderatedById | Uuid → User | | | SetNull |
| moderatedAt | DateTime | | | |
| ipHash | String | | | 🔒 Untuk rate limit/anti-spam, bukan IP mentah. Dikosongkan setelah 30 hari (§6.11). |
| userAgent | String | | | 🔒 Dikosongkan bersama `ipHash`. |
| anonymizedAt | DateTime | | IX | Diisi saat data pribadi dianonimkan (§6.11). |

### 3.7 Inquiry

#### Inquiry

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| number | Int | ✓ | UK | `@default(autoincrement())` |
| reference | String | ✓ | UK | `INQ-0001` (§6.5) |
| subject | String | ✓ | | Dihasilkan otomatis (§6.5). |
| name | String | ✓ | | |
| company | String | | | |
| email | String | | IX | 🔒 Wajib saat submit; null hanya setelah dianonimkan (CHECK `email IS NOT NULL OR anonymizedAt IS NOT NULL`). |
| country | String | | | Negara tujuan. Teks bebas sekarang; ISO-3166 sebagai opsi nanti. |
| categoryId | Uuid → Category | | | SetNull. Null = "Belum menentukan". |
| categoryLabel | String | | | Snapshot nama kategori saat submit. |
| materialId | Uuid → Material | | | SetNull. Null = "Terbuka untuk saran". |
| materialLabel | String | | | Snapshot nama material. |
| volumeQuantity | Int | ✓ | | Form: "Volume (pcs)". |
| targetShipText | String | | | Teks bebas dari form ("Q3 2026", "Nov 2026", "Flexible / ASAP"), Q10. |
| targetShipDate | Date (`@db.Date`) | | IX | Diisi server bila `targetShipText` bisa dibaca sebagai tanggal (§6.5); null bila tidak. Bisa dikoreksi admin. |
| destinationPort | String | | | |
| budgetPerUnitUsd | Decimal(10,2) | | | Opsional |
| message | String | | | "Detail proyek". Preview di daftar diturunkan (±120 karakter). |
| status | `InquiryStatus` | ✓ | IX(status, createdAt) | Default `NEW`. |
| readAt | DateTime | | | |
| completedAt | DateTime | | | |
| ipHash / userAgent | String | | | 🔒 Anti-spam. Dikosongkan setelah 30 hari (§6.11). |
| notificationMessageId / notificationError | String | | | Hasil kirim email notifikasi ke tim. |
| anonymizedAt | DateTime | | IX | Diisi saat data pribadi dianonimkan (§6.11). |

Semua isi inquiry 🔒 dan tidak pernah diekspos ke publik. Respons submit publik
hanya mengembalikan `reference`.

#### InquiryReply 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| inquiryId | Uuid → Inquiry | ✓ | IX | Cascade |
| authorId | Uuid → User | ✓ | | Restrict |
| toEmail | String | | | Diambil dari `Inquiry.email` saat dikirim. Wajib selama inquiry belum dianonimkan (dicek API). |
| subject | String | ✓ | | Default `Re: <Inquiry.subject>`. |
| body | String | | | Wajib selama inquiry belum dianonimkan (dicek API); dikosongkan saat anonimisasi. |
| status | `ReplyStatus` | ✓ | IX | `DRAFT` → `SENT`/`FAILED` |
| sentAt | DateTime | | | |
| emailMessageId / emailError | String | | | Resend (ADR K4) |

#### InquiryAttachment 🔒

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| inquiryId | Uuid → Inquiry | ✓ | IX | Cascade |
| replyId | Uuid → InquiryReply | | IX | Cascade. **Null** = lampiran dari pembeli (gambar teknis/referensi); terisi = lampiran penawaran pada balasan. |
| mediaId | Uuid → Media | ✓ | | Restrict. `PRIVATE`; PDF/JPG/PNG, maks 10 MB. Dari pembeli maks 3 berkas per inquiry, diunggah lewat presigned `PUT` ke R2 (A5). |

### 3.8 Situs: halaman, navigasi, pengaturan, log

#### Page

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| title | String | ✓ | | "Beranda (Landing Page)" |
| path | String | ✓ | UK | `/`, `/our-story`, `/catalog`, `/terms`, `/kontak` |
| systemKey | String | | UK | `home`, `catalog`, `contact`, …: halaman yang punya route kode. Tidak bisa masuk Trash. |
| status | `PublishStatus` | ✓ | IX | |
| metaTitle / metaDescription | String | | | Opsional; bila kosong memakai `SiteSetting`. |
| updatedById | Uuid → User | | | SetNull |
| deletedAt | DateTime | | IX | Trash |

Kolom "Blok" diturunkan dari jumlah `PageBlock`. Kolom "Diperbarui" adalah
`updatedAt` (juga disentuh saat bloknya berubah).

#### PageBlock

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| pageId | Uuid → Page | | IX(pageId, position) | Cascade. **Null ⇔ `visibility = GLOBAL`** (CHECK constraint). |
| type | `BlockType` | ✓ | | Tetap; admin tidak membuat tipe baru (ADR K11). |
| name | String | ✓ | | Label di builder, mis. "Hero — Good Value". |
| visibility | `BlockVisibility` | ✓ | | |
| position | Int | ✓ | | Urutan dalam halaman. Blok global dirender di akhir, diurutkan dengan field ini. |
| layout | `BlockLayout` | ✓ | | Default `LEFT`. |
| title | String | | | |
| body | String | | | |
| cta1Label / cta1Url | String | | | |
| cta2Label / cta2Url | String | | | |
| imageId | Uuid → Media | | | SetNull |
| config | Json | | | Opsi khusus tipe, mis. `{ productCount: 6 }` untuk PRODUCT_PREVIEW. |

URL CTA boleh berupa path internal (`/kontak`) atau `https://…`. Selain itu ditolak.

Blok global (Q2) dirender di semua halaman dan bisa diedit dari halaman mana pun;
perubahannya langsung berlaku di seluruh halaman. `isGlobal` di DTO diturunkan dari
`pageId = null` agar editor menampilkan badge/peringatan "Blok ini bersifat global
dan akan memengaruhi seluruh halaman."

#### NavItem

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| label | String | ✓ | | |
| type | `NavItemType` | ✓ | | |
| pageId | Uuid → Page | | | Cascade. Wajib bila `PAGE`. |
| categoryId | Uuid → Category | | | Cascade. Wajib bila `CATEGORY`. |
| url | String | | | Wajib bila `CUSTOM_LINK`. Untuk tipe lain diturunkan. |
| style | `NavItemStyle` | ✓ | | `BUTTON` untuk "Consult Your Project". |
| position | Int | ✓ | IX | |

Menu hanya satu tingkat, sesuai UI.

#### SiteSetting (singleton)

| Field | Tipe | Wajib | Catatan |
| --- | --- | --- | --- |
| id | Int | ✓ | PK, selalu `1` (CHECK). |
| siteName | String | ✓ | |
| tagline | String | | |
| contactEmail | String | ✓ | Menggantikan `NEXT_PUBLIC_CONTACT_EMAIL`. |
| instagramHandle / instagramUrl | String | | |
| siteLanguage | `SiteLanguage` | ✓ | |
| timezone | String | ✓ | IANA, default `Asia/Jakarta`. |
| address | String | | Alamat workshop (publik). |
| logoId / iconId | Uuid → Media | | SetNull |
| seoHomeTitle | String | | |
| seoKeywords | String | | |
| seoDescription | String(160) | | |
| sitemapEnabled | Boolean | ✓ | Default `true`. |
| allowIndexing | Boolean | ✓ | Default `true`. `false` = noindex. |
| lowStockThreshold | Int | ✓ | Default `10` (≥0). Ambang Low Stock global bila `Product.lowStockThreshold` null (Q13). 🔒 |
| updatedById | Uuid → User | | SetNull |

#### SlugRedirect

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| type | `SlugRedirectType` | ✓ | UK(type, fromSlug) | |
| fromSlug | String | ✓ | | Slug lama. |
| productId | Uuid → Product | | IX | Cascade. Wajib bila `PRODUCT`. |
| articleId | Uuid → Article | | IX | Cascade. Wajib bila `ARTICLE`. |
| createdAt | DateTime | ✓ | | |

CHECK: tepat satu dari `productId`/`articleId` terisi sesuai `type`. Redirect menunjuk
**entitas**, bukan slug baru, sehingga tidak pernah ada rantai redirect (§6.10, Q8).

#### ActivityLog

| Field | Tipe | Wajib | Indeks | Catatan |
| --- | --- | --- | --- | --- |
| id | Uuid | ✓ | PK | |
| kind | `ActivityKind` | ✓ | IX | Label feed: Produk, QC, Inquiry, … |
| action | String | ✓ | | Kode, mis. `product.published`, `inquiry.created`. |
| message | String | ✓ | | Teks siap tampil, dibuat saat kejadian. |
| actorId | Uuid → User | | IX | SetNull. Null = "Sistem" (submit publik, job). |
| entityType | String | | IX(entityType, entityId) | `Product`, `Inquiry`, … (polimorfik, tanpa FK). |
| entityId | Uuid | | | |
| metadata | Json | | | |
| createdAt | DateTime | ✓ | IX | |

Hanya bisa ditambah (append-only) oleh aplikasi. Pengecualian: job retensi menghapus
baris berumur lebih dari 12 bulan (Q12), dan anonimisasi mengganti `message`/`metadata`
log yang merujuk inquiry/komentar terkait (§6.11).

## 4. Enum

| Enum | Nilai (kode → label UI) |
| --- | --- |
| UserRole | `ADMINISTRATOR` Administrator · `EDITOR` Editor · `CONTRIBUTOR` Contributor |
| UserStatus | `ACTIVE` · `REVOKED` |
| MediaVisibility | `PUBLIC` · `PRIVATE` |
| MediaKind | `IMAGE` Gambar · `DOCUMENT` Dokumen |
| PublishStatus | `DRAFT` Draft · `PUBLISHED` Published (Product, Page) |
| StockStatus | `IN_STOCK` In Stock · `LOW_STOCK` Low Stock · `MADE_TO_ORDER` Made to Order (dipakai `stockStatus` dan `stockStatusOverride`) |
| QcStage | `MATERIAL` · `FRAME` · `FINISHING` · `PACKAGING` |
| QcStatus | `PENDING` (belum) · `IN_PROGRESS` proses · `PASSED` ✓ · `FAILED` |
| ArtisanStatus | `VERIFICATION` Verifikasi · `ACTIVE` Aktif · `FULL_CAPACITY` Kapasitas penuh |
| ArtisanDocumentKind | `PARTNERSHIP_AGREEMENT` Perjanjian kerja sama · `MATERIAL_ORIGIN` Catatan asal material · `OTHER` |
| ArticleStatus | `DRAFT` · `SCHEDULED` · `PUBLISHED` |
| CommentStatus | `PENDING` Menunggu · `APPROVED` Disetujui · `SPAM` Spam · `DELETED` Terhapus |
| InquiryStatus | `NEW` Baru (tab "Belum dibaca") · `IN_PROGRESS` Diproses ("Ditindaklanjuti") · `DONE` Selesai |
| ReplyStatus | `DRAFT` · `SENT` · `FAILED` |
| BlockType | `HERO` · `STORY` · `PRODUCT_PREVIEW` · `PROCESS` · `TERMS` · `FOOTER` · `TESTIMONIAL` · `RICH_TEXT` |
| BlockVisibility | `ACTIVE` Aktif · `GLOBAL` Global · `HIDDEN` Tersembunyi |
| BlockLayout | `LEFT` Kiri · `CENTER` Tengah · `BLEED` Bleed |
| NavItemType | `PAGE` Halaman · `CATEGORY` Kategori · `ARTICLE_ARCHIVE` Arsip · `CUSTOM_LINK` Tautan khusus |
| NavItemStyle | `LINK` · `BUTTON` Tombol |
| SiteLanguage | `ID` Bahasa Indonesia · `EN` English · `BILINGUAL` Dwibahasa |
| ActivityKind | `PRODUCT` · `QC` · `INQUIRY` · `ARTICLE` · `ARTISAN` · `COMMENT` · `PAGE` · `MEDIA` · `USER` · `SETTING` |
| SlugRedirectType | `PRODUCT` · `ARTICLE` |

Kategori artikel tidak lagi berupa enum; lihat tabel `ArticleCategory` (§3.3).

## 5. Relasi & aturan hapus

| Relasi | onDelete | Alasan |
| --- | --- | --- |
| Session/Invite → User | Cascade / Restrict | Sesi ikut user. User tidak dihapus (status `REVOKED`). |
| Category → Category (parent) | Restrict | Pindahkan atau hapus anak lebih dulu. |
| Product → Category | Restrict | Kategori yang masih punya produk (termasuk di Trash) tidak bisa dihapus; error menyebut jumlah produknya (Q5). |
| Article → ArticleCategory | Restrict | Sama dengan kategori produk: pindahkan artikel (termasuk di Trash) lebih dulu. |
| SlugRedirect → Product/Article | Cascade | Redirect ikut terhapus saat entitas di-purge. |
| Product → Artisan | Restrict | Pengrajin diarsipkan, tidak dihapus. |
| ProductMaterial → Material | Restrict | Material yang masih dipakai tidak bisa dihapus. |
| ProductTag/ArticleTag → Tag | Cascade | Menghapus tag cukup melepasnya dari konten. |
| ProductImage/Spec/QcCheck/Revision/Material/Tag → Product | Cascade | Hanya terpicu saat produk dihapus **permanen**. |
| *Image/*Document/InquiryAttachment → Media | Restrict | Media yang masih dipakai tidak bisa dihapus permanen. |
| Product.primaryImage, Article.featuredImage, Artisan.photo, PageBlock.image, SiteSetting.logo/icon → Media | SetNull | Hanya terpicu saat purge; API menolak memindahkan ke Trash media yang masih dipakai konten yang terbit. |
| Article → User (author) | Restrict | |
| Comment → Article | Cascade | Ikut purge artikel. |
| Comment → Comment (parent) | Cascade | |
| InquiryReply/InquiryAttachment → Inquiry | Cascade | Inquiry tidak dihapus lewat UI (retensi memakai anonimisasi, §6.11); Cascade hanya untuk pembersihan data manual. |
| Inquiry → Category/Material | SetNull | Snapshot label tetap ada. |
| PageBlock → Page | Cascade | |
| NavItem → Page/Category | Cascade | Item menu yang targetnya hilang ikut terhapus. |
| ActivityLog.actor, *.createdBy/updatedBy/checkedBy/moderatedBy | SetNull | |

**Soft delete:** `Product`, `Article`, `Page`, `Media` (`deletedAt`). `Artisan`
diarsipkan (`archivedAt`). `Comment` memakai status `DELETED`. `User` memakai status
`REVOKED`. Semua query publik dan query daftar admin default menyaring `deletedAt IS NULL`.

## 6. Aturan bisnis

### 6.1 Slug
- Dibuat server dari `name`/`title`: huruf kecil, `[^a-z0-9]+` → `-`, tanpa `-` di
  awal/akhir, maks 80 karakter. Frontend hanya menampilkan pratinjau.
- Unik per tabel (`Product`, `Article`, `Artisan`, `Category`, `Material`, `Tag`),
  **termasuk baris di Trash**, supaya pemulihan tidak pernah bentrok. Bila bentrok,
  tambahkan akhiran `-2`, `-3`, dan seterusnya.
- Slug tidak berubah otomatis setelah pertama kali terbit (URL publik stabil).
  Perubahan manual oleh Editor+ diizinkan; slug lama produk dan artikel dicatat di
  `SlugRedirect` untuk redirect 301 (§6.10, Q8).

### 6.2 SKU
- `sku` **boleh null saat draf** (A4) dan **wajib saat publish**. Bisa diisi dan
  diedit manual oleh siapa pun yang boleh mengedit produk itu (Q6). Dinormalisasi
  huruf besar, pola `^[A-Z0-9]+(-[A-Z0-9]+)*$`, maks 32 karakter.
- Unik (constraint DB, termasuk baris di Trash). Bentrok → error `CONFLICT` pada `sku`.
- **Saran otomatis** (dipakai UI untuk mengisi field yang kosong; server tidak mengisi
  diam-diam):
  - Ada material primer dengan `skuCode` → `ORN-<skuCode>-<NNNN>`, mis. `ORN-RTN-0142`.
  - Tidak ada → `ORN-<YYMM>-<NNNN>` (tahun-bulan saat saran dibuat, zona
    `SiteSetting.timezone`), mis. `ORN-2609-0143`.
  - `NNNN` dari sequence Postgres global (padding minimal 4 digit) dan tidak pernah
    dipakai ulang, sehingga saran praktis tidak bentrok. Nilai `ORN-NEW-xxxx` dari UI
    saat ini tidak dipakai.
- SKU **tidak berubah otomatis** saat material primer diganti. Setelah purge, SKU
  manual boleh dipakai lagi; nomor sequence tidak.

### 6.3 Produk: publikasi, stok, revisi, duplikat
- **Syarat publish:** `name`, `sku`, `categoryId`, `artisanId`, `primaryImageId`,
  material primer, `moqQuantity`, dan artisan tidak diarsipkan.
- Publik hanya menampilkan `publishStatus = PUBLISHED AND deletedAt IS NULL`.
  Produk dari artisan berstatus `VERIFICATION` tetap tampil bila sudah publish.
  Halaman artisan sendiri disembunyikan (§6.7).
- **Status stok (Q13):** `stockStatus` dihitung server setiap simpan:
  1. `stockStatusOverride` terisi → nilai itu.
  2. `stockQuantity` null → `MADE_TO_ORDER`.
  3. `stockQuantity <= COALESCE(lowStockThreshold, SiteSetting.lowStockThreshold)` →
     `LOW_STOCK`.
  4. Selain itu → `IN_STOCK`.
  Mengubah `SiteSetting.lowStockThreshold` menghitung ulang `stockStatus` semua produk
  tanpa override dan tanpa ambang sendiri dalam satu transaksi, lalu merevalidasi katalog.
- **Validasi stok (A11):** hanya status efektif `MADE_TO_ORDER` ⇒ `stockQuantity = null`.
  Tidak ada validasi lain (mis. override `IN_STOCK` dengan jumlah 0 tetap boleh).
  Teks stok di tabel ("84 unit siap kirim", "Lead time 45 hari") diturunkan, bukan disimpan.
- **Revisi:** setiap simpan yang mengubah isi menjalankan `revision += 1` dan
  menulis `ProductRevision` (snapshot sesudah perubahan) dalam satu transaksi.
  Pemulihan ke revisi lama belum ada di UI.
- **Duplikat:** membuat produk baru dengan `name + " (copy)"`, slug unik baru
  (`<slug>-copy`, `-copy-2`, …), `sku = null` (diisi ulang lewat saran sebelum
  publish, karena SKU unik), `publishStatus = DRAFT`, `revision = 1`, dan
  `duplicatedFromId`. Yang ikut disalin: material, tag, spesifikasi, galeri (merujuk
  Media yang sama), foto utama, artisan, kategori, pengaturan stok, dan field inti.
  Checklist QC direset ke `PENDING` = belum dicek (Q6).
- **Aksi massal** yang baru: "Terbitkan", "Jadikan Draft", "Pindahkan ke Trash".
  Aksi lama "Tandai In Stock" dipecah menjadi aksi publikasi dan ubah stok
  terpisah (lihat §7).

### 6.4 Trash 30 hari
- Memindahkan ke Trash = mengisi `deletedAt = now()`. Pulihkan = `deletedAt = null`
  **dan selalu kembali ke `DRAFT`** (Q3), agar konten usang tidak tayang tanpa
  diperiksa ulang:
  - `Product`: `publishStatus = DRAFT` (`publishedAt` dipertahankan).
  - `Article`: `status = DRAFT`, `publishAt = null` (`publishedAt` dipertahankan).
  - `Page`: `status = DRAFT`.
  - `Media` tidak punya status terbit; pemulihan hanya mengosongkan `deletedAt`.
- Karena pemulihan tidak pernah menayangkan konten, Contributor boleh memulihkan
  konten miliknya sendiri (A1).
- Job harian menghapus permanen `Product`/`Article`/`Page` dengan
  `deletedAt < now() - 30 hari`. `Media` di-purge dengan batas yang sama **dan**
  hanya bila tidak lagi dirujuk; objek R2 dihapus setelah baris DB terhapus.
- Setelah purge, slug dan SKU manual bebas dipakai lagi; nomor sequence SKU tidak
  pernah dipakai ulang (§6.2). Redirect slug entitas yang di-purge ikut terhapus.
- Pemindahan ke Trash dan pemulihan dicatat di `ActivityLog`. Pemindahan konten
  terbit ke Trash memicu revalidasi Next; pemulihan tidak perlu karena hasilnya draf.
- Hapus permanen manual hanya oleh Administrator (A3).

### 6.5 Inquiry
- `number` dari sequence. `reference = "INQ-" + lpad(number, 4, "0")` diisi dalam
  transaksi yang sama. Setelah 9999 panjangnya bertambah tanpa dipotong.
- `subject` dihasilkan saat submit dan tidak bisa diedit:
  `"<materialLabel ?? categoryLabel ?? 'Permintaan produk'> — <volumeQuantity> pcs"`,
  contoh "Rotan alami — 400 pcs". Bila kategori dan material sama-sama terisi:
  `"<categoryLabel> <materialLabel> — 400 pcs"`.
- Transisi status: `NEW → IN_PROGRESS` otomatis saat balasan pertama `SENT`.
  `NEW|IN_PROGRESS → DONE` lewat "Tandai selesai" (mengisi `completedAt`).
  `DONE → IN_PROGRESS` diizinkan bila ada balasan baru.
- Balasan: disimpan `DRAFT` lebih dulu, lalu dikirim via Resend **setelah commit**.
  Hasilnya `SENT` dengan `emailMessageId`, atau `FAILED` dengan `emailError`, dan bisa
  dikirim ulang. Balasan yang terkirim tidak bisa diedit.
- Submit publik: validasi `name`, `email`, dan `volumeQuantity > 0`, rate limit per
  `ipHash`, lampiran maks 3 berkas × 10 MB (A5). Honeypot terisi → respons sukses
  palsu tanpa menyimpan apa pun (A6). Setelah itu buat `ActivityLog` (actor null) dan
  kirim email notifikasi ke `SiteSetting.contactEmail`.
- **Target kirim (Q10):** `targetShipText` disimpan apa adanya. Server mengisi
  `targetShipDate` bila teks cocok salah satu pola, memakai awal periode:
  `YYYY-MM-DD` → tanggal itu; `YYYY-MM`, "Nov 2026", "November 2026" → tanggal 1 bulan
  itu; "Q3 2026" → tanggal 1 kuartal itu. Teks relatif/tidak jelas ("ASAP",
  "Early next month", "Flexible") → null. Admin boleh mengoreksi `targetShipDate`.
- Inquiry yang sudah dianonimkan tidak bisa dibalas atau dikirimi balasan (§6.11).

### 6.6 Artikel: publikasi terjadwal (ADR K8)
- **Syarat jadwal/publish:** `title`, `categoryId`, `content` tidak kosong, dan alt pada
  gambar.
- `SCHEDULED` membutuhkan `publishAt > now()` saat disimpan. `PUBLISHED` langsung
  mengisi `publishedAt = now()` bila kosong.
- **Draf cepat dashboard (Q1):** "Judul + Catatan" membuat `Article` `DRAFT` milik
  pengguna itu, dengan catatan sebagai blok `paragraph` pertama dan `categoryId` null.
  UI lalu menampilkan toast/tautan ke `/admin/articles/<id>`.
- Status dianggap terbit oleh query publik bila
  `status = PUBLISHED OR (status = SCHEDULED AND publishAt <= now())`, dan
  `deletedAt IS NULL`.
- Job 60 detik: `SCHEDULED → PUBLISHED`, `publishedAt = publishAt`, lalu revalidasi.
- Contributor hanya boleh membuat, mengedit, dan memindahkan ke Trash **draf miliknya
  sendiri** (`Article.authorId` / `Product.createdById`, A1). Menjadwalkan dan
  menerbitkan butuh Editor+ (juga berlaku untuk publish produk).

### 6.7 Pengrajin
- Artisan baru selalu `VERIFICATION`. Halaman publik `/pengrajin/<slug>` hanya untuk
  `ACTIVE`/`FULL_CAPACITY` dan `archivedAt IS NULL`.
- DTO publik **tidak** memuat `contactName`, `phone`, `address`, `internalNotes`,
  dokumen, ataupun Media `PRIVATE`.
- Statistik publik ("14 produk aktif") diturunkan dari produk yang terbit.
- Contributor hanya bisa melihat, tanpa field 🔒 (tabel hak akses: "Lihat").
- **Arsip dengan produk terbit (A10):** diizinkan, dengan peringatan jumlah produk
  terbit. Produknya tetap tayang; di detail produk publik pengrajin tampil ringkas
  **tanpa tautan** (`slug = null`) sehingga tidak mengarah ke halaman 404.

### 6.8 Komentar
- Submit publik → `PENDING`. Wajib `authorName`, `authorEmail`, dan `body` (Q9). Hanya
  `APPROVED` yang tampil. Hitungan "Diskusi (n)" = jumlah komentar `APPROVED`.
- Avatar komentar di publik = inisial `authorName`; **tanpa Gravatar** (Q9), sehingga
  hash email tidak pernah dikirim ke pihak ketiga.
- Honeypot terisi → sukses palsu tanpa menyimpan (A6).
- Balasan admin langsung `APPROVED`; bila komentar induk masih `PENDING`, induk ikut
  menjadi `APPROVED` dalam transaksi yang sama (A7).
- `DELETED` adalah soft delete (tidak tampil di tab mana pun). `SPAM` bisa dikembalikan
  ke `APPROVED`.
- Komentar pada artikel yang belum/tidak terbit ditolak.
- Contributor tidak punya akses komentar sama sekali (A2).

### 6.9 Lain-lain
- Login: email `@ornament.id` **dan** `User.status = ACTIVE` (ADR K7). Ganti kata
  sandi mencabut semua sesi lain; daftar sesi per perangkat ditunda (A8).
- Page `systemKey` tidak bisa masuk Trash atau diubah `path`-nya.
- Page Builder: Contributor hanya baca (A2).
- Menyimpan `SiteSetting`, `NavItem`, `Page`/`PageBlock` memicu revalidasi tag Next yang terkait.
- Setiap aksi admin yang tampil di feed menulis `ActivityLog` dalam transaksi yang sama.

### 6.10 Redirect slug lama (Q8)
- Berlaku untuk `Product` dan `Article`. `Page` tidak memakai slug (URL-nya `path`, dan
  halaman sistem tidak bisa diubah path-nya), dan `Artisan` belum termasuk.
- Saat slug berubah, dalam transaksi yang sama: sisipkan `SlugRedirect(type, fromSlug =
  slug lama, entitas)`; hapus redirect bertipe sama yang `fromSlug`-nya sama dengan
  slug baru (slug aktif selalu menang).
- Membuat entitas dengan slug yang tercatat sebagai `fromSlug` juga menghapus redirect
  itu. `fromSlug` tetap tidak boleh sama dengan slug aktif entitas lain.
- Resolusi publik: bila `/produk/<slug>` atau `/journal/<slug>` tidak ditemukan, Next
  menanyakan redirect. Redirect hanya dikembalikan bila entitas tujuan sedang tayang
  publik; selain itu 404. Next melayani `301` ke slug terkini.

### 6.11 Retensi data & anonimisasi (Q11, Q12)
- **IP hash:** job harian mengosongkan `ipHash` dan `userAgent` pada `Inquiry` dan
  `Comment` yang `createdAt < now() - 30 hari`.
- **Inquiry:** dianonimkan otomatis 24 bulan setelah aktivitas terakhir
  (`COALESCE(balasan SENT terakhir, completedAt, createdAt)`).
- **Komentar:** dianonimkan otomatis 24 bulan setelah `createdAt`.
- **Anonimisasi manual:** aksi "Anonymize data pribadi" di admin inquiry dan komentar
  (Administrator saja, karena tidak bisa dibatalkan, sejalan dengan A3). Bisa
  diperluas ke semua inquiry & komentar dengan email yang sama (hak GDPR untuk dihapus).
- **Isi anonimisasi** (idempoten, satu transaksi, mengisi `anonymizedAt`):
  - `Inquiry`: `name = "Dianonimkan"`; `email`, `company`, `message`,
    `destinationPort`, `targetShipText`, `ipHash`, `userAgent`, `notificationError`
    → null. Yang dipertahankan untuk laporan: `number`, `reference`, `subject`,
    `country`, kategori/material, `volumeQuantity`, `budgetPerUnitUsd`,
    `targetShipDate`, status, dan tanggal.
  - `InquiryReply` milik inquiry itu: `toEmail`, `body` → null (subject tetap).
  - `InquiryAttachment` (pembeli dan balasan) dihapus; Media-nya dipurge beserta objek R2.
  - `Comment`: `authorName = "Anonim"`; `authorEmail`, `ipHash`, `userAgent` → null.
    Bila status bukan `APPROVED`, `body` juga dikosongkan (`""`).
  - `ActivityLog` dengan `entityType`/`entityId` yang sama: `message` diganti teks
    generik (mis. "Inquiry INQ-0043 (dianonimkan)"), `metadata = null`.
- **ActivityLog:** job harian menghapus baris `createdAt < now() - 12 bulan`.
- Job retensi berjalan harian in-process bersama purge Trash (pola ADR K8) dan bisa
  dipicu lewat endpoint internal. Aksi anonimisasi dicatat di `ActivityLog` tanpa data
  pribadi.

## 7. Pemetaan dari tipe frontend lama

### Product (`frontend/lib/types.ts`)

| Lama | Baru | Perubahan |
| --- | --- | --- |
| `slug`, `name`, `sku` | sama | `sku` nullable, diedit manual dengan saran server (§6.2). |
| `category: "Lighting" \| …` | `categoryId` → `Category` | Union hardcoded diganti tabel hierarkis. |
| `material: string` | `ProductMaterial[]` (+ `isPrimary`) → `Material` | Satu string diganti M:N. |
| `origin: string` | turunan `artisan.village`, `artisan.regency` | Dihapus dari produk. |
| `moq: "50 pcs"` | `moqQuantity` + `moqUnit` | Dipecah. |
| `status: StockStatus` (termasuk "Draft") | `publishStatus` + `stockStatus` (turunan) + `stockStatusOverride` | **Dipisah**; `"Draft"` pindah ke `publishStatus`. Status stok otomatis (§6.3). |
| `stock: "84 unit siap kirim"` | `stockQuantity` (+ `lowStockThreshold` 🔒, `stockNote` 🔒) | Teks diturunkan. |
| — (form editor) | `description`, `leadTimeDays`, `lengthCm/widthCm/heightCm`, `weightKg`, `fobPriceUsd`, `fobPort` | **Ditambah** |
| — | `SlugRedirect[]` | **Ditambah** (Q8) |
| — (form editor) | `primaryImageId`, `ProductImage[]`, `ProductTag[]`, `artisanId`, `revision`, `deletedAt`, `publishedAt`, `excerpt`, `duplicatedFromId` | **Ditambah** |
| `PRODUCT_SPEC` (global) | field inti + `ProductSpec[]` per produk | Dari global jadi per produk. |
| `QC_POINTS` (global) | `ProductQcCheck[]` (stage, status, criteria) per produk | Dari global jadi per produk, dengan status. |

Tab admin "Published/Draft" memakai `publishStatus`. Filter "daerah" memakai
`artisan.regency`. Aksi massal "Tandai In Stock" menjadi "Terbitkan".

### Artisan

| Lama | Baru | Perubahan |
| --- | --- | --- |
| `slug`, `name`, `status` | sama | Status jadi kode enum. |
| `initial` | — | Diturunkan dari `name` di frontend. |
| `craft` | `skills[0]` | Jadi array. |
| `place: "Bangunjiwo, Bantul"` | `village` + `regency` + `province` | Dipecah. |
| `since: "mitra sejak 2018"` | `partnerSinceYear: 2018` | Teks diganti Int. |
| `capacity: "600 pcs"` | `monthlyCapacity` + `capacityUnit` | Dipecah. |
| `note` | `summary` (publik) | Diganti nama. `internalNotes` 🔒 terpisah. |
| — | `contactName`🔒, `phone`🔒, `address`🔒, `craftsmenCount`, `avgLeadTimeDays`, `story`, `photoId`, `ArtisanImage[]`, `ArtisanDocument[]`🔒, `archivedAt` | **Ditambah** |

### Article

| Lama | Baru | Perubahan |
| --- | --- | --- |
| `slug`, `title`, `excerpt` | sama | |
| `category` (union) | `categoryId` → `ArticleCategory` | Union diganti tabel (Q4). |
| `date: "26 Agu 2026"` | `publishedAt` / `publishAt` | Teks diganti timestamp. |
| `author: string` | `authorId` → `User` | Relasi. |
| `tags: string[]` | `ArticleTag[]` → `Tag` | Tabel. |
| `paragraphs: string[]` | `content: ArticleBlock[]` | Blok bertipe (paragraph/heading2/quote/image). |
| `status` | `status: ArticleStatus` | Kode enum. |
| — | `featuredImageId`, `wordCount`, `deletedAt` | **Ditambah** |

### Comment (`Comment` + `ADMIN_COMMENTS`)

| Lama | Baru | Perubahan |
| --- | --- | --- |
| `name`, `text` | `authorName`, `body` | Diganti nama. |
| `initial`, `when` | — | Diturunkan dari `authorName`, `createdAt`. |
| `post` (judul, admin) | `articleId` → `Article` | Relasi. |
| `status` (admin) | `status: CommentStatus` | Kode enum. |
| — (form publik) | `authorEmail` 🔒 (wajib), `parentId`, `authorUserId`, `moderatedById/At`, `ipHash` 🔒, `anonymizedAt` | **Ditambah** |

### Inquiry

| Lama | Baru | Perubahan |
| --- | --- | --- |
| `name`, `company`, `email`🔒 | sama | |
| `subject` | `subject` **dihasilkan** (§6.5) | Tidak lagi diisi bebas. |
| `preview` | — | Diturunkan dari `message`. |
| `body` | `message` | Diganti nama. |
| `when` | `createdAt` | |
| `status` | `InquiryStatus` kode | |
| `volume: "400 pcs"` | `volumeQuantity: 400` | Teks diganti Int. |
| `target` | `targetShipText` + `targetShipDate` | Diganti nama; tanggal diturunkan bila terbaca (Q10). |
| `port` | `destinationPort` | Diganti nama. |
| — (form publik) | `number`, `reference`, `country`, `categoryId/Label`, `materialId/Label`, `budgetPerUnitUsd`, `InquiryAttachment[]`, `anonymizedAt` | **Ditambah** |
| — (layar balas) | `InquiryReply[]`, `readAt`, `completedAt` | **Ditambah** |

### Konstanta `data.ts` lain

| Lama | Baru |
| --- | --- |
| `PRODUCT_CATEGORIES`, `CATEGORIES_TREE` | `Category` (count/indent diturunkan) |
| `MATERIALS`, `MATERIAL_TAGS` | `Material` (label hitungan & ukuran diturunkan) |
| `ARTICLE_CATEGORIES` | tabel `ArticleCategory` (seed awal) |
| `SITE_PAGES` | `Page` (`blocks`, `updated` diturunkan) |
| `BuilderBlock` / `BUILDER_BLOCKS` | `PageBlock`: `state`→`visibility`, `cta`→`cta1Label`, `link`→`cta1Url`, `cta2`→`cta2Label` (+`cta2Url`), `img`→`imageId`, `big`→`config`/`type HERO`; ditambah `type`, `layout`, `position` |
| `USERS` | `User` + `Invite` (`initial`, `content`, `tone` diturunkan; `last`→`lastActiveAt`) |
| `ROLE_CAPS` | aturan otorisasi di kode API, bukan tabel |
| `NAV_ITEMS` | `NavItem` (`type` "Tombol" → `style BUTTON`, "Arsip" → `ARTICLE_ARCHIVE`) |
| `COMPANY` | `SiteSetting` (kecuali `domain`, tetap env) |
| `ACTIVITY` | `ActivityLog` |
| `MILESTONES`, `PAYMENT_STAGES`, `TERMS_SECTIONS` | Tetap statis di frontend untuk fase ini (belum ada layar admin). Bisa dipindah ke `PageBlock.config`. |

## 8. Di luar cakupan

- **Preset tema dinamis** (tab "Tema": pilihan tema, warna aksen, font heading).
- **Pilihan struktur permalink** (tab "Permalink"): URL tetap `/produk/<slug>` dan
  `/journal/<slug>` (ADR K11).
- **Order produksi**: kartu dashboard "Order produksi", "Riwayat order" pengrajin,
  dan QC per batch.
- Membuat halaman/tipe blok baru di Page Builder, serta pratinjau viewport (ADR K11).
- Autosave dan versi draf halaman ("Tersimpan otomatis"). Satu versi `PageBlock` langsung tayang saat "Perbarui".
- "Unduh spec sheet" (PDF dibuat dari data produk).
- Reset kata sandi mandiri ("Lupa sandi?"): admin mengirim ulang undangan (ADR).
- Pemulihan produk ke revisi lama. (Redirect slug lama **masuk** cakupan, §6.10.)
- Gravatar atau avatar komentar dari layanan pihak ketiga (Q9: avatar = inisial).
- Notifikasi email ke pemberi komentar saat komentarnya dibalas (lihat §9.2).
- Daftar sesi aktif per perangkat / "keluar dari semua perangkat" (A8).
- Pencarian full-text (saat ini cukup `ILIKE` + indeks trigram opsional pada `name`/`sku`).
- Konten multibahasa, walaupun `siteLanguage` sudah disimpan.

## 9. Keputusan pemilik

### 9.1 Q1–Q15

Sumber: [komentar pemilik di PR #46](https://github.com/haritsrhn/ornament-project/pull/46#issuecomment-5714288028).
Semua pertanyaan terbuka sebelumnya sudah diputuskan dan diterapkan di dokumen ini (#48).

| ID | Keputusan | Dampak di model |
| --- | --- | --- |
| Q1 | Draf cepat dashboard membuat `Article` `DRAFT` (catatan = paragraf pertama); UI menautkan ke editor artikel. | Tanpa entitas baru. `Article.categoryId` boleh null saat draf (§3.6, §6.6). |
| Q2 | Blok global berlaku di semua halaman, dengan indikator visual jelas di editor. | Mekanisme D10 tetap; `isGlobal` di DTO untuk peringatan (§3.8). |
| Q3 | Pemulihan dari Trash selalu kembali ke `DRAFT`. | Berlaku untuk produk, artikel, halaman; Media hanya mengosongkan `deletedAt` (§6.4). |
| Q4 | Kategori artikel menjadi tabel `ArticleCategory`, dikelola di layar taksonomi yang sama (tipe Produk/Artikel). | Enum `ArticleCategory` dihapus; tabel baru + FK Restrict (§3.3, §5). |
| Q5 | Hapus kategori produk yang masih punya produk ditolak (Restrict), pesan menyebut jumlah produk. | Tetap Restrict; jumlah produk di detail error (kontrak API). |
| Q6 | SKU bisa diedit manual, unik, dengan saran otomatis bila kosong; duplikat mereset QC. | §6.2 ditulis ulang; duplikat `sku = null`, QC `PENDING` (§6.3). |
| Q7 | Harga FOB nullable dan tampil publik bila diisi; bila kosong UI menampilkan "Inquire for pricing". | `fobPriceUsd`/`fobPort` bukan 🔒 lagi (§3.5). |
| Q8 | Riwayat slug lama disimpan untuk redirect 301 (produk & artikel). | Tabel `SlugRedirect` (§3.8, §6.10); dikeluarkan dari "Di luar cakupan". |
| Q9 | Email komentar wajib, tidak tampil publik. **Tanpa Gravatar** di fase ini; avatar = inisial nama. | `authorEmail` wajib untuk pengunjung (§3.6, §6.8). |
| Q10 | Target kirim teks bebas, plus tanggal nullable bila formatnya terdeteksi. | `targetShipText` + `targetShipDate` (§3.7, §6.5). |
| Q11 | IP hash dianonimkan setelah 30 hari; inquiry & komentar disimpan 24 bulan; tombol "Anonymize data pribadi" di admin. | `anonymizedAt` pada `Inquiry`/`Comment`, job retensi, aturan anonimisasi (§6.11). |
| Q12 | ActivityLog dipangkas setelah 12 bulan lewat job. | §3.8, §6.11. |
| Q13 | Low Stock otomatis dari `stockQuantity <= lowStockThreshold` (default 10), dengan override manual. | `stockStatusOverride`, `Product.lowStockThreshold`, `SiteSetting.lowStockThreshold` (§6.3). |
| Q14 | Telepon, alamat detail, dan identitas pengrajin 100% privat. Publik hanya nama workshop, desa/kabupaten, keahlian, portofolio foto. | Sudah 🔒; tidak ada field baru (§3.4). |
| Q15 | Satu kategori utama per produk; pengelompokan silang lewat material & tag. | Tetap `categoryId` tunggal. |

Keputusan turunan yang diambil saat menerapkan (bisa dikoreksi saat review):

- Kategori artikel wajib hanya saat jadwal/publish, bukan saat draf (agar draf cepat Q1 tidak butuh default kategori).
- Fallback saran SKU tanpa material primer: `ORN-<YYMM>-<NNNN>` (mengikuti contoh pemilik), nomor tetap dari sequence global.
- Duplikat produk mengosongkan `sku` karena SKU unik.
- Ambang Low Stock: per produk (nullable) dengan fallback global `SiteSetting.lowStockThreshold = 10`; bukan "< MOQ".
- `stockQuantity` null tanpa override dianggap `MADE_TO_ORDER`.
- Redirect slug tidak mencakup `Page` (memakai `path`) dan `Artisan`.
- Retensi inquiry dihitung dari aktivitas terakhir; setelah 24 bulan data **dianonimkan**, bukan dihapus, agar statistik tetap ada.
- Anonimisasi manual hanya Administrator (tidak bisa dibatalkan, sejalan dengan A3); `ipHash` dan `userAgent` dikosongkan bersama.
- Contributor boleh memulihkan konten miliknya dari Trash karena hasilnya selalu draf.
- Enum `QcStatus` tetap memakai `PENDING` sebagai "belum dicek" (setara `UNCHECKED` di keputusan Q6).
- Nama field tetap `fobPriceUsd` (bukan `fobPrice`) agar mata uang eksplisit.

### 9.2 Perlu konfirmasi

1. **Identitas pengrajin (Q14):** pemilik menyebut KTP dan nomor rekening, tetapi layar
   admin belum punya field-nya. Apakah perlu kolom terstruktur (🔒, idealnya terenkripsi
   di level aplikasi), atau cukup diunggah sebagai `ArtisanDocument` (kind `OTHER`)?
2. **Notifikasi balasan komentar (Q9):** pemilik menyebut email dipakai untuk memberi tahu
   bila komentar dibalas. Fitur ini belum dimodelkan (butuh persetujuan/opt-in dan tautan
   berhenti langganan). Masuk fase ini atau ditunda?
