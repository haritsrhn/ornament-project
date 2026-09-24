-- Satu berkas privat hanya boleh punya satu dokumen pengrajin (kontrak §5.8).
--
-- Aturan ini sudah ditegakkan API sejak Tahap 6 lewat pemeriksaan
-- `MEDIA_ALREADY_USED`, tetapi bentuknya `findFirst` lalu `create` di dalam
-- satu transaksi. Pada isolation level default, kedua statement itu tidak
-- mengambil kunci yang saling bertabrakan: dua Editor yang mengunggah
-- bersamaan — atau satu unggahan yang diklik dua kali — sama-sama melihat
-- `null` dan sama-sama berhasil menulis.
--
-- Akibatnya bukan sekadar baris ganda. `DELETE` dokumen memindahkan **Media**
-- miliknya ke Trash (§6.4), jadi menghapus salah satu dari dua dokumen kembar
-- membuat dokumen yang tersisa menunjuk berkas yang sudah di Trash, tanpa ada
-- yang memberi tahu.
--
-- Indeks unik memindahkan keputusan itu ke database, yang memang satu-satunya
-- pihak yang bisa menyelesaikan lomba. `@@index([media_id])` lama dihapus:
-- indeks unik melayani pencarian yang sama.

DROP INDEX IF EXISTS "artisan_document_media_id_idx";

CREATE UNIQUE INDEX "artisan_document_media_id_key" ON "artisan_document"("media_id");
