/**
 * Admin taksonomi — kontrak API §5.7 (`/v1/admin/categories`, `/materials`,
 * `/tags`).
 *
 * Satu set endpoint melayani **dua tabel** lewat query `type` (Q4):
 * `PRODUCT` → `Category` (hierarkis, `parentId`), `ARTICLE` →
 * `ArticleCategory` (datar). Layar `/admin/taxonomy` menampilkannya sebagai
 * tab Produk/Artikel dan memanggil endpoint yang sama — tidak ada modul admin
 * kedua yang harus ikut diubah setiap kali aturannya bergeser.
 *
 * Izin (§3.2): **baca** boleh semua peran (Contributor butuh konteks untuk
 * menulis draf), **tulis** butuh `taxonomy.write` (Editor+), karena taksonomi
 * memengaruhi katalog dan journal publik.
 */

import {
  adminCategoriesQuerySchema,
  adminCategoryResponseSchema,
  adminCategoriesResponseSchema,
  adminMaterialResponseSchema,
  adminMaterialsQuerySchema,
  adminMaterialsResponseSchema,
  adminTagsQuerySchema,
  adminTagsResponseSchema,
  categoryIdParamsSchema,
  categoryOrderBodySchema,
  categoryTypeQuerySchema,
  createCategoryBodySchema,
  createMaterialBodySchema,
  IN_USE_USAGES_MAX,
  materialIdParamsSchema,
  tagIdParamsSchema,
  TAXONOMY_BUSINESS_RULES,
  updateCategoryBodySchema,
  updateMaterialBodySchema,
  type AdminAnyCategory,
  type CategoryType,
} from '@ornament/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Prisma } from '../../../generated/prisma/client.js';
import {
  AppError,
  badRequest,
  businessRuleViolation,
  conflict,
  notFound,
} from '../../../lib/errors.js';
import { ok } from '../../../lib/http.js';
import { escapeLike } from '../../../lib/like.js';
import { isUniqueViolation, uniqueConflictFields } from '../../../lib/prisma-error.js';
import { adminRateLimit } from '../../../lib/rate-limit.js';
import { slugify, uniqueSlug } from '../../../lib/slug.js';
import { adminPermission, adminSession, currentSession } from '../../auth/guard.js';
import { rollUpCounts } from '../../public/products/taxonomy.js';
import {
  adminArticleCategorySelect,
  adminCategorySelect,
  adminMaterialSelect,
  toAdminArticleCategory,
  toAdminCategories,
  toAdminMaterial,
  toAdminTag,
  type ArticleCategoryRow,
  type CategoryRow,
} from './dto.js';

/** `409 IN_USE` (kontrak §1.10 Q5): apa yang menahan penghapusan, dan berapa. */
interface Usage {
  entityType: string;
  id: string;
  label: string;
}

/**
 * `409 IN_USE` dengan `total`/`counts` dari hitungan **sebenarnya**, sementara
 * `usages` hanya memuat maksimal 20 contoh (kontrak §1.10). Dipisah karena UI
 * menulis "masih digunakan oleh 9 produk" dari `counts`, yang tidak boleh
 * ikut terpotong bersama daftar contohnya.
 */
function inUseWithCounts(
  usages: Usage[],
  counts: Record<string, number>,
  message: string,
): AppError {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return new AppError('IN_USE', message, {
    details: { usages: usages.slice(0, IN_USE_USAGES_MAX), total, counts },
  });
}

function asConflict(error: unknown, fallback: string[]): never {
  if (isUniqueViolation(error)) throw conflict(uniqueConflictFields(error, fallback));
  throw error;
}

export const adminTaxonomyRoutes: FastifyPluginAsyncZod = (app) => {
  const rateLimit = adminRateLimit();
  /** Baca: semua peran (kontrak §3.2). */
  const readAccess = { adminAccess: adminSession(), ...rateLimit };
  /** Tulis: Editor+ lewat `taxonomy.write` (kontrak §3.3). */
  const writeAccess = { adminAccess: adminPermission('taxonomy.write'), ...rateLimit };

  // ── Kategori produk: pohon ────────────────────────────────────────────────

  async function loadCategoryTree(): Promise<CategoryRow[]> {
    return app.prisma.category.findMany({ select: adminCategorySelect });
  }

  /**
   * Hitungan produk per kategori **termasuk turunan** (kontrak §5.7): semua
   * `publishStatus`, di luar Trash. Satu `groupBy` untuk seluruh pohon, lalu
   * dijumlahkan naik ke setiap leluhur (`rollUpCounts`).
   */
  async function productCountsByCategory(
    nodes: readonly CategoryRow[],
  ): Promise<Map<string, number>> {
    const groups = await app.prisma.product.groupBy({
      by: ['categoryId'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const own = new Map(groups.map((group) => [group.categoryId, group._count._all]));
    return rollUpCounts(nodes, own);
  }

  async function respondCategoryTree(q: string | undefined): Promise<AdminAnyCategory[]> {
    const nodes = await loadCategoryTree();
    const counts = await productCountsByCategory(nodes);
    const all = toAdminCategories(nodes, counts);
    if (q === undefined) return all;
    // Pencarian disaring **setelah** pohon disusun supaya `depth` tetap
    // mencerminkan posisi sebenarnya di pohon, bukan posisi di hasil saring.
    const needle = q.toLowerCase();
    return all.filter(
      (category) =>
        category.name.toLowerCase().includes(needle) ||
        category.slug.toLowerCase().includes(needle),
    );
  }

  async function respondArticleCategories(q: string | undefined): Promise<AdminAnyCategory[]> {
    const where: Prisma.ArticleCategoryWhereInput =
      q === undefined
        ? {}
        : {
            OR: [
              { name: { contains: escapeLike(q), mode: 'insensitive' } },
              { slug: { contains: escapeLike(q), mode: 'insensitive' } },
            ],
          };
    const rows = await app.prisma.articleCategory.findMany({
      where,
      select: { ...adminArticleCategorySelect, _count: { select: { articles: true } } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) =>
      toAdminArticleCategory(row as ArticleCategoryRow, row._count.articles),
    );
  }

  /** `id` yang tidak ada **pada tipe itu** → `404` (kontrak §5.7). */
  async function loadCategory(type: CategoryType, id: string) {
    if (type === 'ARTICLE') {
      const row = await app.prisma.articleCategory.findUnique({
        where: { id },
        select: adminArticleCategorySelect,
      });
      if (row === null) throw notFound('Kategori artikel tidak ditemukan.');
      return row;
    }
    const row = await app.prisma.category.findUnique({
      where: { id },
      select: adminCategorySelect,
    });
    if (row === null) throw notFound('Kategori tidak ditemukan.');
    return row;
  }

  async function categorySlugTaken(
    type: CategoryType,
    slug: string,
    exceptId?: string,
  ): Promise<boolean> {
    const row =
      type === 'ARTICLE'
        ? await app.prisma.articleCategory.findUnique({ where: { slug }, select: { id: true } })
        : await app.prisma.category.findUnique({ where: { slug }, select: { id: true } });
    return row !== null && row.id !== exceptId;
  }

  async function resolveCategorySlug(
    type: CategoryType,
    input: { requested?: string | undefined; name: string },
    exceptId?: string,
  ): Promise<string> {
    if (input.requested !== undefined) {
      if (await categorySlugTaken(type, input.requested, exceptId)) throw conflict(['slug']);
      return input.requested;
    }
    return uniqueSlug(slugify(input.name), (candidate) =>
      categorySlugTaken(type, candidate, exceptId),
    );
  }

  /**
   * Menolak induk yang membuat siklus (kontrak §5.7 `CATEGORY_CYCLE`): induk
   * baru tidak boleh dirinya sendiri maupun salah satu turunannya. Dicek di
   * aplikasi karena FK `Restrict` hanya menjamin induknya ada, bukan bahwa
   * pohonnya tetap pohon.
   */
  function assertNoCycle(
    nodes: readonly { id: string; parentId: string | null }[],
    id: string,
    parentId: string | null,
  ): void {
    if (parentId === null) return;
    if (parentId === id) {
      throw businessRuleViolation(
        TAXONOMY_BUSINESS_RULES.CATEGORY_CYCLE,
        'Kategori tidak boleh menjadi induk dirinya sendiri.',
      );
    }
    const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
    // Naik dari calon induk; bila bertemu `id`, berarti induknya ada di bawah
    // kategori ini. `visited` menjaga agar data yang sudah terlanjur melingkar
    // tidak membuat loop tak berujung.
    const visited = new Set<string>();
    let current: string | null = parentId;
    while (current !== null && !visited.has(current)) {
      if (current === id) {
        throw businessRuleViolation(
          TAXONOMY_BUSINESS_RULES.CATEGORY_CYCLE,
          'Induk tidak boleh salah satu turunan kategori ini.',
        );
      }
      visited.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  async function assertParentExists(parentId: string): Promise<void> {
    const parent = await app.prisma.category.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (parent === null) {
      throw businessRuleViolation(
        TAXONOMY_BUSINESS_RULES.PARENT_NOT_FOUND,
        'Kategori induk tidak ditemukan.',
      );
    }
  }

  app.get(
    '/admin/categories',
    {
      config: readAccess,
      schema: {
        querystring: adminCategoriesQuerySchema,
        response: { 200: adminCategoriesResponseSchema },
      },
    },
    async (request) => {
      const { type, q } = request.query;
      return ok(
        type === 'ARTICLE' ? await respondArticleCategories(q) : await respondCategoryTree(q),
      );
    },
  );

  app.post(
    '/admin/categories',
    {
      config: writeAccess,
      schema: {
        querystring: categoryTypeQuerySchema,
        body: createCategoryBodySchema,
        response: { 201: adminCategoryResponseSchema },
      },
    },
    async (request, reply) => {
      const { type } = request.query;
      const body = request.body;
      const actor = currentSession(request).user;

      if (type === 'ARTICLE') {
        if (body.parentId !== undefined) {
          // Kategori artikel datar (model §3.3), jadi `parentId` bukan
          // "diabaikan diam-diam" melainkan input yang salah.
          throw badRequest('Kategori artikel tidak memiliki induk.', [
            {
              path: 'parentId',
              code: 'invalid_value',
              message: 'Kategori artikel tidak bertingkat.',
            },
          ]);
        }
        const slug = await resolveCategorySlug('ARTICLE', {
          requested: body.slug,
          name: body.name,
        });
        const created = await app.prisma.articleCategory
          .create({
            data: {
              name: body.name,
              slug,
              description: body.description ?? null,
              position: body.position ?? 0,
            },
            select: adminArticleCategorySelect,
          })
          .catch((error: unknown) => asConflict(error, ['name']));
        request.log.info({ actorId: actor.id, categoryId: created.id }, 'kategori artikel dibuat');
        return reply.code(201).send(ok(toAdminArticleCategory(created, 0)));
      }

      const parentId = body.parentId ?? null;
      if (parentId !== null) await assertParentExists(parentId);
      const slug = await resolveCategorySlug('PRODUCT', { requested: body.slug, name: body.name });

      const created = await app.prisma.category
        .create({
          data: {
            name: body.name,
            slug,
            parentId,
            description: body.description ?? null,
            position: body.position ?? 0,
          },
          select: adminCategorySelect,
        })
        .catch((error: unknown) => asConflict(error, ['slug']));

      request.log.info({ actorId: actor.id, categoryId: created.id }, 'kategori produk dibuat');
      const nodes = await loadCategoryTree();
      const dto = toAdminCategories(nodes, await productCountsByCategory(nodes)).find(
        (category) => category.id === created.id,
      );
      /* c8 ignore next */
      if (dto === undefined) throw new Error('kategori baru tidak ditemukan di pohon');
      return reply.code(201).send(ok(dto));
    },
  );

  app.patch(
    '/admin/categories/:id',
    {
      config: writeAccess,
      schema: {
        params: categoryIdParamsSchema,
        querystring: categoryTypeQuerySchema,
        body: updateCategoryBodySchema,
        response: { 200: adminCategoryResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { type } = request.query;
      const body = request.body;
      await loadCategory(type, id);

      if (type === 'ARTICLE') {
        if (body.parentId !== undefined) {
          throw badRequest('Kategori artikel tidak memiliki induk.', [
            {
              path: 'parentId',
              code: 'invalid_value',
              message: 'Kategori artikel tidak bertingkat.',
            },
          ]);
        }
        const slug =
          body.slug === undefined
            ? undefined
            : await resolveCategorySlug('ARTICLE', { requested: body.slug, name: '' }, id);
        const updated = await app.prisma.articleCategory
          .update({
            where: { id },
            data: {
              ...(body.name === undefined ? {} : { name: body.name }),
              ...(slug === undefined ? {} : { slug }),
              ...(body.description === undefined ? {} : { description: body.description }),
              ...(body.position === undefined ? {} : { position: body.position }),
            },
            select: { ...adminArticleCategorySelect, _count: { select: { articles: true } } },
          })
          .catch((error: unknown) => asConflict(error, ['name']));
        return ok(toAdminArticleCategory(updated as ArticleCategoryRow, updated._count.articles));
      }

      if (body.parentId !== undefined && body.parentId !== null) {
        await assertParentExists(body.parentId);
      }
      if (body.parentId !== undefined) {
        assertNoCycle(await loadCategoryTree(), id, body.parentId);
      }
      const slug =
        body.slug === undefined
          ? undefined
          : await resolveCategorySlug('PRODUCT', { requested: body.slug, name: '' }, id);

      await app.prisma.category
        .update({
          where: { id },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(slug === undefined ? {} : { slug }),
            ...(body.parentId === undefined ? {} : { parentId: body.parentId }),
            ...(body.description === undefined ? {} : { description: body.description }),
            ...(body.position === undefined ? {} : { position: body.position }),
          },
          select: { id: true },
        })
        .catch((error: unknown) => asConflict(error, ['slug']));

      const nodes = await loadCategoryTree();
      const dto = toAdminCategories(nodes, await productCountsByCategory(nodes)).find(
        (category) => category.id === id,
      );
      /* c8 ignore next */
      if (dto === undefined) throw new Error('kategori tidak ditemukan di pohon setelah diubah');
      return ok(dto);
    },
  );

  app.put(
    '/admin/categories/order',
    {
      config: writeAccess,
      schema: {
        querystring: categoryTypeQuerySchema,
        body: categoryOrderBodySchema,
        response: { 200: adminCategoriesResponseSchema },
      },
    },
    async (request) => {
      const { type } = request.query;
      const { items } = request.body;

      if (type === 'ARTICLE') {
        const existing = await app.prisma.articleCategory.findMany({ select: { id: true } });
        assertSameSet(
          existing.map((row) => row.id),
          items.map((item) => item.id),
        );
        if (items.some((item) => item.parentId !== null)) {
          throw badRequest('Kategori artikel tidak memiliki induk.', [
            {
              path: 'items',
              code: 'invalid_value',
              message: 'parentId kategori artikel harus null.',
            },
          ]);
        }
        await app.prisma.$transaction(
          items.map((item) =>
            app.prisma.articleCategory.update({
              where: { id: item.id },
              data: { position: item.position },
              select: { id: true },
            }),
          ),
        );
        return ok(await respondArticleCategories(undefined));
      }

      const existing = await app.prisma.category.findMany({ select: { id: true } });
      assertSameSet(
        existing.map((row) => row.id),
        items.map((item) => item.id),
      );
      // Siklus diperiksa terhadap susunan **hasil**, bukan susunan sekarang:
      // seluruh pohon berubah sekaligus, jadi pohon lamanya tidak relevan.
      const next = items.map((item) => ({ id: item.id, parentId: item.parentId }));
      for (const item of items) assertNoCycle(next, item.id, item.parentId);

      await app.prisma.$transaction(
        items.map((item) =>
          app.prisma.category.update({
            where: { id: item.id },
            data: { parentId: item.parentId, position: item.position },
            select: { id: true },
          }),
        ),
      );
      return ok(await respondCategoryTree(undefined));
    },
  );

  /**
   * `PUT /order` menerima **seluruh** pohon sekaligus (kontrak §5.7). Kiriman
   * sebagian ditolak `CATEGORY_SET_MISMATCH`: menerapkannya akan menghasilkan
   * urutan yang tidak pernah diminta siapa pun.
   */
  function assertSameSet(existing: string[], sent: string[]): void {
    const existingSet = new Set(existing);
    const sentSet = new Set(sent);
    const sama =
      existingSet.size === sentSet.size && [...existingSet].every((id) => sentSet.has(id));
    if (!sama) {
      throw businessRuleViolation(
        TAXONOMY_BUSINESS_RULES.CATEGORY_SET_MISMATCH,
        'Kirim seluruh kategori bertipe ini, tepat satu kali masing-masing.',
      );
    }
  }

  app.delete(
    '/admin/categories/:id',
    {
      config: writeAccess,
      schema: { params: categoryIdParamsSchema, querystring: categoryTypeQuerySchema },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { type } = request.query;
      await loadCategory(type, id);

      if (type === 'ARTICLE') {
        // Termasuk artikel di Trash (kontrak §5.7): memulihkan artikel yang
        // kategorinya sudah hilang akan menghasilkan baris tanpa kategori.
        const articles = await app.prisma.article.findMany({
          where: { categoryId: id },
          select: { id: true, title: true },
          take: IN_USE_USAGES_MAX,
        });
        const total = await app.prisma.article.count({ where: { categoryId: id } });
        if (total > 0) {
          throw inUseWithCounts(
            articles.map((article) => ({
              entityType: 'Article',
              id: article.id,
              label: article.title,
            })),
            { Article: total },
            `Kategori tidak dapat dihapus karena masih digunakan oleh ${String(total)} artikel. Pindahkan terlebih dahulu.`,
          );
        }
        await app.prisma.articleCategory.delete({ where: { id }, select: { id: true } });
        return reply.code(204).send();
      }

      const [children, products, childCount, productCount] = await Promise.all([
        app.prisma.category.findMany({
          where: { parentId: id },
          select: { id: true, name: true },
          take: IN_USE_USAGES_MAX,
        }),
        app.prisma.product.findMany({
          where: { categoryId: id },
          select: { id: true, name: true },
          take: IN_USE_USAGES_MAX,
        }),
        app.prisma.category.count({ where: { parentId: id } }),
        app.prisma.product.count({ where: { categoryId: id } }),
      ]);

      if (childCount > 0 || productCount > 0) {
        const counts: Record<string, number> = {};
        if (productCount > 0) counts.Product = productCount;
        if (childCount > 0) counts.Category = childCount;
        const bagian = [
          productCount > 0 ? `${String(productCount)} produk` : null,
          childCount > 0 ? `${String(childCount)} subkategori` : null,
        ].filter((part): part is string => part !== null);

        throw inUseWithCounts(
          [
            ...children.map((child) => ({
              entityType: 'Category',
              id: child.id,
              label: child.name,
            })),
            ...products.map((product) => ({
              entityType: 'Product',
              id: product.id,
              label: product.name,
            })),
          ],
          counts,
          `Kategori tidak dapat dihapus karena masih digunakan oleh ${bagian.join(' dan ')}. Pindahkan terlebih dahulu.`,
        );
      }

      await app.prisma.category.delete({ where: { id }, select: { id: true } });
      return reply.code(204).send();
    },
  );

  // ── Material ──────────────────────────────────────────────────────────────

  app.get(
    '/admin/materials',
    {
      config: readAccess,
      schema: {
        querystring: adminMaterialsQuerySchema,
        response: { 200: adminMaterialsResponseSchema },
      },
    },
    async (request) => {
      const { q } = request.query;
      const rows = await app.prisma.material.findMany({
        where:
          q === undefined
            ? {}
            : {
                OR: [
                  { name: { contains: escapeLike(q), mode: 'insensitive' } },
                  { slug: { contains: escapeLike(q), mode: 'insensitive' } },
                  { skuCode: { contains: escapeLike(q), mode: 'insensitive' } },
                ],
              },
        select: { ...adminMaterialSelect, _count: { select: { products: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return ok(rows.map(toAdminMaterial));
    },
  );

  app.post(
    '/admin/materials',
    {
      config: writeAccess,
      schema: { body: createMaterialBodySchema, response: { 201: adminMaterialResponseSchema } },
    },
    async (request, reply) => {
      const body = request.body;
      const slug =
        body.slug ??
        (await uniqueSlug(slugify(body.name), async (candidate) => {
          const row = await app.prisma.material.findUnique({
            where: { slug: candidate },
            select: { id: true },
          });
          return row !== null;
        }));

      const created = await app.prisma.material
        .create({
          data: { name: body.name, slug, skuCode: body.skuCode ?? null },
          select: { ...adminMaterialSelect, _count: { select: { products: true } } },
        })
        // `name`, `slug`, dan `skuCode` semuanya unik (model §3.3); `meta.target`
        // memberi tahu yang mana, jadi UI bisa menyorot field yang tepat.
        .catch((error: unknown) => asConflict(error, ['name']));

      return reply.code(201).send(ok(toAdminMaterial(created)));
    },
  );

  app.patch(
    '/admin/materials/:id',
    {
      config: writeAccess,
      schema: {
        params: materialIdParamsSchema,
        body: updateMaterialBodySchema,
        response: { 200: adminMaterialResponseSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const body = request.body;
      const current = await app.prisma.material.findUnique({ where: { id }, select: { id: true } });
      if (current === null) throw notFound('Material tidak ditemukan.');

      const updated = await app.prisma.material
        .update({
          where: { id },
          data: {
            ...(body.name === undefined ? {} : { name: body.name }),
            ...(body.slug === undefined ? {} : { slug: body.slug }),
            // Mengubah `skuCode` **tidak** mengubah SKU produk lama (§6.2):
            // SKU yang sudah tercetak di dokumen tidak boleh berubah sendiri.
            ...(body.skuCode === undefined ? {} : { skuCode: body.skuCode }),
          },
          select: { ...adminMaterialSelect, _count: { select: { products: true } } },
        })
        .catch((error: unknown) => asConflict(error, ['name']));

      return ok(toAdminMaterial(updated));
    },
  );

  app.delete(
    '/admin/materials/:id',
    { config: writeAccess, schema: { params: materialIdParamsSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const current = await app.prisma.material.findUnique({ where: { id }, select: { id: true } });
      if (current === null) throw notFound('Material tidak ditemukan.');

      const [usages, total, inquiryCount] = await Promise.all([
        app.prisma.productMaterial.findMany({
          where: { materialId: id },
          select: { product: { select: { id: true, name: true } } },
          take: IN_USE_USAGES_MAX,
        }),
        app.prisma.productMaterial.count({ where: { materialId: id } }),
        app.prisma.inquiry.count({ where: { materialId: id } }),
      ]);

      if (total > 0 || inquiryCount > 0) {
        const counts: Record<string, number> = {};
        if (total > 0) counts.Product = total;
        if (inquiryCount > 0) counts.Inquiry = inquiryCount;
        throw inUseWithCounts(
          usages.map((usage) => ({
            entityType: 'Product',
            id: usage.product.id,
            label: usage.product.name,
          })),
          counts,
          `Material tidak dapat dihapus karena masih digunakan oleh ${String(total + inquiryCount)} data. Lepaskan terlebih dahulu.`,
        );
      }

      await app.prisma.material.delete({ where: { id }, select: { id: true } });
      return reply.code(204).send();
    },
  );

  // ── Tag ───────────────────────────────────────────────────────────────────

  app.get(
    '/admin/tags',
    {
      config: readAccess,
      schema: { querystring: adminTagsQuerySchema, response: { 200: adminTagsResponseSchema } },
    },
    async (request) => {
      const { q, limit } = request.query;
      const rows = await app.prisma.tag.findMany({
        // Prefix (kontrak §5.7), bukan `contains`: field ini mengisi
        // autocomplete saat mengetik, bukan pencarian bebas.
        where: q === undefined ? {} : { name: { startsWith: escapeLike(q), mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: { select: { products: true, articles: true } },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit,
      });
      return ok(rows.map(toAdminTag));
    },
  );

  app.delete(
    '/admin/tags/:id',
    { config: writeAccess, schema: { params: tagIdParamsSchema } },
    async (request, reply) => {
      const { id } = request.params;
      const current = await app.prisma.tag.findUnique({ where: { id }, select: { id: true } });
      if (current === null) throw notFound('Tag tidak ditemukan.');
      // Tanpa `409 IN_USE` (kontrak §5.7): relasi tag memakai `Cascade`, jadi
      // menghapus tag hanya melepaskannya dari konten — tidak ada yang hilang.
      await app.prisma.tag.delete({ where: { id }, select: { id: true } });
      return reply.code(204).send();
    },
  );

  return Promise.resolve();
};
