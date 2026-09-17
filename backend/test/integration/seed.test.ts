import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { seedDatabase, truncateAllTables } from '../../prisma/seed/seed.js';
import {
  ARTICLES,
  ARTISANS,
  CATEGORIES_TREE,
  INQUIRIES,
  MATERIALS,
  PRODUCTS,
  SITE_PAGES,
  USERS,
} from '../../prisma/seed/source-data.js';
import { createTestPrisma } from '../helpers/database.js';

/**
 * Seed (T2.4) dijalankan ke database tes lalu diperiksa invariannya: jumlah
 * baris sesuai data mockup, kunci alami unik, relasi terisi, dan hasil sama
 * saat dijalankan dua kali (idempoten).
 *
 * Database tes dikosongkan lagi di `afterAll`, sehingga `npm test` tidak
 * meninggalkan data — sama seperti `schema-constraints.test.ts`.
 */
describe('seed data mockup (database tes nyata)', () => {
  const prisma = createTestPrisma();

  beforeAll(async () => {
    await seedDatabase(prisma);
  });

  afterAll(async () => {
    await truncateAllTables(prisma);
    await prisma.$disconnect();
  });

  test('jumlah baris mengikuti data mockup', async () => {
    const [products, articles, artisans, materials, categories, users, pages, inquiries] =
      await Promise.all([
        prisma.product.count(),
        prisma.article.count(),
        prisma.artisan.count(),
        prisma.material.count(),
        prisma.category.count(),
        prisma.user.count(),
        prisma.page.count(),
        prisma.inquiry.count(),
      ]);

    expect(products).toBe(PRODUCTS.length);
    expect(articles).toBe(ARTICLES.length);
    expect(artisans).toBe(ARTISANS.length);
    expect(materials).toBe(MATERIALS.length);
    expect(categories).toBe(CATEGORIES_TREE.length);
    expect(users).toBe(USERS.length);
    expect(pages).toBe(SITE_PAGES.length);
    expect(inquiries).toBe(INQUIRIES.length);

    // Setiap produk punya checklist QC empat tahap (D6).
    expect(await prisma.productQcCheck.count()).toBe(PRODUCTS.length * 4);
    // Mockup tidak punya berkas gambar sama sekali.
    expect(await prisma.media.count()).toBe(0);
  });

  test('slug produk & artikel unik dan sama dengan mockup', async () => {
    const productSlugs = (await prisma.product.findMany({ select: { slug: true } })).map(
      (row) => row.slug,
    );
    expect(new Set(productSlugs).size).toBe(productSlugs.length);
    expect([...productSlugs].sort()).toStrictEqual(PRODUCTS.map((p) => p.slug).sort());

    const articleSlugs = (await prisma.article.findMany({ select: { slug: true } })).map(
      (row) => row.slug,
    );
    expect(new Set(articleSlugs).size).toBe(articleSlugs.length);
    expect([...articleSlugs].sort()).toStrictEqual(ARTICLES.map((a) => a.slug).sort());
  });

  test('relasi terisi: produk, artikel, komentar, dan navigasi', async () => {
    const products = await prisma.product.findMany({
      include: { category: true, artisan: true, materials: true },
    });
    for (const product of products) {
      expect(product.artisan).not.toBeNull();
      expect(product.category.slug).toBeTruthy();
      expect(product.materials.filter((m) => m.isPrimary)).toHaveLength(1);
    }

    // Kategori hierarkis: "Pendant"/"Table lamp" berada di bawah "Lighting".
    const lighting = await prisma.category.findUnique({
      where: { slug: 'lighting' },
      include: { children: true },
    });
    expect(lighting?.children).toHaveLength(2);

    const articles = await prisma.article.findMany({
      include: { author: true, category: true, tags: true },
    });
    for (const article of articles) {
      expect(article.author.email).toMatch(/@ornament\.id$/);
      expect(article.category).not.toBeNull();
      expect(article.tags.length).toBeGreaterThan(0);
    }
    // Artikel terjadwal punya publishAt di masa depan (ADR K8).
    const scheduled = articles.filter((a) => a.status === 'SCHEDULED');
    expect(scheduled.length).toBeGreaterThan(0);
    for (const article of scheduled) {
      expect(article.publishAt?.getTime()).toBeGreaterThan(Date.now());
    }

    const comments = await prisma.comment.findMany({ include: { article: true } });
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) {
      expect(comment.article.slug).toBeTruthy();
      expect(comment.authorEmail).not.toBeNull();
    }

    // Nomor inquiry berurutan sejak INQ-0001 (§6.5).
    const inquiries = await prisma.inquiry.findMany({ orderBy: { number: 'asc' } });
    expect(inquiries.map((row) => row.reference)).toStrictEqual(
      inquiries.map((_, index) => `INQ-${String(index + 1).padStart(4, '0')}`),
    );

    // Blok global (Footer) tanpa halaman; sisanya menempel di beranda (D10).
    const blocks = await prisma.pageBlock.findMany();
    for (const block of blocks) {
      expect(block.pageId === null).toBe(block.visibility === 'GLOBAL');
    }

    // Pengaturan situs singleton terisi.
    expect(await prisma.siteSetting.findUnique({ where: { id: 1 } })).not.toBeNull();
  });

  test('idempoten: jalan kedua menghasilkan jumlah baris yang sama', async () => {
    const before = await tableCounts();
    await expect(seedDatabase(prisma)).resolves.toBeDefined();
    expect(await tableCounts()).toStrictEqual(before);
  });

  async function tableCounts(): Promise<Record<string, number>> {
    const [product, article, comment, inquiry, pageBlock, tag, activityLog, qc] = await Promise.all(
      [
        prisma.product.count(),
        prisma.article.count(),
        prisma.comment.count(),
        prisma.inquiry.count(),
        prisma.pageBlock.count(),
        prisma.tag.count(),
        prisma.activityLog.count(),
        prisma.productQcCheck.count(),
      ],
    );
    return { product, article, comment, inquiry, pageBlock, tag, activityLog, qc };
  }
});
