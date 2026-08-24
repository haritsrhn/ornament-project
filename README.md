# Ornament Sourcing Agent

Monorepo untuk situs publik dan admin CMS Ornament Sourcing Agent.

```
frontend/                  Next.js (App Router) + TypeScript + Tailwind
backend/                   Belum diimplementasikan — lihat backend/README.md
design_handoff_ornament/   Referensi desain (tidak di-track git)
```

## Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000  ·  /admin untuk CMS
npm run build
npm run typecheck
```

Berisi 9 tampilan situs publik dan 16 layar admin CMS, dibangun dari paket
`design_handoff_ornament/`. Detail design system, routing, komponen, dan
perilaku responsif ada di [`frontend/README.md`](frontend/README.md).

**Cakupan saat ini: UI statis dan state interaksi frontend saja.** Tidak ada
backend, Prisma, database, atau autentikasi. Semua daftar dirender dari
`frontend/lib/data.ts`, dan setiap aksi "simpan" hanya mengubah state komponen
lalu menampilkan toast.

## Backend

Masih kosong. [`backend/README.md`](backend/README.md) mencatat server state,
endpoint, dan bentuk data yang tersirat dari desain, sebagai titik mulai fase
berikutnya.

## Deployment

Situs publik dan admin **dideploy pada domain terpisah**. Admin bersifat privat
dan tidak boleh punya tautan dari situs publik.

## Aset foto

Paket handoff tidak menyertakan foto. Setiap posisi gambar dirender lewat
komponen `ImageSlot` yang menjaga rasio dan radius, serta menampilkan deskripsi
foto yang seharusnya ada di situ. Ganti dengan `next/image` setelah foto dari
klien tersedia.
