-- Idempotensi submit publik (kontrak API §1.8).
--
-- `POST /v1/public/inquiries` dan `POST /v1/public/articles/:slug/comments`
-- mewajibkan header `Idempotency-Key`: Server Action membuat kunci saat form
-- dirender, sehingga klik ganda atau retry jaringan tidak boleh membuat baris
-- kedua. Server menyimpan `(key, method+route, ipHash) → status + body` selama
-- 24 jam dan memutar ulang respons yang sama.
--
-- Mengapa tabel baru dan bukan kolom di `inquiry`/`comment`:
--   1. barisnya harus ada **sebelum** baris domain dibuat — indeks unik di
--      tabel inilah yang memenangkan lomba antara dua request bersamaan;
--   2. respons yang diputar ulang bisa berupa respons yang tidak membuat baris
--      domain sama sekali (honeypot tidak sampai ke sini, tetapi kegagalan
--      validasi domain di masa depan bisa), jadi tidak ada baris yang bisa
--      "memiliki" kuncinya;
--   3. retensinya berbeda (24 jam) dari data domain, jadi pembersihannya juga.
--
-- `actor` menyimpan `ip_hash`, bukan IP mentah (model §6.11).

CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "idempotency_record" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- Satu kunci berlaku per (rute, pemanggil): kunci yang sama dari IP lain tidak
-- pernah bisa membaca respons milik orang lain.
CREATE UNIQUE INDEX "idempotency_record_scope_actor_key_key"
    ON "idempotency_record" ("scope", "actor", "key");

-- Untuk pembersihan baris kedaluwarsa.
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record" ("expires_at");
