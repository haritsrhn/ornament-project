/**
 * DTO situs publik (kontrak §5.5) dan `select` Prisma-nya.
 *
 * **Whitelist, bukan `omit`** (kontrak §4). Yang sengaja tidak pernah disebut:
 * `SiteSetting.lowStockThreshold` 🔒 dan `updatedById`; `Page.systemKey`,
 * `updatedById`, `deletedAt`; `NavItem.pageId`/`categoryId` (diganti `href`
 * turunan); serta blok `HIDDEN` (disaring di rute).
 */

import type {
  BlockLayout,
  BlockType,
  NavItemStyle,
  NavItemType,
  PublicBlock,
  PublicBlockCta,
  PublicNavItem,
  PublicSiteSetting,
  SiteLanguage,
} from '@ornament/shared';
import { NAV_ARTICLE_ARCHIVE_HREF, navCategoryHref } from '@ornament/shared';

import { publicMediaSelect, toPublicMedia, type PublicMediaRow } from '../media.js';

// ── Pengaturan situs ─────────────────────────────────────────────────────────

export const publicSiteSettingSelect = {
  siteName: true,
  tagline: true,
  contactEmail: true,
  instagramHandle: true,
  instagramUrl: true,
  siteLanguage: true,
  timezone: true,
  address: true,
  seoHomeTitle: true,
  seoKeywords: true,
  seoDescription: true,
  sitemapEnabled: true,
  allowIndexing: true,
  logo: { select: publicMediaSelect },
  icon: { select: publicMediaSelect },
} as const;

export interface SiteSettingRow {
  siteName: string;
  tagline: string | null;
  contactEmail: string;
  instagramHandle: string | null;
  instagramUrl: string | null;
  siteLanguage: SiteLanguage;
  timezone: string;
  address: string | null;
  seoHomeTitle: string | null;
  seoKeywords: string | null;
  seoDescription: string | null;
  sitemapEnabled: boolean;
  allowIndexing: boolean;
  logo: PublicMediaRow | null;
  icon: PublicMediaRow | null;
}

export function toPublicSiteSetting(
  row: SiteSettingRow,
  mediaPublicUrl: string | undefined,
): PublicSiteSetting {
  return {
    siteName: row.siteName,
    tagline: row.tagline,
    contactEmail: row.contactEmail,
    instagramHandle: row.instagramHandle,
    instagramUrl: row.instagramUrl,
    siteLanguage: row.siteLanguage,
    timezone: row.timezone,
    address: row.address,
    logo: toPublicMedia(row.logo, mediaPublicUrl),
    icon: toPublicMedia(row.icon, mediaPublicUrl),
    seoHomeTitle: row.seoHomeTitle,
    seoKeywords: row.seoKeywords,
    seoDescription: row.seoDescription,
    sitemapEnabled: row.sitemapEnabled,
    allowIndexing: row.allowIndexing,
  };
}

// ── Menu navigasi ────────────────────────────────────────────────────────────

/**
 * `page.status`/`deletedAt` hanya dipakai untuk memutuskan item mana yang
 * dikirim (§5.5: item yang menunjuk halaman tidak terbit tidak dikirim); tidak
 * satu pun dari keduanya masuk respons.
 */
export const publicNavItemSelect = {
  label: true,
  type: true,
  url: true,
  style: true,
  position: true,
  page: { select: { path: true, status: true, deletedAt: true } },
  category: { select: { slug: true } },
} as const;

export interface NavItemRow {
  label: string;
  type: NavItemType;
  url: string | null;
  style: NavItemStyle;
  position: number;
  page: { path: string; status: string; deletedAt: Date | null } | null;
  category: { slug: string } | null;
}

/**
 * `href` turunan (§5.5). `null` = item tidak bisa dirender dan **dibuang**:
 * halaman tujuannya tidak terbit/di Trash, atau targetnya hilang (hanya mungkin
 * bila constraint `nav_item_target_check` dilanggar dari luar API).
 */
export function navItemHref(row: NavItemRow): string | null {
  switch (row.type) {
    case 'PAGE':
      if (row.page?.status !== 'PUBLISHED' || row.page.deletedAt !== null) return null;
      return row.page.path;
    case 'CATEGORY':
      return row.category === null ? null : navCategoryHref(row.category.slug);
    case 'ARTICLE_ARCHIVE':
      return NAV_ARTICLE_ARCHIVE_HREF;
    case 'CUSTOM_LINK':
      return row.url === null || row.url === '' ? null : row.url;
  }
}

export function toPublicNavItem(row: NavItemRow, href: string): PublicNavItem {
  return {
    label: row.label,
    type: row.type,
    href,
    style: row.style,
    position: row.position,
  };
}

// ── Halaman & blok ───────────────────────────────────────────────────────────

/**
 * `pageId` dipilih untuk menurunkan `isGlobal` (model D10: `pageId = null` ⇔
 * blok global) dan untuk mengurutkan blok halaman sebelum blok global; ia
 * sendiri tidak pernah dikirim. `visibility` dipakai sebagai filter dan juga
 * tidak dikirim.
 */
export const publicBlockSelect = {
  id: true,
  pageId: true,
  type: true,
  layout: true,
  title: true,
  body: true,
  cta1Label: true,
  cta1Url: true,
  cta2Label: true,
  cta2Url: true,
  position: true,
  config: true,
  image: { select: publicMediaSelect },
} as const;

export interface BlockRow {
  id: string;
  pageId: string | null;
  type: BlockType;
  layout: BlockLayout;
  title: string | null;
  body: string | null;
  cta1Label: string | null;
  cta1Url: string | null;
  cta2Label: string | null;
  cta2Url: string | null;
  position: number;
  config: unknown;
  image: PublicMediaRow | null;
}

/** CTA hanya dikirim bila label **dan** URL-nya ada; setengah CTA tidak berguna di UI. */
function toCta(label: string | null, url: string | null): PublicBlockCta | null {
  return label === null || label === '' || url === null || url === '' ? null : { label, url };
}

/** `config` hanya diteruskan bila objek biasa; array/skalar → `null`. */
function toConfig(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function toPublicBlock(row: BlockRow, mediaPublicUrl: string | undefined): PublicBlock {
  return {
    id: row.id,
    type: row.type,
    layout: row.layout,
    isGlobal: row.pageId === null,
    title: row.title,
    body: row.body,
    cta1: toCta(row.cta1Label, row.cta1Url),
    cta2: toCta(row.cta2Label, row.cta2Url),
    image: toPublicMedia(row.image, mediaPublicUrl),
    config: toConfig(row.config),
  };
}

/**
 * Urutan §5.5: blok halaman (urut `position`) lebih dulu, lalu blok global
 * (urut `position`). `orderBy` Prisma tidak bisa mengungkapkan "null terakhir
 * lalu position", jadi diurutkan di sini — daftarnya selalu kecil (blok per
 * halaman dihitung belasan, §1.6: tidak dipaginasi).
 */
export function sortBlocks(rows: readonly BlockRow[]): BlockRow[] {
  return [...rows].sort((a, b) => {
    const aGlobal = a.pageId === null ? 1 : 0;
    const bGlobal = b.pageId === null ? 1 : 0;
    if (aGlobal !== bGlobal) return aGlobal - bGlobal;
    if (a.position !== b.position) return a.position - b.position;
    return a.id < b.id ? -1 : 1;
  });
}
