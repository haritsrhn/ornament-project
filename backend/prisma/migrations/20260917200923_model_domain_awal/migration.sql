-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMINISTRATOR', 'EDITOR', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "media_visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('IMAGE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "publish_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "stock_status" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'MADE_TO_ORDER');

-- CreateEnum
CREATE TYPE "qc_stage" AS ENUM ('MATERIAL', 'FRAME', 'FINISHING', 'PACKAGING');

-- CreateEnum
CREATE TYPE "qc_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "artisan_status" AS ENUM ('VERIFICATION', 'ACTIVE', 'FULL_CAPACITY');

-- CreateEnum
CREATE TYPE "artisan_document_kind" AS ENUM ('CONTRACT', 'IDENTITY', 'BANK_ACCOUNT', 'MATERIAL_ORIGIN', 'OTHER');

-- CreateEnum
CREATE TYPE "article_status" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "comment_status" AS ENUM ('PENDING', 'APPROVED', 'SPAM', 'DELETED');

-- CreateEnum
CREATE TYPE "inquiry_status" AS ENUM ('NEW', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "reply_status" AS ENUM ('DRAFT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "block_type" AS ENUM ('HERO', 'STORY', 'PRODUCT_PREVIEW', 'PROCESS', 'TERMS', 'FOOTER', 'TESTIMONIAL', 'RICH_TEXT');

-- CreateEnum
CREATE TYPE "block_visibility" AS ENUM ('ACTIVE', 'GLOBAL', 'HIDDEN');

-- CreateEnum
CREATE TYPE "block_layout" AS ENUM ('LEFT', 'CENTER', 'BLEED');

-- CreateEnum
CREATE TYPE "nav_item_type" AS ENUM ('PAGE', 'CATEGORY', 'ARTICLE_ARCHIVE', 'CUSTOM_LINK');

-- CreateEnum
CREATE TYPE "nav_item_style" AS ENUM ('LINK', 'BUTTON');

-- CreateEnum
CREATE TYPE "site_language" AS ENUM ('ID', 'EN', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "activity_kind" AS ENUM ('PRODUCT', 'QC', 'INQUIRY', 'ARTICLE', 'ARTISAN', 'COMMENT', 'PAGE', 'MEDIA', 'USER', 'SETTING');

-- CreateEnum
CREATE TYPE "slug_redirect_type" AS ENUM ('PRODUCT', 'ARTICLE');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "avatar_id" UUID,
    "last_active_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ NOT NULL,
    "last_seen_at" TIMESTAMPTZ NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "invited_by_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "email_message_id" TEXT,
    "email_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "visibility" "media_visibility" NOT NULL DEFAULT 'PUBLIC',
    "kind" "media_kind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parent_id" UUID,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku_code" VARCHAR(3),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_category" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "article_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artisan" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "partner_since_year" INTEGER,
    "village" TEXT,
    "regency" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "address" TEXT,
    "craftsmen_count" INTEGER,
    "monthly_capacity" INTEGER,
    "capacity_unit" TEXT NOT NULL DEFAULT 'pcs',
    "avg_lead_time_days" INTEGER,
    "skills" TEXT[],
    "summary" TEXT,
    "story" JSONB,
    "internal_notes" TEXT,
    "status" "artisan_status" NOT NULL DEFAULT 'VERIFICATION',
    "photo_id" UUID,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "artisan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artisan_image" (
    "artisan_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "caption" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artisan_image_pkey" PRIMARY KEY ("artisan_id","media_id")
);

-- CreateTable
CREATE TABLE "artisan_document" (
    "id" UUID NOT NULL,
    "artisan_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "kind" "artisan_document_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "artisan_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT,
    "description" JSONB,
    "excerpt" TEXT,
    "category_id" UUID NOT NULL,
    "artisan_id" UUID,
    "moq_quantity" INTEGER NOT NULL,
    "moq_unit" TEXT NOT NULL,
    "lead_time_days" INTEGER,
    "length_cm" DECIMAL(7,1),
    "width_cm" DECIMAL(7,1),
    "height_cm" DECIMAL(7,1),
    "weight_kg" DECIMAL(7,2),
    "fob_price_usd" DECIMAL(10,2),
    "fob_port" TEXT DEFAULT 'Semarang',
    "stock_status" "stock_status" NOT NULL,
    "stock_status_override" "stock_status",
    "stock_quantity" INTEGER,
    "low_stock_threshold" INTEGER,
    "stock_note" TEXT,
    "publish_status" "publish_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ,
    "primary_image_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "duplicated_from_id" UUID,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_material" (
    "product_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_material_pkey" PRIMARY KEY ("product_id","material_id")
);

-- CreateTable
CREATE TABLE "product_tag" (
    "product_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_tag_pkey" PRIMARY KEY ("product_id","tag_id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "product_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("product_id","media_id")
);

-- CreateTable
CREATE TABLE "product_spec" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_spec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_qc_check" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "stage" "qc_stage" NOT NULL,
    "status" "qc_status" NOT NULL DEFAULT 'PENDING',
    "criteria" TEXT,
    "notes" TEXT,
    "checked_by_id" UUID,
    "checked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_qc_check_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_revision" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "edited_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" JSONB NOT NULL,
    "category_id" UUID,
    "author_id" UUID NOT NULL,
    "featured_image_id" UUID,
    "status" "article_status" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "word_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tag" (
    "article_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_tag_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "parent_id" UUID,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT,
    "author_user_id" UUID,
    "body" TEXT NOT NULL,
    "status" "comment_status" NOT NULL DEFAULT 'PENDING',
    "moderated_by_id" UUID,
    "moderated_at" TIMESTAMPTZ,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "notify_on_reply" BOOLEAN NOT NULL DEFAULT false,
    "anonymized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "country" TEXT,
    "category_id" UUID,
    "category_label" TEXT,
    "material_id" UUID,
    "material_label" TEXT,
    "volume_quantity" INTEGER NOT NULL,
    "target_ship_text" TEXT,
    "target_ship_date" DATE,
    "destination_port" TEXT,
    "budget_per_unit_usd" DECIMAL(10,2),
    "message" TEXT,
    "status" "inquiry_status" NOT NULL DEFAULT 'NEW',
    "read_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "notification_message_id" TEXT,
    "notification_error" TEXT,
    "anonymized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_reply" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "to_email" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "status" "reply_status" NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "email_message_id" TEXT,
    "email_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inquiry_reply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_attachment" (
    "id" UUID NOT NULL,
    "inquiry_id" UUID NOT NULL,
    "reply_id" UUID,
    "media_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "system_key" TEXT,
    "status" "publish_status" NOT NULL,
    "meta_title" TEXT,
    "meta_description" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_block" (
    "id" UUID NOT NULL,
    "page_id" UUID,
    "type" "block_type" NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "block_visibility" NOT NULL,
    "position" INTEGER NOT NULL,
    "layout" "block_layout" NOT NULL DEFAULT 'LEFT',
    "title" TEXT,
    "body" TEXT,
    "cta1_label" TEXT,
    "cta1_url" TEXT,
    "cta2_label" TEXT,
    "cta2_url" TEXT,
    "image_id" UUID,
    "config" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "page_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nav_item" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "type" "nav_item_type" NOT NULL,
    "page_id" UUID,
    "category_id" UUID,
    "url" TEXT,
    "style" "nav_item_style" NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "nav_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_setting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "site_name" TEXT NOT NULL,
    "tagline" TEXT,
    "contact_email" TEXT NOT NULL,
    "instagram_handle" TEXT,
    "instagram_url" TEXT,
    "site_language" "site_language" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "address" TEXT,
    "logo_id" UUID,
    "icon_id" UUID,
    "seo_home_title" TEXT,
    "seo_keywords" TEXT,
    "seo_description" VARCHAR(160),
    "sitemap_enabled" BOOLEAN NOT NULL DEFAULT true,
    "allow_indexing" BOOLEAN NOT NULL DEFAULT true,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 10,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "site_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slug_redirect" (
    "id" UUID NOT NULL,
    "type" "slug_redirect_type" NOT NULL,
    "from_slug" TEXT NOT NULL,
    "product_id" UUID,
    "article_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slug_redirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "kind" "activity_kind" NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actor_id" UUID,
    "entity_type" TEXT,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_role_idx" ON "user"("role");

-- CreateIndex
CREATE INDEX "user_status_idx" ON "user"("status");

-- CreateIndex
CREATE INDEX "user_avatar_id_idx" ON "user"("avatar_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "session_expires_at_idx" ON "session"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "invite_token_hash_key" ON "invite"("token_hash");

-- CreateIndex
CREATE INDEX "invite_email_idx" ON "invite"("email");

-- CreateIndex
CREATE INDEX "invite_invited_by_id_idx" ON "invite"("invited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_key_key" ON "media"("key");

-- CreateIndex
CREATE INDEX "media_visibility_idx" ON "media"("visibility");

-- CreateIndex
CREATE INDEX "media_kind_idx" ON "media"("kind");

-- CreateIndex
CREATE INDEX "media_uploaded_by_id_idx" ON "media"("uploaded_by_id");

-- CreateIndex
CREATE INDEX "media_created_at_idx" ON "media"("created_at");

-- CreateIndex
CREATE INDEX "media_deleted_at_idx" ON "media"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE INDEX "category_parent_id_idx" ON "category"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_name_key" ON "material"("name");

-- CreateIndex
CREATE UNIQUE INDEX "material_slug_key" ON "material"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "material_sku_code_key" ON "material"("sku_code");

-- CreateIndex
CREATE UNIQUE INDEX "article_category_name_key" ON "article_category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "article_category_slug_key" ON "article_category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tag_slug_key" ON "tag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "artisan_slug_key" ON "artisan"("slug");

-- CreateIndex
CREATE INDEX "artisan_regency_idx" ON "artisan"("regency");

-- CreateIndex
CREATE INDEX "artisan_status_idx" ON "artisan"("status");

-- CreateIndex
CREATE INDEX "artisan_archived_at_idx" ON "artisan"("archived_at");

-- CreateIndex
CREATE INDEX "artisan_photo_id_idx" ON "artisan"("photo_id");

-- CreateIndex
CREATE INDEX "artisan_image_media_id_idx" ON "artisan_image"("media_id");

-- CreateIndex
CREATE INDEX "artisan_document_artisan_id_idx" ON "artisan_document"("artisan_id");

-- CreateIndex
CREATE INDEX "artisan_document_artisan_id_kind_idx" ON "artisan_document"("artisan_id", "kind");

-- CreateIndex
CREATE INDEX "artisan_document_media_id_idx" ON "artisan_document"("media_id");

-- CreateIndex
CREATE INDEX "artisan_document_uploaded_by_id_idx" ON "artisan_document"("uploaded_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_slug_key" ON "product"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE INDEX "product_artisan_id_idx" ON "product"("artisan_id");

-- CreateIndex
CREATE INDEX "product_stock_status_idx" ON "product"("stock_status");

-- CreateIndex
CREATE INDEX "product_publish_status_idx" ON "product"("publish_status");

-- CreateIndex
CREATE INDEX "product_published_at_idx" ON "product"("published_at");

-- CreateIndex
CREATE INDEX "product_deleted_at_idx" ON "product"("deleted_at");

-- CreateIndex
CREATE INDEX "product_publish_status_deleted_at_category_id_idx" ON "product"("publish_status", "deleted_at", "category_id");

-- CreateIndex
CREATE INDEX "product_primary_image_id_idx" ON "product"("primary_image_id");

-- CreateIndex
CREATE INDEX "product_duplicated_from_id_idx" ON "product"("duplicated_from_id");

-- CreateIndex
CREATE INDEX "product_created_by_id_idx" ON "product"("created_by_id");

-- CreateIndex
CREATE INDEX "product_updated_by_id_idx" ON "product"("updated_by_id");

-- CreateIndex
CREATE INDEX "product_name_idx" ON "product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_sku_idx" ON "product" USING GIN ("sku" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "product_material_material_id_idx" ON "product_material"("material_id");

-- CreateIndex
CREATE INDEX "product_tag_tag_id_idx" ON "product_tag"("tag_id");

-- CreateIndex
CREATE INDEX "product_image_media_id_idx" ON "product_image"("media_id");

-- CreateIndex
CREATE INDEX "product_spec_product_id_idx" ON "product_spec"("product_id");

-- CreateIndex
CREATE INDEX "product_qc_check_checked_by_id_idx" ON "product_qc_check"("checked_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_qc_check_product_id_stage_key" ON "product_qc_check"("product_id", "stage");

-- CreateIndex
CREATE INDEX "product_revision_edited_by_id_idx" ON "product_revision"("edited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_revision_product_id_number_key" ON "product_revision"("product_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "article_slug_key" ON "article"("slug");

-- CreateIndex
CREATE INDEX "article_category_id_idx" ON "article"("category_id");

-- CreateIndex
CREATE INDEX "article_author_id_idx" ON "article"("author_id");

-- CreateIndex
CREATE INDEX "article_status_idx" ON "article"("status");

-- CreateIndex
CREATE INDEX "article_publish_at_idx" ON "article"("publish_at");

-- CreateIndex
CREATE INDEX "article_published_at_idx" ON "article"("published_at");

-- CreateIndex
CREATE INDEX "article_deleted_at_idx" ON "article"("deleted_at");

-- CreateIndex
CREATE INDEX "article_featured_image_id_idx" ON "article"("featured_image_id");

-- CreateIndex
CREATE INDEX "article_tag_tag_id_idx" ON "article_tag"("tag_id");

-- CreateIndex
CREATE INDEX "comment_article_id_status_created_at_idx" ON "comment"("article_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "comment_parent_id_idx" ON "comment"("parent_id");

-- CreateIndex
CREATE INDEX "comment_status_idx" ON "comment"("status");

-- CreateIndex
CREATE INDEX "comment_anonymized_at_idx" ON "comment"("anonymized_at");

-- CreateIndex
CREATE INDEX "comment_author_user_id_idx" ON "comment"("author_user_id");

-- CreateIndex
CREATE INDEX "comment_moderated_by_id_idx" ON "comment"("moderated_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_number_key" ON "inquiry"("number");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_reference_key" ON "inquiry"("reference");

-- CreateIndex
CREATE INDEX "inquiry_email_idx" ON "inquiry"("email");

-- CreateIndex
CREATE INDEX "inquiry_status_created_at_idx" ON "inquiry"("status", "created_at");

-- CreateIndex
CREATE INDEX "inquiry_target_ship_date_idx" ON "inquiry"("target_ship_date");

-- CreateIndex
CREATE INDEX "inquiry_anonymized_at_idx" ON "inquiry"("anonymized_at");

-- CreateIndex
CREATE INDEX "inquiry_category_id_idx" ON "inquiry"("category_id");

-- CreateIndex
CREATE INDEX "inquiry_material_id_idx" ON "inquiry"("material_id");

-- CreateIndex
CREATE INDEX "inquiry_reply_inquiry_id_idx" ON "inquiry_reply"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_reply_status_idx" ON "inquiry_reply"("status");

-- CreateIndex
CREATE INDEX "inquiry_reply_author_id_idx" ON "inquiry_reply"("author_id");

-- CreateIndex
CREATE INDEX "inquiry_attachment_inquiry_id_idx" ON "inquiry_attachment"("inquiry_id");

-- CreateIndex
CREATE INDEX "inquiry_attachment_reply_id_idx" ON "inquiry_attachment"("reply_id");

-- CreateIndex
CREATE INDEX "inquiry_attachment_media_id_idx" ON "inquiry_attachment"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_path_key" ON "page"("path");

-- CreateIndex
CREATE UNIQUE INDEX "page_system_key_key" ON "page"("system_key");

-- CreateIndex
CREATE INDEX "page_status_idx" ON "page"("status");

-- CreateIndex
CREATE INDEX "page_deleted_at_idx" ON "page"("deleted_at");

-- CreateIndex
CREATE INDEX "page_updated_by_id_idx" ON "page"("updated_by_id");

-- CreateIndex
CREATE INDEX "page_block_page_id_position_idx" ON "page_block"("page_id", "position");

-- CreateIndex
CREATE INDEX "page_block_image_id_idx" ON "page_block"("image_id");

-- CreateIndex
CREATE INDEX "nav_item_position_idx" ON "nav_item"("position");

-- CreateIndex
CREATE INDEX "nav_item_page_id_idx" ON "nav_item"("page_id");

-- CreateIndex
CREATE INDEX "nav_item_category_id_idx" ON "nav_item"("category_id");

-- CreateIndex
CREATE INDEX "site_setting_logo_id_idx" ON "site_setting"("logo_id");

-- CreateIndex
CREATE INDEX "site_setting_icon_id_idx" ON "site_setting"("icon_id");

-- CreateIndex
CREATE INDEX "site_setting_updated_by_id_idx" ON "site_setting"("updated_by_id");

-- CreateIndex
CREATE INDEX "slug_redirect_product_id_idx" ON "slug_redirect"("product_id");

-- CreateIndex
CREATE INDEX "slug_redirect_article_id_idx" ON "slug_redirect"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "slug_redirect_type_from_slug_key" ON "slug_redirect"("type", "from_slug");

-- CreateIndex
CREATE INDEX "activity_log_kind_idx" ON "activity_log"("kind");

-- CreateIndex
CREATE INDEX "activity_log_actor_id_idx" ON "activity_log"("actor_id");

-- CreateIndex
CREATE INDEX "activity_log_entity_type_entity_id_idx" ON "activity_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_log_created_at_idx" ON "activity_log"("created_at");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_avatar_id_fkey" FOREIGN KEY ("avatar_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan" ADD CONSTRAINT "artisan_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan_image" ADD CONSTRAINT "artisan_image_artisan_id_fkey" FOREIGN KEY ("artisan_id") REFERENCES "artisan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan_image" ADD CONSTRAINT "artisan_image_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan_document" ADD CONSTRAINT "artisan_document_artisan_id_fkey" FOREIGN KEY ("artisan_id") REFERENCES "artisan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan_document" ADD CONSTRAINT "artisan_document_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artisan_document" ADD CONSTRAINT "artisan_document_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_artisan_id_fkey" FOREIGN KEY ("artisan_id") REFERENCES "artisan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_primary_image_id_fkey" FOREIGN KEY ("primary_image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_duplicated_from_id_fkey" FOREIGN KEY ("duplicated_from_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_material" ADD CONSTRAINT "product_material_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_material" ADD CONSTRAINT "product_material_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_spec" ADD CONSTRAINT "product_spec_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_qc_check" ADD CONSTRAINT "product_qc_check_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_qc_check" ADD CONSTRAINT "product_qc_check_checked_by_id_fkey" FOREIGN KEY ("checked_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_revision" ADD CONSTRAINT "product_revision_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_revision" ADD CONSTRAINT "product_revision_edited_by_id_fkey" FOREIGN KEY ("edited_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "article_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article" ADD CONSTRAINT "article_featured_image_id_fkey" FOREIGN KEY ("featured_image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tag" ADD CONSTRAINT "article_tag_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tag" ADD CONSTRAINT "article_tag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_reply" ADD CONSTRAINT "inquiry_reply_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_reply" ADD CONSTRAINT "inquiry_reply_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_attachment" ADD CONSTRAINT "inquiry_attachment_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_attachment" ADD CONSTRAINT "inquiry_attachment_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "inquiry_reply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_attachment" ADD CONSTRAINT "inquiry_attachment_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_block" ADD CONSTRAINT "page_block_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_block" ADD CONSTRAINT "page_block_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nav_item" ADD CONSTRAINT "nav_item_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nav_item" ADD CONSTRAINT "nav_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_logo_id_fkey" FOREIGN KEY ("logo_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slug_redirect" ADD CONSTRAINT "slug_redirect_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slug_redirect" ADD CONSTRAINT "slug_redirect_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tambahan manual: aturan dari docs/domain-model.md yang tidak bisa
-- diekspresikan Prisma Schema (CHECK, unik parsial, sequence).
-- Ditulis di sini agar ikut `migrate deploy` dan terlacak `migrate status`.
-- Prisma tidak mendeteksi objek ini sebagai drift karena tidak ada padanannya
-- di schema.prisma.
-- ═══════════════════════════════════════════════════════════════════════════

-- §3.1 Invite: hanya satu undangan aktif per email.
CREATE UNIQUE INDEX "invite_email_active_key"
    ON "invite" ("email")
    WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- §3.5 ProductMaterial: maksimal satu material primer per produk.
CREATE UNIQUE INDEX "product_material_primary_key"
    ON "product_material" ("product_id")
    WHERE "is_primary";

-- §3.5 Product: ambang Low Stock per produk >= 0 (Q13); stok tidak negatif.
ALTER TABLE "product"
    ADD CONSTRAINT "product_low_stock_threshold_check"
    CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);

ALTER TABLE "product"
    ADD CONSTRAINT "product_stock_quantity_check"
    CHECK ("stock_quantity" IS NULL OR "stock_quantity" >= 0);

-- §3.6 Comment: identitas penulis harus ada, kecuali sudah dianonimkan.
ALTER TABLE "comment"
    ADD CONSTRAINT "comment_author_identity_check"
    CHECK (
        "author_user_id" IS NOT NULL
        OR "author_email" IS NOT NULL
        OR "anonymized_at" IS NOT NULL
    );

-- §3.7 Inquiry: email wajib, kecuali sudah dianonimkan.
ALTER TABLE "inquiry"
    ADD CONSTRAINT "inquiry_email_present_check"
    CHECK ("email" IS NOT NULL OR "anonymized_at" IS NOT NULL);

-- §3.8/D10 PageBlock: `page_id IS NULL` ⇔ `visibility = GLOBAL` (blok global).
ALTER TABLE "page_block"
    ADD CONSTRAINT "page_block_global_check"
    CHECK (("page_id" IS NULL) = ("visibility" = 'GLOBAL'));

-- §3.8 NavItem: target sesuai `type` (PAGE → page_id, CATEGORY → category_id,
-- CUSTOM_LINK → url; ARTICLE_ARCHIVE tanpa target, href diturunkan).
ALTER TABLE "nav_item"
    ADD CONSTRAINT "nav_item_target_check"
    CHECK (
        ("type" = 'PAGE' AND "page_id" IS NOT NULL AND "category_id" IS NULL AND "url" IS NULL)
        OR ("type" = 'CATEGORY' AND "category_id" IS NOT NULL AND "page_id" IS NULL AND "url" IS NULL)
        OR ("type" = 'ARTICLE_ARCHIVE' AND "page_id" IS NULL AND "category_id" IS NULL AND "url" IS NULL)
        OR ("type" = 'CUSTOM_LINK' AND "url" IS NOT NULL AND "page_id" IS NULL AND "category_id" IS NULL)
    );

-- §3.8/D11 SiteSetting: singleton, id selalu 1; ambang global >= 0.
ALTER TABLE "site_setting"
    ADD CONSTRAINT "site_setting_singleton_check"
    CHECK ("id" = 1);

ALTER TABLE "site_setting"
    ADD CONSTRAINT "site_setting_low_stock_threshold_check"
    CHECK ("low_stock_threshold" >= 0);

-- §3.8/§6.10 SlugRedirect: tepat satu target, sesuai `type`.
ALTER TABLE "slug_redirect"
    ADD CONSTRAINT "slug_redirect_target_check"
    CHECK (
        ("type" = 'PRODUCT' AND "product_id" IS NOT NULL AND "article_id" IS NULL)
        OR ("type" = 'ARTICLE' AND "article_id" IS NOT NULL AND "product_id" IS NULL)
    );

-- §6.2 Sequence global untuk saran SKU (`ORN-<kode>-<NNNN>`). Nomor tidak
-- pernah dipakai ulang, termasuk setelah produk dihapus permanen.
CREATE SEQUENCE "product_sku_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
