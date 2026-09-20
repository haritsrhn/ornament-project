/**
 * DTO admin taksonomi (kontrak §5.7) — kategori produk (hierarkis), kategori
 * artikel (datar), material, dan tag.
 *
 * Ditulis eksplisit (whitelist, model D9). Berbeda dengan DTO publik,
 * `Material.skuCode` **boleh** muncul di sini: ia internal (kontrak §4), dan
 * layar taksonomi memang mengelolanya.
 */

import type {
  AdminArticleCategory,
  AdminCategory,
  AdminMaterial,
  AdminTag,
} from '@ornament/shared';

import { flattenTree, type CategoryNode } from '../../public/products/taxonomy.js';

export const adminCategorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CategoryRow extends CategoryNode {
  createdAt: Date;
  updatedAt: Date;
}

export const adminArticleCategorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ArticleCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Daftar kategori produk: **datar tetapi urut pohon**, dengan `depth` supaya
 * UI membuat indentasi tanpa menyusun ulang pohonnya (sama seperti DTO publik).
 *
 * `productCount` adalah hitungan **termasuk turunan** (kontrak §5.7) dan
 * dihitung pemanggil lewat `rollUpCounts`, bukan di sini: satu `groupBy`
 * untuk seluruh pohon jauh lebih murah daripada satu query per kategori.
 */
export function toAdminCategories(
  rows: readonly CategoryRow[],
  productCounts: ReadonlyMap<string, number>,
): AdminCategory[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return flattenTree(rows).map(({ node, depth }) => {
    const row = byId.get(node.id);
    /* c8 ignore next */
    if (row === undefined) throw new Error(`kategori ${node.id} hilang saat menyusun DTO`);
    return {
      id: row.id,
      type: 'PRODUCT' as const,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId,
      description: row.description,
      position: row.position,
      depth,
      productCount: productCounts.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export function toAdminArticleCategory(
  row: ArticleCategoryRow,
  articleCount: number,
): AdminArticleCategory {
  return {
    id: row.id,
    type: 'ARTICLE',
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    articleCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const adminMaterialSelect = {
  id: true,
  name: true,
  slug: true,
  skuCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface MaterialRow {
  id: string;
  name: string;
  slug: string;
  skuCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
}

export function toAdminMaterial(row: MaterialRow): AdminMaterial {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    skuCode: row.skuCode,
    // Diturunkan dari `ProductMaterial` (model §3.3), bukan kolom tersimpan.
    productCount: row._count.products,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  _count: { products: number; articles: number };
}

export function toAdminTag(row: TagRow): AdminTag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    // Satu tag dipakai produk **dan** artikel (model §3.3), jadi "jumlah
    // pemakaian" di layar taksonomi adalah jumlah keduanya.
    usageCount: row._count.products + row._count.articles,
  };
}
