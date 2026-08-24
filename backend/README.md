# Backend — belum diimplementasikan

Folder ini sengaja masih kosong. Fase saat ini hanya mencakup **UI statis dan
state interaksi frontend**; integrasi backend, Prisma, dan logika database
belum boleh ditulis.

Isi folder ini pada fase berikutnya. Catatan di bawah diambil dari bagian
*State Management* pada `design_handoff_ornament/README.md`, supaya kontrak
datanya tidak perlu diturunkan ulang dari awal.

## Yang perlu jadi server state (butuh API)

Produk, kategori & material, halaman + blok, pengrajin, artikel, media,
komentar, inquiry, dan pengaturan situs.

Sisanya — route aktif, kata kunci pencarian, tab status, filter terpilih, baris
terpilih untuk aksi massal, nomor halaman, isi form yang sedang diedit, pesan
validasi, blok terpilih di Page Builder, visibilitas dialog dan toast, indeks
slide carousel, status menu mobile — sudah ditangani di frontend sebagai client
state dan tidak perlu API.

## Endpoint yang tersirat dari desain

| Domain | Kebutuhan |
| --- | --- |
| Produk, kategori, halaman, pengrajin, artikel, media, pengguna | CRUD penuh |
| Komentar | List + update status (moderasi: menunggu / disetujui / spam) |
| Inquiry | List + update status, dan kirim balasan lewat email |
| Form kontak publik | Submit → membuat inquiry baru |
| Form komentar publik | Submit → masuk antrean moderasi |
| Autentikasi admin | Login dengan pembatasan domain email `@ornament.id` |

## Bentuk data

`frontend/lib/types.ts` sudah mendefinisikan `Product`, `Artisan`, `Article`,
`Comment`, dan `Inquiry` sesuai yang dirender UI. Pakai itu sebagai titik awal
skema, dan jadikan satu sumber tipe bersama saat API-nya ada.

`frontend/lib/data.ts` berisi data contoh dengan bentuk yang sama — berguna
sebagai fixture/seed, tapi isinya data mockup, bukan data operasional.
