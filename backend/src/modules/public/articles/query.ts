/**
 * Visibilitas, urutan, dan keyset artikel publik (kontrak §1.6/§5.3, ADR K8).
 *
 * ── Mengapa ada SQL mentah di sini ───────────────────────────────────────────
 * Tanggal tayang artikel bukan satu kolom. Artikel `PUBLISHED` memakai
 * `published_at`; artikel `SCHEDULED` yang waktunya sudah lewat sudah tayang
 * tetapi `published_at`-nya masih kosong sampai job 60 detik (§6.6)
 * memindahkannya, jadi tanggalnya ada di `publish_at`. Kontrak §5.3 meminta
 * keduanya diurutkan dalam satu daftar `-publishedAt`, yaitu
 * `COALESCE(published_at, publish_at) DESC, id DESC`.
 *
 * `orderBy` Prisma tidak bisa mengurutkan ekspresi, dan mengurutkan di memori
 * akan mematahkan kursor keyset (§1.6). Karena itu **hanya urutan + keyset**
 * yang dikerjakan SQL mentah: query ini mengembalikan `id` saja, lalu barisnya
 * diambil ulang lewat `select` whitelist Prisma (`dto.ts`). Tidak ada kolom
 * artikel yang pernah lolos ke respons tanpa melewati whitelist itu.
 */

import type { Prisma as PrismaNamespace } from '../../../generated/prisma/client.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { invalidCursor, type CursorPosition } from '../../../lib/cursor.js';

/**
 * Satu-satunya definisi "artikel tayang publik" (ADR K8, model §6.6):
 *
 * - tidak di Trash,
 * - `PUBLISHED`, atau `SCHEDULED` yang `publishAt`-nya sudah lewat,
 * - punya tanggal tayang efektif, dan
 * - punya kategori — wajib saat publish (§6.6), dan `PublicArticleCard.category`
 *   tidak nullable. Baris tanpa kategori (hanya mungkin dari data yang rusak)
 *   disembunyikan, bukan dikirim setengah jadi.
 */
export function publishedArticleWhere(now: Date): PrismaNamespace.ArticleWhereInput {
  return {
    deletedAt: null,
    categoryId: { not: null },
    OR: [
      { status: 'PUBLISHED', publishedAt: { not: null } },
      { status: 'SCHEDULED', publishAt: { lte: now } },
    ],
  };
}

/** Tanggal tayang efektif sebuah baris (kolom yang sama dengan `COALESCE` di SQL). */
export function effectivePublishedAt(row: {
  publishedAt: Date | null;
  publishAt: Date | null;
}): Date | null {
  return row.publishedAt ?? row.publishAt;
}

/** Ekspresi urutan §5.3; ditulis sekali agar SQL dan indeks tidak pernah berbeda. */
const EFFECTIVE_AT = Prisma.sql`COALESCE(a."published_at", a."publish_at")`;

export interface ArticleKeysetFilter {
  /** `ArticleCategory.id`; `undefined` = tanpa filter kategori. */
  categoryId?: string | undefined;
  /** `Tag.id`; `undefined` = tanpa filter tag. */
  tagId?: string | undefined;
}

/**
 * `id` artikel terbit untuk satu halaman keyset, urut `-publishedAt`.
 * Dipanggil dengan `limit + 1` supaya "masih ada halaman berikutnya" diketahui
 * tanpa `COUNT` kedua (pola yang sama dengan katalog produk).
 */
export function articleKeysetIdsSql(input: {
  now: Date;
  filter: ArticleKeysetFilter;
  position: CursorPosition | null;
  take: number;
}): PrismaNamespace.Sql {
  const conditions: PrismaNamespace.Sql[] = [
    Prisma.sql`a."deleted_at" IS NULL`,
    Prisma.sql`a."category_id" IS NOT NULL`,
    Prisma.sql`(a."status" = 'PUBLISHED' OR (a."status" = 'SCHEDULED' AND a."publish_at" <= ${input.now}::timestamptz))`,
    Prisma.sql`${EFFECTIVE_AT} IS NOT NULL`,
  ];

  if (input.filter.categoryId !== undefined) {
    conditions.push(Prisma.sql`a."category_id" = ${input.filter.categoryId}::uuid`);
  }
  if (input.filter.tagId !== undefined) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "article_tag" t WHERE t."article_id" = a."id" AND t."tag_id" = ${input.filter.tagId}::uuid)`,
    );
  }
  if (input.position !== null) {
    const value = new Date(input.position.value);
    if (Number.isNaN(value.getTime())) throw invalidCursor();
    // Perbandingan baris: "urut setelah (tanggal, id) terakhir" pada urutan
    // menurun — bentuk yang bisa dilayani indeks `(effective DESC, id DESC)`.
    conditions.push(
      Prisma.sql`(${EFFECTIVE_AT}, a."id") < (${value}::timestamptz, ${input.position.id}::uuid)`,
    );
  }

  return Prisma.sql`
    SELECT a."id" AS id
    FROM "article" a
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY ${EFFECTIVE_AT} DESC, a."id" DESC
    LIMIT ${input.take}
  `;
}
