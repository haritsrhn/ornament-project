import { z } from 'zod';

/**
 * Enum domain (model domain §4) yang dipakai kontrak publik. Kode stabil
 * UPPER_SNAKE; label tampilan dipetakan di frontend (kontrak §1.3).
 */

export const STOCK_STATUSES = ['IN_STOCK', 'LOW_STOCK', 'MADE_TO_ORDER'] as const;
export const stockStatusSchema = z.enum(STOCK_STATUSES);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const QC_STAGES = ['MATERIAL', 'FRAME', 'FINISHING', 'PACKAGING'] as const;
export const qcStageSchema = z.enum(QC_STAGES);
export type QcStage = z.infer<typeof qcStageSchema>;

export const QC_STATUSES = ['PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED'] as const;
export const qcStatusSchema = z.enum(QC_STATUSES);
export type QcStatus = z.infer<typeof qcStatusSchema>;

export const PUBLISH_STATUSES = ['DRAFT', 'PUBLISHED'] as const;
export const publishStatusSchema = z.enum(PUBLISH_STATUSES);
export type PublishStatus = z.infer<typeof publishStatusSchema>;

/**
 * Tabel taksonomi yang dipilih query `type` pada `/v1/admin/categories*`
 * (kontrak §5.7, model §3.3 Q4): `PRODUCT` → `Category`, `ARTICLE` →
 * `ArticleCategory`. Hanya pembeda di API, bukan kolom di database.
 */
export const CATEGORY_TYPES = ['PRODUCT', 'ARTICLE'] as const;
export const categoryTypeSchema = z.enum(CATEGORY_TYPES);
export type CategoryType = z.infer<typeof categoryTypeSchema>;

export const ARTISAN_STATUSES = ['VERIFICATION', 'ACTIVE', 'FULL_CAPACITY'] as const;
export const artisanStatusSchema = z.enum(ARTISAN_STATUSES);
export type ArtisanStatus = z.infer<typeof artisanStatusSchema>;

/**
 * Status pengrajin yang boleh muncul di `/v1/public/*` (kontrak §4, model §6.7):
 * `VERIFICATION` tidak pernah tampil, dan pengrajin yang diarsipkan disaring
 * lewat `archivedAt` (yang sendirinya tidak pernah ada di DTO publik).
 */
export const PUBLIC_ARTISAN_STATUSES = ['ACTIVE', 'FULL_CAPACITY'] as const;
export const publicArtisanStatusSchema = z.enum(PUBLIC_ARTISAN_STATUSES);
export type PublicArtisanStatus = z.infer<typeof publicArtisanStatusSchema>;

/**
 * Jenis dokumen pengrajin 🔒 (model §3.4, keputusan #49/#50). `IDENTITY` dan
 * `BANK_ACCOUNT` berisi data pribadi (UU PDP): keduanya disimpan sebagai
 * Media `PRIVATE`, bukan kolom teks, sehingga tidak perlu enkripsi per field.
 */
export const ARTISAN_DOCUMENT_KINDS = [
  'CONTRACT',
  'IDENTITY',
  'BANK_ACCOUNT',
  'MATERIAL_ORIGIN',
  'OTHER',
] as const;
export const artisanDocumentKindSchema = z.enum(ARTISAN_DOCUMENT_KINDS);
export type ArtisanDocumentKind = z.infer<typeof artisanDocumentKindSchema>;

export const ARTICLE_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED'] as const;
export const articleStatusSchema = z.enum(ARTICLE_STATUSES);
export type ArticleStatus = z.infer<typeof articleStatusSchema>;

/**
 * Status artikel yang dianggap **terbit** oleh query publik (ADR K8, model
 * §6.6): `PUBLISHED`, atau `SCHEDULED` yang `publishAt`-nya sudah lewat.
 * `DRAFT` tidak pernah tampil, dan `SCHEDULED` yang belum jatuh tempo → `404`.
 */
export const PUBLIC_ARTICLE_STATUSES = ['PUBLISHED', 'SCHEDULED'] as const;

export const SITE_LANGUAGES = ['ID', 'EN', 'BILINGUAL'] as const;
export const siteLanguageSchema = z.enum(SITE_LANGUAGES);
export type SiteLanguage = z.infer<typeof siteLanguageSchema>;

export const BLOCK_TYPES = [
  'HERO',
  'STORY',
  'PRODUCT_PREVIEW',
  'PROCESS',
  'TERMS',
  'FOOTER',
  'TESTIMONIAL',
  'RICH_TEXT',
] as const;
export const blockTypeSchema = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof blockTypeSchema>;

export const BLOCK_LAYOUTS = ['LEFT', 'CENTER', 'BLEED'] as const;
export const blockLayoutSchema = z.enum(BLOCK_LAYOUTS);
export type BlockLayout = z.infer<typeof blockLayoutSchema>;

export const NAV_ITEM_TYPES = ['PAGE', 'CATEGORY', 'ARTICLE_ARCHIVE', 'CUSTOM_LINK'] as const;
export const navItemTypeSchema = z.enum(NAV_ITEM_TYPES);
export type NavItemType = z.infer<typeof navItemTypeSchema>;

export const NAV_ITEM_STYLES = ['LINK', 'BUTTON'] as const;
export const navItemStyleSchema = z.enum(NAV_ITEM_STYLES);
export type NavItemStyle = z.infer<typeof navItemStyleSchema>;

export const SLUG_REDIRECT_TYPES = ['PRODUCT', 'ARTICLE'] as const;
export const slugRedirectTypeSchema = z.enum(SLUG_REDIRECT_TYPES);
export type SlugRedirectType = z.infer<typeof slugRedirectTypeSchema>;
