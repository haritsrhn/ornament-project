import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { createTestPrisma } from '../helpers/database.js';

/**
 * Bukti bahwa migrasi awal benar-benar diterapkan dan aturan kunci dari
 * `docs/domain-model.md` berlaku di database, bukan hanya di skema Prisma:
 *
 * - CHECK manual di migrasi (Comment §3.6, PageBlock D10, SiteSetting D11).
 * - Unik parsial manual (ProductMaterial `isPrimary` §3.5).
 * - Unik biasa yang harus tetap berlaku untuk baris di Trash (§6.1).
 * - `onDelete: Restrict` (Product → Category §5).
 *
 * Fixture dibuat dengan sufiks acak dan dihapus di `afterAll`, sehingga tes
 * tidak bergantung pada isi database tes dan tidak meninggalkan data.
 * Pelanggaran constraint sengaja dijalankan **di luar** transaksi bersama:
 * satu statement gagal = satu transaksi implisit yang dibatalkan Postgres.
 */
describe('constraint skema (database tes nyata)', () => {
  const prisma = createTestPrisma();
  const tag = Math.random().toString(36).slice(2, 10);

  let categoryId: string;
  let materialAId: string;
  let materialBId: string;
  let productId: string;
  let userId: string;
  let articleId: string;

  beforeAll(async () => {
    const category = await prisma.category.create({
      data: { name: `Kategori ${tag}`, slug: `kategori-${tag}` },
    });
    categoryId = category.id;

    const [materialA, materialB] = await Promise.all([
      prisma.material.create({ data: { name: `Rotan ${tag}`, slug: `rotan-${tag}` } }),
      prisma.material.create({ data: { name: `Jati ${tag}`, slug: `jati-${tag}` } }),
    ]);
    materialAId = materialA.id;
    materialBId = materialB.id;

    const product = await prisma.product.create({
      data: {
        name: `Kursi ${tag}`,
        slug: `kursi-${tag}`,
        categoryId,
        moqQuantity: 50,
        moqUnit: 'pcs',
        stockStatus: 'MADE_TO_ORDER',
      },
    });
    productId = product.id;

    const user = await prisma.user.create({
      data: {
        email: `penulis-${tag}@ornament.id`,
        name: `Penulis ${tag}`,
        passwordHash: 'argon2id$dummy',
        role: 'EDITOR',
      },
    });
    userId = user.id;

    const article = await prisma.article.create({
      data: {
        title: `Artikel ${tag}`,
        slug: `artikel-${tag}`,
        content: [],
        wordCount: 0,
        authorId: userId,
      },
    });
    articleId = article.id;
  });

  afterAll(async () => {
    // Urutan penting: anak (Cascade/Restrict) lebih dulu, lalu induknya.
    await prisma.comment.deleteMany({ where: { articleId } });
    await prisma.article.deleteMany({ where: { id: articleId } });
    await prisma.productMaterial.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.product.deleteMany({ where: { slug: `kursi-${tag}-2` } });
    await prisma.material.deleteMany({ where: { id: { in: [materialAId, materialBId] } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test('migrasi awal sudah diterapkan (tabel & enum domain ada)', async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('product', 'article', 'inquiry', 'site_setting')
    `;
    expect(Number(rows[0]?.count)).toBe(4);
  });

  test('Comment: CHECK identitas penulis ditolak bila semuanya kosong', async () => {
    await expect(
      prisma.comment.create({
        data: { articleId, authorName: 'Tanpa identitas', body: 'Halo' },
      }),
    ).rejects.toThrow(/comment_author_identity_check/);

    // Dengan authorEmail (komentar pengunjung, Q9) constraint terpenuhi.
    const ok = await prisma.comment.create({
      data: { articleId, authorName: 'Sofia L.', authorEmail: 'sofia@studio.se', body: 'Halo' },
    });
    expect(ok.status).toBe('PENDING');
    expect(ok.notifyOnReply).toBe(false);
  });

  test('ProductMaterial: hanya satu material primer per produk', async () => {
    await prisma.productMaterial.create({
      data: { productId, materialId: materialAId, isPrimary: true },
    });

    await expect(
      prisma.productMaterial.create({
        data: { productId, materialId: materialBId, isPrimary: true },
      }),
    ).rejects.toThrow(/product_material_primary_key/);

    // Material kedua tetap boleh, asalkan bukan primer.
    const secondary = await prisma.productMaterial.create({
      data: { productId, materialId: materialBId, isPrimary: false },
    });
    expect(secondary.isPrimary).toBe(false);
  });

  test('Product: slug tetap unik walau baris ada di Trash (§6.1)', async () => {
    await prisma.product.update({ where: { id: productId }, data: { deletedAt: new Date() } });

    await expect(
      prisma.product.create({
        data: {
          name: `Kursi ${tag} lain`,
          slug: `kursi-${tag}`,
          categoryId,
          moqQuantity: 10,
          moqUnit: 'pcs',
          stockStatus: 'MADE_TO_ORDER',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.product.update({ where: { id: productId }, data: { deletedAt: null } });
  });

  test('Product → Category: Restrict menolak hapus kategori yang masih dipakai', async () => {
    await expect(prisma.category.delete({ where: { id: categoryId } })).rejects.toMatchObject({
      code: 'P2003',
    });
  });

  test('PageBlock: pageId null hanya untuk blok GLOBAL (D10)', async () => {
    await expect(
      prisma.pageBlock.create({
        data: { type: 'FOOTER', name: `Footer ${tag}`, visibility: 'ACTIVE', position: 0 },
      }),
    ).rejects.toThrow(/page_block_global_check/);
  });

  test('SiteSetting: singleton, id selain 1 ditolak (D11)', async () => {
    await expect(
      prisma.siteSetting.create({
        data: {
          id: 2,
          siteName: 'Ornament',
          contactEmail: 'hello@ornament.id',
          siteLanguage: 'ID',
        },
      }),
    ).rejects.toThrow(/site_setting_singleton_check/);
  });
});
