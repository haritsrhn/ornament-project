-- Pagination keyset journal publik (kontrak API §1.6, endpoint §5.3).
--
-- `GET /v1/public/articles` menyaring artikel terbit (ADR K8: `PUBLISHED`, atau
-- `SCHEDULED` yang `publish_at`-nya sudah lewat) lalu mengurutkannya
-- `COALESCE(published_at, publish_at) DESC, id DESC` — urutan yang juga menjadi
-- kunci kursornya. Tanggal tayangnya karena itu bukan satu kolom, sehingga
-- indeks biasa atas `published_at` tidak bisa melayaninya: setiap halaman harus
-- menyortir ulang seluruh artikel terbit.
--
-- Dua indeks ekspresi di bawah menyediakan urutan itu langsung:
--
--   1. `article_public_effective_at_idx`          — daftar journal tanpa filter,
--   2. `article_public_category_effective_at_idx` — daftar per kategori
--      (`?category=`), jalur paling sering dipakai di UI journal.
--
-- Keduanya **parsial** (`deleted_at IS NULL AND status <> 'DRAFT'`): draf dan
-- isi Trash tidak pernah tampil publik, jadi tidak perlu ikut diindeks. Sisa
-- syarat "terbit" (`publish_at <= now()`) bergantung waktu dan karena itu tidak
-- bisa masuk predikat indeks; ia tetap dievaluasi di query.
--
-- Filter tag (`?tag=`) memakai `EXISTS` atas `article_tag`, yang sudah dilayani
-- PK `(article_id, tag_id)` dan indeks `tag_id`.
--
-- Indeks ekspresi/parsial tidak bisa ditulis di `schema.prisma`, jadi ia berdiri
-- sebagai SQL manual — sama seperti blok constraint di migrasi awal (lihat
-- README §Constraint SQL manual). Hanya menambah indeks: tidak ada kolom atau
-- tabel yang berubah, dan migrasi lama tidak disentuh.

-- CreateIndex
CREATE INDEX "article_public_effective_at_idx"
  ON "article" (COALESCE("published_at", "publish_at") DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "status" <> 'DRAFT';

-- CreateIndex
CREATE INDEX "article_public_category_effective_at_idx"
  ON "article" ("category_id", COALESCE("published_at", "publish_at") DESC, "id" DESC)
  WHERE "deleted_at" IS NULL AND "status" <> 'DRAFT';
