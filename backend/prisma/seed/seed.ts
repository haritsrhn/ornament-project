/**
 * Seed data mockup (T2.4) — mengisi database dev/tes dengan isi
 * `frontend/lib/data.ts` yang sudah dipetakan ke model Prisma
 * (`docs/domain-model.md` §7).
 *
 * ── Idempotensi ──────────────────────────────────────────────────────────────
 * Strateginya **hapus-lalu-isi dalam satu transaksi**: seed meng-`TRUNCATE`
 * semua tabel domain (kecuali `_prisma_migrations`) dengan `RESTART IDENTITY
 * CASCADE`, lalu menulis ulang seluruh data. Dijalankan berapa kali pun,
 * hasilnya persis sama: jumlah baris identik, tidak ada bentrok unik, dan tidak
 * ada baris yatim. Upsert per kunci alami sengaja tidak dipakai karena sebagian
 * baris (komentar, log aktivitas, blok halaman) tidak punya kunci alami, jadi
 * upsert akan menumpuk duplikat pada setiap jalannya.
 *
 * Karena TRUNCATE menghapus **semua** data — termasuk yang dibuat manual lewat
 * admin — seed hanya boleh menyentuh database dev/tes; lihat `guard.ts`.
 *
 * Yang tidak identik antar-jalan: nilai UUID dan timestamp, karena semua waktu
 * diturunkan relatif terhadap waktu seed (lihat `transform.ts`).
 *
 * ── Yang tidak ada di mockup ─────────────────────────────────────────────────
 * - **Media**: mockup tidak memuat satu berkas gambar pun, jadi tabel `media`
 *   kosong dan semua `*ImageId` null. Akibatnya produk berstatus PUBLISHED di
 *   sini belum memenuhi syarat publish §6.3 (`primaryImageId` wajib) — syarat
 *   itu berlaku di lapisan API, bukan constraint DB.
 * - **Kata sandi**: mockup tidak memuat kata sandi, jadi semua akun seed
 *   memakai **satu** kata sandi dev yang sama, di-hash argon2id (ADR K7,
 *   `src/lib/password.ts`). Nilainya dari `SEED_ADMIN_PASSWORD`, atau
 *   `DEV_ONLY_PASSWORD` bila env itu tidak di-set — dan entry seed mencetak
 *   kata sandi yang dipakai ke console supaya tidak ada yang menebak. Ini aman
 *   karena seed hanya boleh jalan di dev/tes (`guard.ts`), tetapi tetap:
 *   **jangan pakai kata sandi ini di luar mesin lokal.**
 * - Sesi, undangan, revisi produk, galeri, dokumen pengrajin, lampiran inquiry,
 *   dan redirect slug tidak punya data mockup dan tidak diisi.
 */

import { PASSWORD_MIN_LENGTH } from '@ornament/shared';

import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { hashPassword } from '../../src/lib/password.js';

import {
  ACTIVITY,
  ADMIN_COMMENTS,
  ARTICLE_CATEGORIES,
  ARTICLES,
  ARTISANS,
  BASE_COMMENTS,
  BUILDER_BLOCKS,
  CATEGORIES_TREE,
  COMPANY,
  INQUIRIES,
  MATERIALS,
  NAV_ITEMS,
  PRODUCT_SPEC,
  PRODUCTS,
  QC_POINTS,
  SITE_PAGES,
  USERS,
} from './source-data.js';
import {
  computeStockStatus,
  countWords,
  paragraphsToArticleBlocks,
  parseDimensions,
  parseIndonesianInt,
  parseLeadTimeDays,
  parsePlace,
  parseQuantityWithUnit,
  parseRelativeWhen,
  parseSinceYear,
  parseStockQuantity,
  parseTargetShipDate,
  parseUsdPrice,
  shiftMockupDate,
  slugify,
} from './transform.js';

/**
 * Kata sandi dev bawaan untuk semua akun seed. Sengaja dibuat terbaca sebagai
 * "hanya untuk lokal", bukan seperti rahasia production, dan dicetak ke console
 * saat seed berjalan. `SEED_ADMIN_PASSWORD` menimpanya bila di-set.
 */
export const DEFAULT_SEED_PASSWORD = 'DEV_ONLY_PASSWORD';

/** Kata sandi yang dipakai seed: env bila ada (dan cukup panjang), selain itu default dev. */
export function resolveSeedPassword(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SEED_ADMIN_PASSWORD;
  if (fromEnv !== undefined && fromEnv.length >= PASSWORD_MIN_LENGTH) return fromEnv;
  return DEFAULT_SEED_PASSWORD;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const GLOBAL_LOW_STOCK_THRESHOLD = 10;

/** Provinsi per kabupaten — mockup hanya menulis "desa, kabupaten". */
const PROVINCE_BY_REGENCY: Record<string, string> = {
  Bantul: 'Daerah Istimewa Yogyakarta',
  Sleman: 'Daerah Istimewa Yogyakarta',
  'Kulon Progo': 'Daerah Istimewa Yogyakarta',
  Jepara: 'Jawa Tengah',
  Gianyar: 'Bali',
};

/**
 * Kode SKU per material (§6.2), dibaca balik dari SKU produk mockup
 * (`ORN-RTN-0142` → RTN). "Rotan sega" memakai `SEG`, bukan `RTN` seperti di
 * mockup, karena `material.sku_code` unik dan `RTN` sudah dipegang
 * "Rotan alami". SKU produk sendiri tetap ditulis apa adanya.
 */
const MATERIAL_SKU_CODE: Record<string, string> = {
  'Rotan alami': 'RTN',
  'Jati reclaimed': 'TEK',
  'Bambu petung': 'BMB',
  'Water hyacinth': 'WHY',
  'Kayu suar': 'SUA',
  'Cangkang kelapa': 'COC',
  'Rotan sega': 'SEG',
  'Serat pandan': 'PDN',
};

/** Kategori produk mockup → slug di `CATEGORIES_TREE`. */
const CATEGORY_SLUG_BY_LABEL: Record<string, string> = {
  Lighting: 'lighting',
  Furniture: 'furniture',
  'Home Decor': 'home-decor',
  Basketry: 'basketry',
};

/**
 * Pengrajin per produk: mockup hanya menulis `origin` ("Bantul, Yogyakarta"),
 * jadi pasangannya dipilih di sini dari kabupaten + keahlian. Dua produk Bantul
 * non-rotan (mosaik kelapa) jatuh ke satu-satunya workshop Bantul yang ada.
 * `lowStockThreshold`: ambang per produk dipakai agar status stok turunan sama
 * dengan label mockup — "Tenun Basket Set" berlabel *Low Stock* dengan 12 set,
 * padahal ambang global 10; ambang 20 untuk produk itu membuat aturan §6.3
 * menghasilkan LOW_STOCK tanpa override manual.
 */
const PRODUCT_EXTRA: Record<string, { artisanSlug: string; lowStockThreshold?: number }> = {
  'bulan-pendant-lamp': { artisanSlug: 'workshop-pak-slamet' },
  'akar-teak-console': { artisanSlug: 'jati-karya-jepara' },
  'tenun-basket-set': { artisanSlug: 'kelompok-bu-tini', lowStockThreshold: 20 },
  'suar-serving-bowl': { artisanSlug: 'suar-studio-gianyar' },
  'petung-room-divider': { artisanSlug: 'bambu-sleman-craft' },
  'kelapa-wall-mosaic': { artisanSlug: 'workshop-pak-slamet' },
  'sega-floor-lamp': { artisanSlug: 'workshop-pak-slamet' },
  'pandan-placemat-set': { artisanSlug: 'kelompok-bu-tini' },
};

const ARTISAN_STATUS: Record<string, 'VERIFICATION' | 'ACTIVE' | 'FULL_CAPACITY'> = {
  Aktif: 'ACTIVE',
  Verifikasi: 'VERIFICATION',
  'Kapasitas penuh': 'FULL_CAPACITY',
};

const USER_ROLE: Record<string, 'ADMINISTRATOR' | 'EDITOR' | 'CONTRIBUTOR'> = {
  Administrator: 'ADMINISTRATOR',
  Editor: 'EDITOR',
  Contributor: 'CONTRIBUTOR',
};

const ARTICLE_STATUS: Record<string, 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'> = {
  Draft: 'DRAFT',
  Scheduled: 'SCHEDULED',
  Published: 'PUBLISHED',
};

/** Mockup hanya memakai dua status moderasi; SPAM/DELETED tidak ada datanya. */
const COMMENT_STATUS: Record<string, 'PENDING' | 'APPROVED'> = {
  Menunggu: 'PENDING',
  Disetujui: 'APPROVED',
};

const INQUIRY_STATUS: Record<string, 'NEW' | 'IN_PROGRESS' | 'DONE'> = {
  Baru: 'NEW',
  Diproses: 'IN_PROGRESS',
  Selesai: 'DONE',
};

const QC_STAGE: Record<string, 'MATERIAL' | 'FRAME' | 'FINISHING' | 'PACKAGING'> = {
  Material: 'MATERIAL',
  Frame: 'FRAME',
  Finishing: 'FINISHING',
  Packaging: 'PACKAGING',
};

const BLOCK_VISIBILITY: Record<string, 'ACTIVE' | 'GLOBAL' | 'HIDDEN'> = {
  Aktif: 'ACTIVE',
  Global: 'GLOBAL',
  Tersembunyi: 'HIDDEN',
};

/** Tipe blok Page Builder diturunkan dari nama blok di mockup. */
const BLOCK_TYPE: Record<
  string,
  | 'HERO'
  | 'STORY'
  | 'PRODUCT_PREVIEW'
  | 'PROCESS'
  | 'TERMS'
  | 'FOOTER'
  | 'TESTIMONIAL'
  | 'RICH_TEXT'
> = {
  'Hero — Good Value': 'HERO',
  'Our Story': 'STORY',
  'Artisan Product Preview': 'PRODUCT_PREVIEW',
  'Process with Ornament': 'PROCESS',
  'Terms & Conditions': 'TERMS',
  Footer: 'FOOTER',
  'Testimoni pembeli': 'TESTIMONIAL',
};

/** `systemKey` halaman yang punya route kode (§6.9). */
const PAGE_SYSTEM_KEY: Record<string, string> = {
  '/': 'home',
  '/catalog': 'catalog',
  '/kontak': 'contact',
};

/** Negara tujuan inquiry dari kode di kolom `company` ("Nordiska Home, SE"). */
const COUNTRY_BY_CODE: Record<string, string> = {
  SE: 'Swedia',
  NG: 'Nigeria',
  JP: 'Jepang',
  FR: 'Prancis',
  QA: 'Qatar',
};

/**
 * Kategori/material yang diminta tiap inquiry, dibaca dari subjek mockup
 * ("Rattan pendant", "Teak console", …). Dipakai untuk relasi dan untuk
 * menghasilkan `subject` sesuai §6.5.
 */
const INQUIRY_TARGET: Record<string, { categorySlug: string | null; materialName: string | null }> =
  {
    'marta@nordiskahome.se': { categorySlug: 'lighting', materialName: 'Rotan alami' },
    'daniel@lagosinteriors.ng': { categorySlug: 'furniture', materialName: 'Jati reclaimed' },
    'yuki@moriliving.jp': { categorySlug: 'basketry', materialName: 'Water hyacinth' },
    'claire@ateliersud.fr': { categorySlug: 'furniture', materialName: 'Bambu petung' },
    'hassan@dohacontract.qa': { categorySlug: null, materialName: null },
  };

/** ActivityLog: kind + kode aksi + entitas yang dirujuk, per baris `ACTIVITY`. */
const ACTIVITY_MAPPING: {
  kind: 'PRODUCT' | 'QC' | 'INQUIRY' | 'ARTICLE' | 'ARTISAN';
  action: string;
  entityType: string;
  entityKey: string;
}[] = [
  {
    kind: 'PRODUCT',
    action: 'product.updated',
    entityType: 'Product',
    entityKey: 'bulan-pendant-lamp',
  },
  { kind: 'QC', action: 'qc.passed', entityType: 'Product', entityKey: 'akar-teak-console' },
  {
    kind: 'INQUIRY',
    action: 'inquiry.created',
    entityType: 'Inquiry',
    entityKey: 'marta@nordiskahome.se',
  },
  {
    kind: 'ARTICLE',
    action: 'article.scheduled',
    entityType: 'Article',
    entityKey: 'memilih-rotan-yang-benar-untuk-ekspor',
  },
  {
    kind: 'ARTISAN',
    action: 'artisan.created',
    entityType: 'Artisan',
    entityKey: 'kelompok-bu-tini',
  },
];

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Data seed tidak lengkap: ${what}`);
  return value;
}

/** Email sintetis untuk komentar pengunjung (wajib per §3.6; mockup tidak punya). */
function syntheticCommentEmail(name: string): string {
  return `${slugify(name).replace(/-/g, '.')}@example.com`;
}

/** Deskripsi produk (rich text D7) — teks turunan, penanda isi mockup. */
function productDescription(product: {
  name: string;
  material: string;
  origin: string;
  moq: string;
}): { id: string; type: 'paragraph'; text: { text: string }[] }[] {
  return [
    {
      id: 'p1',
      type: 'paragraph',
      text: [
        {
          text:
            `${product.name} dikerjakan dari ${product.material.toLowerCase()} oleh workshop mitra ` +
            `di ${product.origin}. Minimum order ${product.moq}. (Teks contoh dari data mockup.)`,
        },
      ],
    },
  ];
}

export interface SeedCounts {
  user: number;
  category: number;
  material: number;
  tag: number;
  artisan: number;
  product: number;
  productMaterial: number;
  productSpec: number;
  productQcCheck: number;
  articleCategory: number;
  article: number;
  articleTag: number;
  comment: number;
  inquiry: number;
  inquiryReply: number;
  page: number;
  pageBlock: number;
  navItem: number;
  siteSetting: number;
  activityLog: number;
}

export interface SeedOptions {
  /** Waktu acuan; semua timestamp diturunkan dari sini. Default: sekarang. */
  now?: Date;
  /**
   * Kata sandi untuk semua akun seed. Default `resolveSeedPassword()`.
   * Tes memakai nilainya sendiri agar tidak bergantung pada env mesin.
   */
  password?: string;
}

/**
 * Mengosongkan seluruh tabel domain (bukan `_prisma_migrations`).
 * Diekspor agar tes bisa membersihkan database tes setelah selesai.
 */
export async function truncateAllTables(tx: Prisma.TransactionClient): Promise<string[]> {
  const tables = await tx.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `;
  const names = tables.map((row) => row.tablename);
  if (names.length === 0) return names;
  const quoted = names.map((name) => `"public"."${name}"`).join(', ');
  await tx.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  return names;
}

/**
 * Mengisi database dengan data mockup. Pemanggil bertanggung jawab atas
 * pengaman lingkungan (`assertSeedAllowed`) dan penutupan client.
 */
export async function seedDatabase(
  prisma: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedCounts> {
  const now = options.now ?? new Date();
  // Satu hash dipakai ulang untuk semua akun seed: argon2id dengan parameter
  // 2026 butuh ~85 ms per hash, dan seed tidak mengajari apa pun dengan
  // menghitungnya lima kali. Salt-nya acak, jadi hash-nya tetap unik per jalan
  // seed — yang identik hanyalah antar-akun di dalam satu jalan.
  const passwordHash = await hashPassword(options.password ?? resolveSeedPassword());

  return prisma.$transaction(
    async (tx) => {
      await truncateAllTables(tx);

      // ── Pengguna (USERS) ────────────────────────────────────────────────
      const userIdByName = new Map<string, string>();
      for (const [index, source] of USERS.entries()) {
        const user = await tx.user.create({
          data: {
            email: source.email,
            name: source.name,
            passwordHash,
            role: must(USER_ROLE[source.role], `peran "${source.role}"`),
            status: 'ACTIVE',
            lastActiveAt: parseRelativeWhen(source.last, now),
            createdAt: new Date(now.getTime() - (365 - index) * 24 * 60 * 60 * 1000),
          },
        });
        userIdByName.set(source.name, user.id);
      }
      const adminId = must(userIdByName.get('Rani Prasetyo'), 'pengguna Administrator');
      const qcUserId = must(userIdByName.get('Dwi Hartono'), 'pengguna QC');

      // ── Kategori produk (CATEGORIES_TREE, hierarkis D4) ─────────────────
      const categoryIdBySlug = new Map<string, string>();
      let lastRootSlug: string | null = null;
      const positionByParent = new Map<string, number>();
      for (const node of CATEGORIES_TREE) {
        const isChild = node.indent > 0;
        const parentSlug = isChild ? lastRootSlug : null;
        const parentId = parentSlug === null ? null : (categoryIdBySlug.get(parentSlug) ?? null);
        const parentKey = parentSlug ?? '__root__';
        const position = positionByParent.get(parentKey) ?? 0;
        positionByParent.set(parentKey, position + 1);

        const category = await tx.category.create({
          data: {
            name: node.name.replace(/^—\s*/, ''),
            slug: node.slug,
            parentId,
            position,
          },
        });
        categoryIdBySlug.set(node.slug, category.id);
        if (!isChild) lastRootSlug = node.slug;
      }

      // ── Material (MATERIALS + kode SKU §6.2) ────────────────────────────
      const materialIdByName = new Map<string, string>();
      for (const name of MATERIALS) {
        const material = await tx.material.create({
          data: {
            name,
            slug: slugify(name),
            skuCode: MATERIAL_SKU_CODE[name] ?? null,
          },
        });
        materialIdByName.set(name, material.id);
      }

      // ── Tag (label artikel; mockup tidak punya tag produk) ──────────────
      const tagIdBySlug = new Map<string, string>();
      for (const article of ARTICLES) {
        for (const label of article.tags) {
          const slug = slugify(label);
          if (tagIdBySlug.has(slug)) continue;
          const tag = await tx.tag.create({ data: { name: label, slug } });
          tagIdBySlug.set(slug, tag.id);
        }
      }

      // ── Pengrajin (ARTISANS) ────────────────────────────────────────────
      const artisanIdBySlug = new Map<string, string>();
      for (const source of ARTISANS) {
        const { village, regency } = parsePlace(source.place);
        const capacity = parseQuantityWithUnit(source.capacity);
        const artisan = await tx.artisan.create({
          data: {
            name: source.name,
            slug: source.slug,
            village,
            regency,
            province: must(PROVINCE_BY_REGENCY[regency], `provinsi untuk "${regency}"`),
            partnerSinceYear: parseSinceYear(source.since),
            monthlyCapacity: capacity.quantity,
            capacityUnit: capacity.unit,
            skills: [source.craft],
            summary: source.note,
            story: [{ id: 'p1', type: 'paragraph', text: [{ text: source.note }] }],
            status: must(ARTISAN_STATUS[source.status], `status pengrajin "${source.status}"`),
          },
        });
        artisanIdBySlug.set(source.slug, artisan.id);
      }

      // ── Produk (PRODUCTS + PRODUCT_SPEC + QC_POINTS) ────────────────────
      const specDimensions = parseDimensions(
        must(
          PRODUCT_SPEC.find((row) => row.k === 'Dimensi'),
          'spesifikasi Dimensi',
        ).v,
      );
      const specLeadTimeDays = parseLeadTimeDays(
        must(
          PRODUCT_SPEC.find((row) => row.k === 'Lead time'),
          'spesifikasi Lead time',
        ).v,
      );
      const specFobPrice = parseUsdPrice(
        must(
          PRODUCT_SPEC.find((row) => row.k.startsWith('Harga FOB')),
          'spesifikasi Harga FOB',
        ).v,
      );
      /**
       * `PRODUCT_SPEC` di mockup adalah panel detail satu produk (pendant lamp
       * di prototipe), bukan spesifikasi umum. Karena itu dimensi, lead time,
       * dan harga FOB hanya dipasang pada produk pertama; `QC_POINTS` sebaliknya
       * memang checklist empat tahap yang berlaku untuk setiap produk (D6).
       */
      const specProductSlug = must(PRODUCTS[0], 'produk pertama').slug;

      const productIdBySlug = new Map<string, string>();
      let productMaterialCount = 0;
      let productSpecCount = 0;
      let productQcCheckCount = 0;

      for (const [index, source] of PRODUCTS.entries()) {
        const extra = must(PRODUCT_EXTRA[source.slug], `pengrajin produk "${source.slug}"`);
        const categorySlug = must(
          CATEGORY_SLUG_BY_LABEL[source.category],
          `kategori "${source.category}"`,
        );
        const moq = parseQuantityWithUnit(source.moq);
        const stockQuantity = parseStockQuantity(source.stock);
        const isPublished = source.status !== 'Draft';
        const isSpecProduct = source.slug === specProductSlug;
        const lowStockThreshold = extra.lowStockThreshold ?? null;
        const leadTimeDays =
          parseLeadTimeDays(source.stock) ?? (isSpecProduct ? specLeadTimeDays : null);
        // Teks stok yang bukan jumlah ("Menunggu foto produk") adalah catatan
        // internal, bukan data stok (§6.3 / domain model §7).
        const stockNote = stockQuantity === null ? source.stock : null;

        const product = await tx.product.create({
          data: {
            name: source.name,
            slug: source.slug,
            sku: source.sku,
            description: productDescription(source),
            excerpt: `${source.material} · ${source.origin} · MOQ ${source.moq}`,
            categoryId: must(categoryIdBySlug.get(categorySlug), `kategori slug ${categorySlug}`),
            artisanId: must(
              artisanIdBySlug.get(extra.artisanSlug),
              `pengrajin ${extra.artisanSlug}`,
            ),
            moqQuantity: moq.quantity,
            moqUnit: moq.unit,
            leadTimeDays,
            lengthCm: isSpecProduct ? (specDimensions?.lengthCm ?? null) : null,
            widthCm: isSpecProduct ? (specDimensions?.widthCm ?? null) : null,
            heightCm: isSpecProduct ? (specDimensions?.heightCm ?? null) : null,
            fobPriceUsd: isSpecProduct ? specFobPrice : null,
            fobPort: 'Semarang',
            stockQuantity,
            lowStockThreshold,
            stockNote,
            stockStatus: computeStockStatus({
              stockQuantity,
              lowStockThreshold,
              globalLowStockThreshold: GLOBAL_LOW_STOCK_THRESHOLD,
            }),
            publishStatus: isPublished ? 'PUBLISHED' : 'DRAFT',
            publishedAt: isPublished
              ? new Date(now.getTime() - (index + 1) * 3 * 24 * 60 * 60 * 1000)
              : null,
            createdById: adminId,
            updatedById: adminId,
          },
        });
        productIdBySlug.set(source.slug, product.id);

        await tx.productMaterial.create({
          data: {
            productId: product.id,
            materialId: must(materialIdByName.get(source.material), `material ${source.material}`),
            isPrimary: true,
          },
        });
        productMaterialCount += 1;

        if (isSpecProduct) {
          // Baris spesifikasi yang tidak punya kolom sendiri di `Product`.
          const extraSpecs = PRODUCT_SPEC.filter(
            (row) => row.k === 'Material' || row.k === 'Finishing',
          );
          for (const [position, row] of extraSpecs.entries()) {
            await tx.productSpec.create({
              data: { productId: product.id, label: row.k, value: row.v, position },
            });
            productSpecCount += 1;
          }
        }

        for (const point of QC_POINTS) {
          const passed = isPublished;
          await tx.productQcCheck.create({
            data: {
              productId: product.id,
              stage: must(QC_STAGE[point.title], `tahap QC "${point.title}"`),
              status: passed ? 'PASSED' : 'PENDING',
              criteria: point.body,
              checkedById: passed ? qcUserId : null,
              checkedAt: passed ? new Date(now.getTime() - (index + 1) * 60 * 60 * 1000) : null,
            },
          });
          productQcCheckCount += 1;
        }
      }

      // ── Kategori artikel (ARTICLE_CATEGORIES, tanpa "Semua") ────────────
      const articleCategoryIdByName = new Map<string, string>();
      for (const [position, name] of ARTICLE_CATEGORIES.filter((n) => n !== 'Semua').entries()) {
        const category = await tx.articleCategory.create({
          data: { name, slug: slugify(name), position },
        });
        articleCategoryIdByName.set(name, category.id);
      }

      // ── Artikel (ARTICLES) ──────────────────────────────────────────────
      const articleIdByTitle = new Map<string, string>();
      const articleIdBySlug = new Map<string, string>();
      let articleTagCount = 0;
      for (const source of ARTICLES) {
        const status = must(ARTICLE_STATUS[source.status], `status artikel "${source.status}"`);
        const date = shiftMockupDate(source.date, now);
        const article = await tx.article.create({
          data: {
            title: source.title,
            slug: source.slug,
            excerpt: source.excerpt,
            content: paragraphsToArticleBlocks(source.slug, source.paragraphs),
            wordCount: countWords(source.paragraphs),
            categoryId: must(
              articleCategoryIdByName.get(source.category),
              `kategori artikel "${source.category}"`,
            ),
            authorId: must(userIdByName.get(source.author), `penulis "${source.author}"`),
            status,
            publishAt: status === 'SCHEDULED' ? date : null,
            publishedAt: status === 'PUBLISHED' ? date : null,
            createdAt: new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
        });
        articleIdByTitle.set(source.title, article.id);
        articleIdBySlug.set(source.slug, article.id);

        for (const label of source.tags) {
          await tx.articleTag.create({
            data: {
              articleId: article.id,
              tagId: must(tagIdBySlug.get(slugify(label)), `tag "${label}"`),
            },
          });
          articleTagCount += 1;
        }
      }

      // ── Komentar (ADMIN_COMMENTS + BASE_COMMENTS) ───────────────────────
      // `ADMIN_COMMENTS` adalah antrean moderasi (punya artikel + status) dan
      // dipakai sebagai sumber utama. `BASE_COMMENTS` adalah komentar yang
      // tampil di halaman artikel QC; satu di antaranya (Andra) teksnya sama
      // persis dengan baris ADMIN_COMMENTS, jadi tidak digandakan.
      const qcArticleTitle = 'Empat titik QC yang menyelamatkan kontainer';
      let commentCount = 0;
      const createComment = async (input: {
        articleTitle: string;
        authorName: string;
        body: string;
        when: string;
        status: 'PENDING' | 'APPROVED';
      }): Promise<void> => {
        const createdAt = parseRelativeWhen(input.when, now);
        await tx.comment.create({
          data: {
            articleId: must(
              articleIdByTitle.get(input.articleTitle),
              `artikel "${input.articleTitle}"`,
            ),
            authorName: input.authorName,
            authorEmail: syntheticCommentEmail(input.authorName),
            body: input.body,
            status: input.status,
            moderatedById: input.status === 'APPROVED' ? adminId : null,
            moderatedAt:
              input.status === 'APPROVED' ? new Date(createdAt.getTime() + 3600_000) : null,
            createdAt,
          },
        });
        commentCount += 1;
      };

      for (const source of ADMIN_COMMENTS) {
        await createComment({
          articleTitle: source.post,
          authorName: source.name,
          body: source.text,
          when: source.when,
          status: must(COMMENT_STATUS[source.status], `status komentar "${source.status}"`),
        });
      }
      const adminCommentTexts = new Set(ADMIN_COMMENTS.map((row) => row.text));
      for (const source of BASE_COMMENTS.filter((row) => !adminCommentTexts.has(row.text))) {
        await createComment({
          articleTitle: qcArticleTitle,
          authorName: source.name,
          body: source.text,
          when: source.when,
          status: 'APPROVED',
        });
      }

      // ── Inquiry (INQUIRIES) ─────────────────────────────────────────────
      // Nomor berurutan dari yang paling lama (§6.5): `INQ-0001` … `INQ-0005`.
      const inquiriesOldestFirst = INQUIRIES.map((source) => ({
        source,
        createdAt: parseRelativeWhen(source.when, now),
      })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      const inquiryIdByEmail = new Map<string, string>();
      let inquiryReplyCount = 0;
      for (const [index, { source, createdAt }] of inquiriesOldestFirst.entries()) {
        const number = index + 1;
        const target = must(INQUIRY_TARGET[source.email], `target inquiry ${source.email}`);
        const categoryId =
          target.categorySlug === null
            ? null
            : must(categoryIdBySlug.get(target.categorySlug), `kategori ${target.categorySlug}`);
        const categoryLabel =
          target.categorySlug === null
            ? null
            : must(
                CATEGORIES_TREE.find((node) => node.slug === target.categorySlug),
                `label kategori ${target.categorySlug}`,
              ).name;
        const materialId =
          target.materialName === null
            ? null
            : must(materialIdByName.get(target.materialName), `material ${target.materialName}`);
        const volumeQuantity = parseIndonesianInt(source.volume.split(' ')[0] ?? '0');
        // §6.5: subject dihasilkan server, teks subjek mockup tidak dipakai.
        const subject =
          categoryLabel !== null && target.materialName !== null
            ? `${categoryLabel} ${target.materialName} — ${String(volumeQuantity)} pcs`
            : `${target.materialName ?? categoryLabel ?? 'Permintaan produk'} — ${String(volumeQuantity)} pcs`;
        const status = must(INQUIRY_STATUS[source.status], `status inquiry "${source.status}"`);
        const countryCode = source.company.split(', ').at(-1) ?? '';

        const inquiry = await tx.inquiry.create({
          data: {
            number,
            reference: `INQ-${String(number).padStart(4, '0')}`,
            subject,
            name: source.name,
            company: source.company.replace(/,\s*[A-Z]{2}$/, ''),
            email: source.email,
            country: COUNTRY_BY_CODE[countryCode] ?? null,
            categoryId,
            categoryLabel,
            materialId,
            materialLabel: target.materialName,
            volumeQuantity,
            targetShipText: source.target,
            targetShipDate: parseTargetShipDate(source.target),
            destinationPort: source.port,
            message: source.body,
            status,
            readAt: status === 'NEW' ? null : new Date(createdAt.getTime() + HOUR),
            completedAt: status === 'DONE' ? new Date(createdAt.getTime() + 2 * DAY) : null,
            createdAt,
          },
        });
        inquiryIdByEmail.set(source.email, inquiry.id);

        // §6.5: NEW → IN_PROGRESS terjadi karena ada balasan terkirim.
        if (status !== 'NEW') {
          await tx.inquiryReply.create({
            data: {
              inquiryId: inquiry.id,
              authorId: adminId,
              toEmail: source.email,
              subject: `Re: ${subject}`,
              body:
                `Terima kasih atas permintaannya. Kami sedang menyiapkan penawaran untuk ` +
                `${String(volumeQuantity)} unit dengan tujuan ${source.port}. (Balasan contoh dari data mockup.)`,
              status: 'SENT',
              sentAt: new Date(createdAt.getTime() + 2 * HOUR),
              createdAt: new Date(createdAt.getTime() + 2 * HOUR),
            },
          });
          inquiryReplyCount += 1;
        }
      }

      // ── Halaman + blok (SITE_PAGES + BUILDER_BLOCKS) ────────────────────
      const pageIdByPath = new Map<string, string>();
      for (const source of SITE_PAGES) {
        const updatedAt = source.updated === '—' ? now : shiftMockupDate(source.updated, now);
        const page = await tx.page.create({
          data: {
            title: source.title,
            path: source.url,
            systemKey: PAGE_SYSTEM_KEY[source.url] ?? null,
            status: source.status === 'Published' ? 'PUBLISHED' : 'DRAFT',
            metaTitle: `${source.title.replace(/\s*\(.*\)$/, '')} — ${COMPANY.name}`,
            updatedById: adminId,
            createdAt: new Date(updatedAt.getTime() - 30 * DAY),
            updatedAt,
          },
        });
        pageIdByPath.set(source.url, page.id);
      }

      // Semua blok mockup adalah blok beranda, kecuali Footer yang global
      // (D10: `pageId` null ⇔ visibility GLOBAL). Halaman lain belum punya data
      // blok di mockup, jadi sengaja dibiarkan kosong.
      const homePageId = must(pageIdByPath.get('/'), 'halaman beranda');
      let pageBlockCount = 0;
      let homePosition = 0;
      let globalPosition = 0;
      for (const source of BUILDER_BLOCKS) {
        const visibility = must(BLOCK_VISIBILITY[source.state], `state blok "${source.state}"`);
        const isGlobal = visibility === 'GLOBAL';
        const type = must(BLOCK_TYPE[source.name], `tipe blok "${source.name}"`);
        await tx.pageBlock.create({
          data: {
            pageId: isGlobal ? null : homePageId,
            type,
            name: source.name,
            visibility,
            position: isGlobal ? globalPosition++ : homePosition++,
            layout: source.big === true ? 'BLEED' : 'LEFT',
            title: source.title,
            body: source.body,
            cta1Label: source.cta,
            cta1Url: source.link,
            cta2Label: source.cta2 ?? null,
            cta2Url: source.cta2 === undefined ? null : '/catalog',
            // Mockup hanya menyebut *deskripsi* set gambar, bukan berkasnya;
            // disimpan di config sampai modul media ada.
            config: {
              imageNote: source.img,
              ...(type === 'PRODUCT_PREVIEW' ? { productCount: 6 } : {}),
            },
          },
        });
        pageBlockCount += 1;
      }

      // ── Navigasi (NAV_ITEMS) ────────────────────────────────────────────
      for (const [position, source] of NAV_ITEMS.entries()) {
        const isArchive = source.type === 'Arsip';
        const pageId = isArchive ? null : (pageIdByPath.get(source.url) ?? null);
        if (!isArchive && pageId === null) {
          throw new Error(`Menu "${source.label}" menunjuk halaman ${source.url} yang tidak ada.`);
        }
        await tx.navItem.create({
          data: {
            label: source.label,
            // "Tombol" di mockup adalah gaya, bukan tipe target: itemnya tetap
            // menunjuk halaman /kontak (CHECK nav_item_target_check).
            type: isArchive ? 'ARTICLE_ARCHIVE' : 'PAGE',
            pageId,
            style: source.type === 'Tombol' ? 'BUTTON' : 'LINK',
            position,
          },
        });
      }

      // ── Pengaturan situs (COMPANY + default) ────────────────────────────
      await tx.siteSetting.create({
        data: {
          id: 1,
          siteName: COMPANY.name,
          tagline: COMPANY.tagline,
          contactEmail: COMPANY.email,
          instagramHandle: COMPANY.instagramHandle,
          instagramUrl: COMPANY.instagramUrl,
          siteLanguage: 'ID',
          timezone: 'Asia/Jakarta',
          address: COMPANY.addressLines.join(', '),
          seoHomeTitle: `${COMPANY.name} — ${COMPANY.tagline}`,
          seoDescription:
            'Sourcing agent kerajinan Indonesia: rotan, kayu jati reclaimed, bambu, dan serat alami untuk pembeli global.',
          seoKeywords: 'rotan, kerajinan, ekspor, jati reclaimed, bambu',
          lowStockThreshold: GLOBAL_LOW_STOCK_THRESHOLD,
          updatedById: adminId,
        },
      });

      // ── Log aktivitas (ACTIVITY) ────────────────────────────────────────
      for (const [index, source] of ACTIVITY.entries()) {
        const mapping = must(ACTIVITY_MAPPING[index], `pemetaan aktivitas #${String(index)}`);
        const entityId =
          mapping.entityType === 'Product'
            ? (productIdBySlug.get(mapping.entityKey) ?? null)
            : mapping.entityType === 'Article'
              ? (articleIdBySlug.get(mapping.entityKey) ?? null)
              : mapping.entityType === 'Inquiry'
                ? (inquiryIdByEmail.get(mapping.entityKey) ?? null)
                : (artisanIdBySlug.get(mapping.entityKey) ?? null);
        await tx.activityLog.create({
          data: {
            kind: mapping.kind,
            action: mapping.action,
            message: source.text,
            // "Sistem" = submit publik/job → actor null (§3.8).
            actorId: source.who === 'Sistem' ? null : (userIdByName.get(source.who) ?? null),
            entityType: mapping.entityType,
            entityId,
            createdAt: parseRelativeWhen(source.when, now),
          },
        });
      }

      // Sequence yang nilainya diisi eksplisit / dipakai bersama SKU mockup
      // disetel ulang agar nomor berikutnya tidak bentrok:
      // - `inquiry.number` (identity) → setelah nomor seed terakhir.
      // - `product_sku_seq` (§6.2) → setelah nomor tertinggi di SKU mockup.
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"inquiry"', 'number'), (SELECT COALESCE(MAX(number), 1) FROM "inquiry"))`,
      );
      const highestSkuNumber = Math.max(
        ...PRODUCTS.map((product) => Number(product.sku.split('-').at(-1) ?? 0)),
      );
      await tx.$executeRawUnsafe(`SELECT setval('product_sku_seq', ${String(highestSkuNumber)})`);

      return {
        user: USERS.length,
        category: CATEGORIES_TREE.length,
        material: MATERIALS.length,
        tag: tagIdBySlug.size,
        artisan: ARTISANS.length,
        product: PRODUCTS.length,
        productMaterial: productMaterialCount,
        productSpec: productSpecCount,
        productQcCheck: productQcCheckCount,
        articleCategory: articleCategoryIdByName.size,
        article: ARTICLES.length,
        articleTag: articleTagCount,
        comment: commentCount,
        inquiry: INQUIRIES.length,
        inquiryReply: inquiryReplyCount,
        page: SITE_PAGES.length,
        pageBlock: pageBlockCount,
        navItem: NAV_ITEMS.length,
        siteSetting: 1,
        activityLog: ACTIVITY.length,
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}
