import { z } from 'zod';

import { publicMediaSchema } from './common.js';
import { dataEnvelope } from './envelope.js';
import {
  blockLayoutSchema,
  blockTypeSchema,
  navItemStyleSchema,
  navItemTypeSchema,
  siteLanguageSchema,
  slugRedirectTypeSchema,
} from './enums.js';
import { filterSlugSchema } from './products.js';

/**
 * Kontrak situs publik — kontrak API §5.5 (`GET /v1/public/settings`,
 * `/nav-items`, `/pages`, `/blocks/global`, `/sitemap`, `/redirects`).
 *
 * **Privasi (kontrak §4):** whitelist eksplisit. `SiteSetting.lowStockThreshold`
 * 🔒 dan `updatedById` tidak punya tempat di sini; blok `HIDDEN`, `systemKey`,
 * `updatedById`, dan `deletedAt` halaman juga tidak, dan `NavItem.pageId`/
 * `categoryId` diganti `href` turunan.
 */

// ── Prefiks URL situs publik ─────────────────────────────────────────────────

/**
 * Satu-satunya tempat prefiks URL publik ditulis: dipakai `/redirects`
 * (`path` tujuan, §6.10) dan `/sitemap`. Halaman memakai `Page.path` apa adanya.
 */
export const PUBLIC_PRODUCT_PATH_PREFIX = '/produk';
export const PUBLIC_ARTICLE_PATH_PREFIX = '/journal';
export const PUBLIC_ARTISAN_PATH_PREFIX = '/pengrajin';

/** `/produk/<slug>` atau `/journal/<slug>` sesuai tipe redirect (kontrak §5.5). */
export function publicRedirectPath(type: z.infer<typeof slugRedirectTypeSchema>, slug: string) {
  const prefix = type === 'PRODUCT' ? PUBLIC_PRODUCT_PATH_PREFIX : PUBLIC_ARTICLE_PATH_PREFIX;
  return `${prefix}/${slug}`;
}

// ── Pengaturan situs ─────────────────────────────────────────────────────────

export const publicSiteSettingSchema = z.object({
  siteName: z.string(),
  tagline: z.string().nullable(),
  /** Menggantikan `NEXT_PUBLIC_CONTACT_EMAIL` di situs publik (model §3.8). */
  contactEmail: z.string(),
  instagramHandle: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  siteLanguage: siteLanguageSchema,
  timezone: z.string(),
  address: z.string().nullable(),
  logo: publicMediaSchema.nullable(),
  icon: publicMediaSchema.nullable(),
  seoHomeTitle: z.string().nullable(),
  seoKeywords: z.string().nullable(),
  seoDescription: z.string().nullable(),
  sitemapEnabled: z.boolean(),
  /** `false` = situs meminta `noindex` (model §3.8). */
  allowIndexing: z.boolean(),
});
export type PublicSiteSetting = z.infer<typeof publicSiteSettingSchema>;

// ── Menu navigasi ────────────────────────────────────────────────────────────

/**
 * `href` **diturunkan** server (kontrak §5.5): `PAGE` → `Page.path`,
 * `CATEGORY` → `/catalog?category=<slug>`, `ARTICLE_ARCHIVE` → `/journal`,
 * `CUSTOM_LINK` → `url`. Karena itu `pageId`/`categoryId` tidak pernah dikirim.
 */
export const publicNavItemSchema = z.object({
  label: z.string(),
  type: navItemTypeSchema,
  href: z.string(),
  style: navItemStyleSchema,
  position: z.int(),
});
export type PublicNavItem = z.infer<typeof publicNavItemSchema>;

/** Arsip artikel dan filter katalog: bentuk `href` turunan (kontrak §5.5). */
export const NAV_ARTICLE_ARCHIVE_HREF = PUBLIC_ARTICLE_PATH_PREFIX;
export const navCategoryHref = (slug: string) => `/catalog?category=${encodeURIComponent(slug)}`;

// ── Halaman & blok ───────────────────────────────────────────────────────────

export const publicBlockCtaSchema = z.object({ label: z.string(), url: z.string() });
export type PublicBlockCta = z.infer<typeof publicBlockCtaSchema>;

export const publicBlockSchema = z.object({
  id: z.uuid(),
  type: blockTypeSchema,
  layout: blockLayoutSchema,
  /** Turunan `pageId === null` (model D10): blok yang tampil di semua halaman. */
  isGlobal: z.boolean(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  cta1: publicBlockCtaSchema.nullable(),
  cta2: publicBlockCtaSchema.nullable(),
  image: publicMediaSchema.nullable(),
  /**
   * Opsi khusus tipe, mis. `{ "productCount": 6 }` untuk `PRODUCT_PREVIEW`;
   * produknya diambil Next lewat `/v1/public/products` (kontrak §5.5).
   */
  config: z.record(z.string(), z.unknown()).nullable(),
});
export type PublicBlock = z.infer<typeof publicBlockSchema>;

export const publicPageSchema = z.object({
  path: z.string(),
  title: z.string(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  /** Blok `ACTIVE` halaman ini urut `position`, lalu blok `GLOBAL` urut `position`. */
  blocks: z.array(publicBlockSchema),
});
export type PublicPage = z.infer<typeof publicPageSchema>;

/** `path` halaman, mis. `/our-story`; harus diawali `/` (model §3.8). */
export const pagePathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.startsWith('/'), { error: 'Path harus diawali "/".' });

export const publicPageQuerySchema = z.object({ path: pagePathSchema });
export type PublicPageQuery = z.infer<typeof publicPageQuerySchema>;

// ── Sitemap ──────────────────────────────────────────────────────────────────

export const publicSitemapEntrySchema = z.object({
  path: z.string(),
  updatedAt: z.iso.datetime(),
});
export type PublicSitemapEntry = z.infer<typeof publicSitemapEntrySchema>;

export const publicSitemapSchema = z.object({
  /** `SiteSetting.sitemapEnabled`; Next yang memutuskan merender atau tidak. */
  enabled: z.boolean(),
  entries: z.array(publicSitemapEntrySchema),
});
export type PublicSitemap = z.infer<typeof publicSitemapSchema>;

// ── Redirect slug lama ───────────────────────────────────────────────────────

export const publicRedirectQuerySchema = z.object({
  type: slugRedirectTypeSchema,
  /** Slug **lama** yang dicari (`SlugRedirect.fromSlug`). */
  slug: filterSlugSchema,
});
export type PublicRedirectQuery = z.infer<typeof publicRedirectQuerySchema>;

export const publicRedirectSchema = z.object({
  type: slugRedirectTypeSchema,
  fromSlug: z.string(),
  toSlug: z.string(),
  path: z.string(),
  /** Selalu 301: redirect menunjuk entitas, jadi tujuannya permanen (Q8). */
  statusCode: z.literal(301),
});
export type PublicRedirect = z.infer<typeof publicRedirectSchema>;

// ── Respons ──────────────────────────────────────────────────────────────────

export const publicSettingsResponseSchema = dataEnvelope(publicSiteSettingSchema);
export const publicNavItemsResponseSchema = dataEnvelope(z.array(publicNavItemSchema));
export const publicPageResponseSchema = dataEnvelope(publicPageSchema);
export const publicBlocksResponseSchema = dataEnvelope(z.array(publicBlockSchema));
export const publicSitemapResponseSchema = dataEnvelope(publicSitemapSchema);
export const publicRedirectResponseSchema = dataEnvelope(publicRedirectSchema);
