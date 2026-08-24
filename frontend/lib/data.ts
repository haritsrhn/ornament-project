/**
 * Sample content, transcribed from the design prototypes.
 *
 * This is mockup data — realistic but not operational; everything here needs
 * confirming before it goes live. There is no API here on purpose: this phase
 * is static UI only.
 *
 * The client's real contact details are NOT committed. They come from
 * NEXT_PUBLIC_* env vars (see .env.example) so this repo can stay public
 * without publishing a scrapable email address. The placeholders below are
 * what a fresh clone renders until .env.local is filled in.
 */
import type { Article, Artisan, Comment, Inquiry, Product } from "./types";

export const COMPANY = {
  name: "Ornament Sourcing Agent",
  tagline: "Good Value",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@example.com",
  instagram: process.env.NEXT_PUBLIC_INSTAGRAM_NAME ?? "Ornament Sourcing Agent",
  instagramHandle: process.env.NEXT_PUBLIC_INSTAGRAM_HANDLE ?? "@example",
  instagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL ?? "https://instagram.com",
  addressLines: (process.env.NEXT_PUBLIC_ADDRESS ?? "Bantul, Daerah Istimewa Yogyakarta, Indonesia").split(", "),
  domain: process.env.NEXT_PUBLIC_SITE_DOMAIN ?? "example.id",
};

export const PRODUCT_CATEGORIES = [
  "Semua",
  "Lighting",
  "Furniture",
  "Home Decor",
  "Basketry",
] as const;

export const MATERIALS = [
  "Rotan alami",
  "Jati reclaimed",
  "Bambu petung",
  "Water hyacinth",
  "Kayu suar",
  "Cangkang kelapa",
  "Rotan sega",
  "Serat pandan",
];

export const PRODUCTS: Product[] = [
  {
    slug: "bulan-pendant-lamp",
    name: "Bulan Pendant Lamp",
    sku: "ORN-RTN-0142",
    category: "Lighting",
    material: "Rotan alami",
    origin: "Bantul, Yogyakarta",
    moq: "50 pcs",
    status: "In Stock",
    stock: "84 unit siap kirim",
  },
  {
    slug: "akar-teak-console",
    name: "Akar Teak Console",
    sku: "ORN-TEK-0088",
    category: "Furniture",
    material: "Jati reclaimed",
    origin: "Jepara, Jawa Tengah",
    moq: "20 pcs",
    status: "Made to Order",
    stock: "Lead time 45 hari",
  },
  {
    slug: "tenun-basket-set",
    name: "Tenun Basket Set",
    sku: "ORN-WHY-0311",
    category: "Basketry",
    material: "Water hyacinth",
    origin: "Kulon Progo, Yogyakarta",
    moq: "100 set",
    status: "Low Stock",
    stock: "12 set tersisa",
  },
  {
    slug: "suar-serving-bowl",
    name: "Suar Serving Bowl",
    sku: "ORN-SUA-0207",
    category: "Home Decor",
    material: "Kayu suar",
    origin: "Gianyar, Bali",
    moq: "80 pcs",
    status: "In Stock",
    stock: "160 unit siap kirim",
  },
  {
    slug: "petung-room-divider",
    name: "Petung Room Divider",
    sku: "ORN-BMB-0029",
    category: "Furniture",
    material: "Bambu petung",
    origin: "Sleman, Yogyakarta",
    moq: "25 pcs",
    status: "Draft",
    stock: "Menunggu foto produk",
  },
  {
    slug: "kelapa-wall-mosaic",
    name: "Kelapa Wall Mosaic",
    sku: "ORN-COC-0175",
    category: "Home Decor",
    material: "Cangkang kelapa",
    origin: "Bantul, Yogyakarta",
    moq: "40 panel",
    status: "In Stock",
    stock: "48 panel siap kirim",
  },
  {
    slug: "sega-floor-lamp",
    name: "Sega Floor Lamp",
    sku: "ORN-RTN-0198",
    category: "Lighting",
    material: "Rotan sega",
    origin: "Bantul, Yogyakarta",
    moq: "50 pcs",
    status: "In Stock",
    stock: "36 unit siap kirim",
  },
  {
    slug: "pandan-placemat-set",
    name: "Pandan Placemat Set",
    sku: "ORN-PDN-0402",
    category: "Basketry",
    material: "Serat pandan",
    origin: "Sentolo, Kulon Progo",
    moq: "200 set",
    status: "In Stock",
    stock: "220 set siap kirim",
  },
];

/** Full specification panel on the product detail page. */
export const PRODUCT_SPEC = [
  { k: "Dimensi", v: "45 × 45 × 38 cm" },
  { k: "Material", v: "Rotan alami, rangka besi" },
  { k: "Finishing", v: "Natural clear coat" },
  { k: "MOQ", v: "50 pcs" },
  { k: "Lead time", v: "30 hari" },
  { k: "Harga FOB Semarang", v: "USD 42.00 / pcs" },
];

export const QC_POINTS = [
  { no: "01", title: "Material", body: "Diameter dan kadar air rotan dicatat sebelum penganyaman." },
  { no: "02", title: "Frame", body: "Dimensi rangka besi diukur terhadap gambar teknis." },
  { no: "03", title: "Finishing", body: "Warna dibandingkan dengan sampel yang disetujui pembeli." },
  { no: "04", title: "Packaging", body: "Uji jatuh, penandaan karton, dan hitung per kontainer." },
];

export const ARTISANS: Artisan[] = [
  {
    slug: "workshop-pak-slamet",
    initial: "S",
    name: "Workshop Pak Slamet",
    craft: "Anyaman rotan",
    place: "Bangunjiwo, Bantul",
    since: "mitra sejak 2018",
    capacity: "600 pcs",
    note: "Delapan penganyam, spesialis rangka lampu gantung dan kap besar dengan pola rapat.",
    status: "Aktif",
  },
  {
    slug: "jati-karya-jepara",
    initial: "J",
    name: "Jati Karya Jepara",
    craft: "Kayu solid",
    place: "Tahunan, Jepara",
    since: "mitra sejak 2016",
    capacity: "120 pcs",
    note: "Mengerjakan kayu jati reclaimed dengan dokumen asal lengkap untuk pasar Eropa.",
    status: "Aktif",
  },
  {
    slug: "kelompok-bu-tini",
    initial: "T",
    name: "Kelompok Bu Tini",
    craft: "Water hyacinth",
    place: "Sentolo, Kulon Progo",
    since: "mitra sejak 2026",
    capacity: "400 pcs",
    note: "Kelompok 14 perempuan penganyam; kapasitas 400 set keranjang per bulan.",
    status: "Verifikasi",
  },
  {
    slug: "bambu-sleman-craft",
    initial: "B",
    name: "Bambu Sleman Craft",
    craft: "Bambu petung",
    place: "Cangkringan, Sleman",
    since: "mitra sejak 2021",
    capacity: "90 pcs",
    note: "Workshop bambu petung dengan pengeringan oven sendiri.",
    status: "Aktif",
  },
  {
    slug: "suar-studio-gianyar",
    initial: "G",
    name: "Suar Studio Gianyar",
    craft: "Ukir kayu",
    place: "Tegallalang, Gianyar",
    since: "mitra sejak 2019",
    capacity: "250 pcs",
    note: "Spesialis bubut dan ukir kayu suar untuk peralatan saji.",
    status: "Kapasitas penuh",
  },
];

export const ARTICLES: Article[] = [
  {
    slug: "memilih-rotan-yang-benar-untuk-ekspor",
    title: "Memilih rotan yang benar untuk ekspor",
    category: "Craft Journal",
    date: "26 Agu 2026",
    author: "Sekar Ayu",
    excerpt:
      "Manau, sega, atau tohiti — perbedaan diameter dan kelenturan menentukan bentuk apa yang mungkin dibuat.",
    tags: ["rotan", "material", "seleksi"],
    paragraphs: [
      "Tidak semua rotan bisa dianyam menjadi bentuk yang sama. Manau tebal dan kaku, cocok untuk rangka; sega lentur dan halus, dipakai untuk anyaman badan; tohiti ada di antaranya.",
      "Kami menyeleksi ulang setiap ikat yang datang berdasarkan diameter dan kelenturan, karena satu batang yang terlalu kering akan patah justru saat anyaman hampir selesai.",
      "Untuk pembeli, konsekuensinya sederhana: bentuk yang Anda inginkan menentukan jenis rotan, dan jenis rotan menentukan MOQ serta lead time.",
    ],
    status: "Scheduled",
  },
  {
    slug: "empat-titik-qc-yang-menyelamatkan-kontainer",
    title: "Empat titik QC yang menyelamatkan kontainer",
    category: "Process",
    date: "14 Agu 2026",
    author: "Dwi Hartono",
    excerpt:
      "Material, frame, finishing, packaging. Masing-masing punya kriteria lulus sendiri sebelum tahap berikutnya dimulai.",
    tags: ["quality control", "ekspor", "produksi"],
    paragraphs: [
      "Kesalahan yang paling mahal dalam ekspor kerajinan hampir selalu ditemukan terlambat: saat barang sudah dikemas. Karena itu pemeriksaan kami dipecah menjadi empat titik yang masing-masing punya kriteria lulus sendiri.",
      "Material. Kadar air kayu, diameter rotan, dan asal panen dicatat sebelum satu potong pun dikerjakan. Batch yang tidak memenuhi toleransi dikembalikan ke pemasok.",
      "Frame. Sambungan dan dimensi diukur pada rangka mentah. Di titik ini koreksi masih murah — mengganti satu sambungan, bukan satu unit.",
      "Finishing. Warna dibandingkan dengan sampel yang disetujui pembeli, di bawah cahaya yang sama setiap kali.",
      "Packaging. Uji jatuh, penandaan karton, dan kesesuaian jumlah per kontainer diperiksa terakhir, bersama dokumen ekspor.",
      "Empat titik ini yang membuat kami berani memberi garansi 7 hari setelah barang diterima.",
    ],
    status: "Published",
  },
  {
    slug: "bangunjiwo-satu-desa-tiga-generasi",
    title: "Bangunjiwo: satu desa, tiga generasi",
    category: "Artisan Story",
    date: "02 Agu 2026",
    author: "Rani Prasetyo",
    excerpt:
      "Bagaimana satu desa di Bantul mempertahankan keahlian anyam sambil mengikuti standar ekspor.",
    tags: ["bantul", "pengrajin", "cerita"],
    paragraphs: [
      "Di Bangunjiwo, keahlian anyam berpindah di ruang tamu, bukan di ruang kelas. Pak Slamet belajar dari ayahnya; anaknya sekarang yang membaca gambar teknis dari pembeli Eropa.",
      "Yang berubah bukan tekniknya, melainkan tuntutan ukuran: toleransi 2 mm dan warna yang harus sama antar batch memaksa workshop mencatat apa yang dulu hanya diingat.",
      "Kami membantu menyiapkan catatan itu, tanpa memindahkan pekerjaan tangan ke mesin.",
    ],
    status: "Published",
  },
  {
    slug: "kayu-reclaimed-dan-jejak-dokumennya",
    title: "Kayu reclaimed dan jejak dokumennya",
    category: "Material",
    date: "24 Jul 2026",
    author: "Sekar Ayu",
    excerpt:
      "Kayu bekas bangunan bisa jadi material terbaik — asal jejak asalnya bisa dibuktikan.",
    tags: ["jati", "reclaimed", "dokumen"],
    paragraphs: [
      "Kayu bekas bangunan sering lebih stabil daripada kayu baru — ia sudah melewati puluhan musim. Masalahnya bukan kualitas, melainkan pembuktian asal.",
      "Setiap pembelian kami sertai foto sumber, surat jual beli, dan catatan pembongkaran, sehingga pembeli di Eropa bisa memenuhi kewajiban uji tuntas mereka.",
    ],
    status: "Draft",
  },
  {
    slug: "menghitung-moq-tanpa-membebani-pengrajin",
    title: "Menghitung MOQ tanpa membebani pengrajin",
    category: "Process",
    date: "21 Jul 2026",
    author: "Rani Prasetyo",
    excerpt:
      "MOQ bukan angka dagang semata; ia menentukan apakah workshop bisa bekerja dengan tenang.",
    tags: ["moq", "kapasitas", "harga"],
    paragraphs: [
      "MOQ bukan angka dagang semata. Ia menentukan apakah workshop bisa menyiapkan material sekali jalan atau harus membeli berulang dengan harga lebih tinggi.",
      "Untuk order pertama kami biasanya menyarankan 50 pcs per model: cukup untuk efisiensi material, cukup kecil untuk menguji pasar Anda.",
    ],
    status: "Published",
  },
  {
    slug: "finishing-natural-yang-tahan-pengiriman-laut",
    title: "Finishing natural yang tahan pengiriman laut",
    category: "Material",
    date: "08 Jul 2026",
    author: "Dwi Hartono",
    excerpt:
      "Kelembapan kontainer menguji setiap lapisan. Ini yang kami pakai dan alasannya.",
    tags: ["finishing", "pengiriman", "kelembapan"],
    paragraphs: [
      "Kelembapan di dalam kontainer menguji setiap lapisan. Finishing berbasis air yang cantik di showroom bisa memutih setelah enam minggu di laut.",
      "Kami memakai clear coat dengan lapisan penutup tahan lembap, dan setiap batch diuji dengan sampel yang disimpan dalam kotak kelembapan tinggi selama 72 jam.",
    ],
    status: "Published",
  },
];

export const ARTICLE_CATEGORIES = [
  "Semua",
  "Craft Journal",
  "Process",
  "Material",
  "Artisan Story",
] as const;

export const BASE_COMMENTS: Comment[] = [
  {
    initial: "A",
    name: "Andra Wibowo",
    when: "3 jam lalu",
    text: "Apakah laporan QC bisa diminta dalam bahasa Inggris untuk buyer kami?",
  },
  {
    initial: "M",
    name: "Mira Kusuma",
    when: "4 hari lalu",
    text: "Penjelasan tahap frame sangat membantu. Kami sering menemukan masalah justru di titik itu.",
  },
];

export const MILESTONES = [
  {
    year: "2015",
    title: "Mulai dari satu workshop",
    text: "Pesanan pertama 120 keranjang rotan untuk satu pembeli di Australia, dikerjakan satu workshop di Bangunjiwo.",
  },
  {
    year: "2018",
    title: "Sistem QC empat titik",
    text: "Setelah satu batch ditolak karena finishing, pemeriksaan dipecah menjadi material, frame, finishing, dan packaging.",
  },
  {
    year: "2021",
    title: "Jaringan sembilan desa",
    text: "Workshop bambu, kayu solid, dan serat alami masuk jaringan, sehingga satu proyek bisa memakai beberapa material.",
  },
  {
    year: "2024",
    title: "Dokumen material terlacak",
    text: "Semua kayu reclaimed wajib disertai catatan asal, mengikuti permintaan pembeli Eropa.",
  },
  {
    year: "2026",
    title: "42 workshop mitra",
    text: "128 produk aktif, pengiriman rutin ke 12 negara, dengan skema pembayaran dan garansi yang seragam.",
  },
];

export const PAYMENT_STAGES = [
  {
    pct: "45%",
    short: "Down payment — pengadaan material & mulai produksi",
    long: "Down payment saat PO dikonfirmasi — untuk pengadaan material dan memulai produksi.",
  },
  {
    pct: "25%",
    short: "Progres produksi — setelah laporan QC frame",
    long: "Pembayaran progres setelah laporan QC frame disetujui pembeli.",
  },
  {
    pct: "30%",
    short: "Pelunasan — sebelum pengiriman internasional",
    long: "Pelunasan sebelum kontainer dimuat dan dokumen ekspor diserahkan.",
  },
];

export const TERMS_SECTIONS = [
  {
    id: "t-qc",
    no: "02",
    title: "Quality control",
    body: "Pemeriksaan dilakukan pada empat titik — material, frame, finishing, dan packaging — dan didokumentasikan dengan foto per batch. Temuan di luar toleransi dikembalikan ke workshop sebelum tahap berikutnya dimulai; laporan dikirim ke pembeli pada setiap titik.",
  },
  {
    id: "t-warranty",
    no: "03",
    title: "Garansi produk 7 hari",
    body: "Klaim atas cacat produksi dapat diajukan dalam 7 hari setelah barang diterima, disertai foto dan nomor batch. Penggantian, perbaikan, atau kompensasi mengikuti kesepakatan yang tercantum pada penawaran.",
  },
  {
    id: "t-lead",
    no: "04",
    title: "Lead time & MOQ",
    body: "MOQ mulai 50 pcs per model, dapat disesuaikan untuk order kontrak. Lead time standar 30–45 hari kerja sejak down payment diterima dan sampel disetujui; keterlambatan akibat cuaca panen material dikomunikasikan paling lambat 7 hari sebelum jadwal.",
  },
  {
    id: "t-ship",
    no: "05",
    title: "Pengiriman & dokumen",
    body: "Harga standar FOB Semarang atau Surabaya. Kami menyiapkan packing list, invoice, certificate of origin, dan dokumen fumigasi bila diperlukan, serta berkoordinasi dengan forwarder yang ditunjuk pembeli.",
  },
  {
    id: "t-ip",
    no: "06",
    title: "Desain & kerahasiaan",
    body: "Gambar teknis dan desain yang Anda kirim tetap milik Anda dan tidak ditawarkan ke pembeli lain. Produk hasil pengembangan bersama hanya ditampilkan pada portofolio kami dengan persetujuan tertulis.",
  },
];

/* ── Admin-only sample content ───────────────────────────────────────────── */

export const INQUIRIES: Inquiry[] = [
  {
    name: "Marta Lindqvist",
    company: "Nordiska Home, SE",
    subject: "Rattan pendant — 400 pcs",
    preview: "Kami mencari 400 pcs pendant rotan untuk koleksi musim gugur…",
    body: "Kami mencari 400 pcs pendant rotan untuk koleksi musim gugur, dengan opsi finishing walnut. Mohon info MOQ, harga FOB Semarang, dan lead time produksi.",
    when: "5 jam",
    status: "Baru",
    volume: "400 pcs",
    target: "Nov 2026",
    port: "Göteborg",
    email: "marta@nordiskahome.se",
  },
  {
    name: "Daniel Okafor",
    company: "Lagos Interiors, NG",
    subject: "Teak console — sampel dulu",
    preview: "Bisa kirim 2 sampel sebelum order 60 pcs?",
    body: "Sebelum order 60 pcs teak console, bisakah dikirim 2 sampel lengkap dengan finishing pilihan kami?",
    when: "8 jam",
    status: "Baru",
    volume: "60 pcs",
    target: "Jan 2027",
    port: "Lagos",
    email: "daniel@lagosinteriors.ng",
  },
  {
    name: "Yuki Tanaka",
    company: "Mori Living, JP",
    subject: "Basket set — repeat order",
    preview: "Repeat order 300 set, packaging sama seperti Juni.",
    body: "Repeat order 300 set basket dengan packaging identik pengiriman Juni lalu.",
    when: "Kemarin",
    status: "Diproses",
    volume: "300 set",
    target: "Okt 2026",
    port: "Yokohama",
    email: "yuki@moriliving.jp",
  },
  {
    name: "Claire Dubois",
    company: "Atelier Sud, FR",
    subject: "Bamboo divider — custom size",
    preview: "Butuh ukuran 200 × 180 cm, apakah memungkinkan?",
    body: "Kami butuh bamboo divider ukuran khusus 200 × 180 cm, 40 unit. Apakah rangka bisa diperkuat?",
    when: "2 hari",
    status: "Diproses",
    volume: "40 pcs",
    target: "Des 2026",
    port: "Marseille",
    email: "claire@ateliersud.fr",
  },
  {
    name: "Hassan Al-Amin",
    company: "Doha Contract, QA",
    subject: "Hotel project — 1.200 pcs",
    preview: "Proyek hotel, butuh penawaran lengkap dengan skema pembayaran.",
    body: "Proyek hotel 1.200 pcs campuran lighting dan decor. Mohon penawaran lengkap beserta skema pembayaran.",
    when: "3 hari",
    status: "Selesai",
    volume: "1.200 pcs",
    target: "Mar 2027",
    port: "Doha",
    email: "hassan@dohacontract.qa",
  },
];

export const ADMIN_COMMENTS = [
  {
    initial: "A",
    name: "Andra Wibowo",
    post: "Empat titik QC yang menyelamatkan kontainer",
    text: "Apakah laporan QC bisa diminta dalam bahasa Inggris untuk buyer kami?",
    when: "3 jam",
    status: "Menunggu" as const,
  },
  {
    initial: "L",
    name: "Lucia Ferrari",
    post: "Bangunjiwo: satu desa, tiga generasi",
    text: "Tulisan yang bagus. Apakah workshop bisa dikunjungi saat kami ke Yogyakarta?",
    when: "1 hari",
    status: "Menunggu" as const,
  },
  {
    initial: "H",
    name: "Hendra S.",
    post: "Menghitung MOQ tanpa membebani pengrajin",
    text: "MOQ 50 pcs masih terasa besar untuk brand kecil. Ada opsi trial order?",
    when: "2 hari",
    status: "Menunggu" as const,
  },
  {
    initial: "M",
    name: "Mira Kusuma",
    post: "Memilih rotan yang benar untuk ekspor",
    text: "Terima kasih penjelasan bedanya rotan manau dan sega.",
    when: "4 hari",
    status: "Disetujui" as const,
  },
];

export const ACTIVITY = [
  { kind: "Produk", tone: "accent" as const, text: "Bulan Pendant Lamp — foto utama diperbarui", who: "Rani Prasetyo", when: "18 mnt" },
  { kind: "QC", tone: "accent-2" as const, text: "Frame check lolos untuk batch ORN-TEK-0088", who: "Dwi Hartono", when: "2 jam" },
  { kind: "Inquiry", tone: "neutral" as const, text: "Nordiska Home menanyakan MOQ pendant rotan", who: "Sistem", when: "5 jam" },
  { kind: "Artikel", tone: "outline" as const, text: '"Memilih rotan yang benar" dijadwalkan 26 Agu', who: "Sekar Ayu", when: "Kemarin" },
  { kind: "Pengrajin", tone: "accent-2" as const, text: "Workshop Bu Tini ditambahkan ke database", who: "Rani Prasetyo", when: "2 hari" },
];

export const CATEGORIES_TREE = [
  { name: "Lighting", slug: "lighting", count: "38", indent: 0 },
  { name: "— Pendant", slug: "lighting-pendant", count: "21", indent: 14 },
  { name: "— Table lamp", slug: "lighting-table", count: "9", indent: 14 },
  { name: "Furniture", slug: "furniture", count: "44", indent: 0 },
  { name: "Home Decor", slug: "home-decor", count: "31", indent: 0 },
  { name: "Storage & Basketry", slug: "basketry", count: "15", indent: 0 },
];

export const MATERIAL_TAGS = [
  { label: "rotan · 38", size: 14, tone: "accent-2" as const },
  { label: "jati reclaimed · 24", size: 13, tone: "accent-2" as const },
  { label: "bambu petung · 17", size: 12.5, tone: "accent-2" as const },
  { label: "water hyacinth · 15", size: 12, tone: "accent-2" as const },
  { label: "kayu suar · 11", size: 11.5, tone: "accent-2" as const },
  { label: "cangkang kelapa · 8", size: 11.5, tone: "neutral" as const },
  { label: "serat pandan · 5", size: 11, tone: "neutral" as const },
];

export const SITE_PAGES = [
  { title: "Beranda (Landing Page)", url: "/", blocks: "6 blok", updated: "23 Agu 2026", status: "Published" as const },
  { title: "Our Story", url: "/our-story", blocks: "4 blok", updated: "12 Agu 2026", status: "Published" as const },
  { title: "Full Catalog", url: "/catalog", blocks: "3 blok", updated: "19 Agu 2026", status: "Published" as const },
  { title: "Terms & Conditions", url: "/terms", blocks: "2 blok", updated: "02 Agu 2026", status: "Published" as const },
  { title: "Kontak & Konsultasi", url: "/kontak", blocks: "3 blok", updated: "—", status: "Draft" as const },
];

export type BuilderBlock = {
  name: string;
  state: "Aktif" | "Global" | "Tersembunyi";
  title: string;
  body: string;
  cta: string;
  cta2?: string;
  link: string;
  img: string;
  big?: boolean;
};

export const BUILDER_BLOCKS: BuilderBlock[] = [
  {
    name: "Hero — Good Value",
    state: "Aktif",
    title: "Good Value.",
    body: "Menjembatani pengrajin lokal Indonesia dengan pembeli global — menjaga nilai kerajinan, presisi teknis, dan manajemen produksi yang profesional.",
    cta: "Consult Your Project",
    cta2: "Lihat Katalog",
    link: "/kontak",
    img: "Set gambar hero",
    big: true,
  },
  {
    name: "Our Story",
    state: "Aktif",
    title: "Menjaga nilai industri kerajinan.",
    body: "Ornament lahir di Bangunjiwo, Bantul — desa di mana rotan, kayu jati, dan bambu sudah menjadi bahasa sehari-hari.",
    cta: "Baca cerita kami",
    link: "/our-story",
    img: "Set potret pengrajin",
  },
  {
    name: "Artisan Product Preview",
    state: "Aktif",
    title: "Dibuat tangan, diukur mesin.",
    body: "Enam produk unggulan dengan material dan asal pengrajin, ditarik dari katalog.",
    cta: "View Full Catalog",
    link: "/catalog",
    img: "Set foto produk unggulan",
  },
  {
    name: "Process with Ornament",
    state: "Aktif",
    title: "Tiga langkah, satu penanggung jawab.",
    body: "Permintaan & seleksi, sourcing & produksi, pengiriman internasional.",
    cta: "Consult Your Project",
    link: "/kontak",
    img: "Set ilustrasi proses",
  },
  {
    name: "Terms & Conditions",
    state: "Aktif",
    title: "Transparan sejak halaman pertama.",
    body: "Pembayaran 45/25/30, QC empat titik, garansi produk 7 hari.",
    cta: "Baca ketentuan lengkap",
    link: "/terms",
    img: "Set gambar dokumen",
  },
  {
    name: "Footer",
    state: "Global",
    title: "Ornament Sourcing Agent",
    body: "Kontak, media sosial, dan alamat workshop di Bangunjiwo, Bantul.",
    cta: "Consult Your Project",
    link: "/kontak",
    img: "Set gambar footer",
  },
  {
    name: "Testimoni pembeli",
    state: "Tersembunyi",
    title: "Kata pembeli kami",
    body: "Blok testimoni; saat ini disembunyikan dari halaman publik.",
    cta: "Lihat semua testimoni",
    link: "/testimoni",
    img: "Set foto pembeli",
  },
];

export const USERS = [
  { initial: "R", name: "Rani Prasetyo", email: "rani@ornament.id", role: "Administrator", content: "86 item", last: "Baru saja", tone: "accent" as const },
  { initial: "S", name: "Sekar Ayu", email: "sekar@ornament.id", role: "Editor", content: "34 artikel", last: "2 jam lalu", tone: "accent-2" as const },
  { initial: "D", name: "Dwi Hartono", email: "dwi@ornament.id", role: "Editor", content: "52 laporan QC", last: "Kemarin", tone: "accent-2" as const },
  { initial: "B", name: "Bagus Nugroho", email: "bagus@ornament.id", role: "Contributor", content: "7 draf", last: "5 hari lalu", tone: "neutral" as const },
];

export const ROLE_CAPS = [
  { name: "Menerbitkan produk & artikel", admin: "Ya", editor: "Ya", contrib: "Draf saja" },
  { name: "Mengelola pengrajin", admin: "Ya", editor: "Ya", contrib: "Lihat" },
  { name: "Membalas inquiry", admin: "Ya", editor: "Ya", contrib: "—" },
  { name: "Mengelola pengguna", admin: "Ya", editor: "—", contrib: "—" },
  { name: "Mengubah settings & tema", admin: "Ya", editor: "—", contrib: "—" },
];

export const NAV_ITEMS = [
  { label: "Our Story", url: "/our-story", type: "Halaman", tone: "neutral" as const },
  { label: "Catalog", url: "/catalog", type: "Halaman", tone: "neutral" as const },
  { label: "Journal", url: "/journal", type: "Arsip", tone: "accent-2" as const },
  { label: "Terms", url: "/terms", type: "Halaman", tone: "neutral" as const },
  { label: "Consult Your Project", url: "/kontak", type: "Tombol", tone: "accent" as const },
];

/** Tag tone for a product's stock status — the mapping in the handoff readme. */
export function toneForStatus(status: string) {
  if (status === "In Stock" || status === "Published" || status === "Aktif" || status === "Disetujui") return "accent-2" as const;
  if (status === "Low Stock" || status === "Scheduled" || status === "Verifikasi" || status === "Baru" || status === "Menunggu") return "accent" as const;
  if (status === "Draft") return "outline" as const;
  return "neutral" as const;
}
