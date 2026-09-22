/**
 * Publikasi terjadwal artikel — ADR K8 dan model domain §6.6.
 *
 * ── Kenapa job-nya ada, padahal query publik sudah aman ──────────────────────
 * `/v1/public/articles` sudah menganggap `SCHEDULED && publishAt <= now()`
 * sebagai terbit, jadi artikel **tetap** tayang tepat waktu tanpa job ini.
 * Yang dikerjakan job adalah merapikan *state*: memindahkan status ke
 * `PUBLISHED` dan mengisi `publishedAt`, sehingga daftar admin, hitungan tab,
 * dan urutan `-publishedAt` tidak perlu mengulang aturan "sudah jatuh tempo"
 * di setiap tempat.
 *
 * ── Aman untuk beberapa instance ─────────────────────────────────────────────
 * Seluruh pemindahan adalah **satu `UPDATE ... WHERE status = 'SCHEDULED'`**
 * yang mengembalikan baris yang benar-benar berubah. Dua instance yang
 * kebetulan berjalan bersamaan akan saling menunggu di row lock, lalu yang
 * kalah memperbarui **nol** baris — bukan menerbitkan dua kali dan bukan
 * menulis dua `ActivityLog`. Karena itu tidak ada tabel lock, tidak ada
 * leader election, dan tidak ada `SELECT` terpisah sebelum `UPDATE`.
 *
 * `publishedAt` diisi dari `publish_at` (bukan `now()`) supaya urutan journal
 * mencerminkan jadwal yang dijanjikan, dan `COALESCE` menjaga artikel yang
 * pernah terbit tidak kehilangan tanggal tayang aslinya.
 */

import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

/** Interval job in-process (ADR K8: 60 detik). */
export const SCHEDULED_PUBLISH_INTERVAL_MS = 60_000;

export interface PublishScheduledResult {
  published: number;
  slugs: string[];
}

/**
 * Memindahkan semua artikel `SCHEDULED` yang `publishAt`-nya sudah lewat ke
 * `PUBLISHED`. Idempoten: pemanggilan kedua tanpa jadwal baru mengembalikan
 * `{ published: 0, slugs: [] }` dan tidak menulis apa pun.
 */
export async function publishScheduledArticles(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<PublishScheduledResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; slug: string; title: string }[]>(Prisma.sql`
      UPDATE "article"
      SET "status" = 'PUBLISHED',
          "published_at" = COALESCE("published_at", "publish_at")
      WHERE "status" = 'SCHEDULED'
        AND "deleted_at" IS NULL
        AND "publish_at" IS NOT NULL
        AND "publish_at" <= ${now}::timestamptz
      RETURNING "id", "slug", "title"
    `);
    if (rows.length === 0) return { published: 0, slugs: [] };

    // `ActivityLog` hanya ditulis bila ada perubahan (kontrak §5.17), dengan
    // `actorId = null` = "Sistem".
    await tx.activityLog.createMany({
      data: rows.map((row) => ({
        kind: 'ARTICLE' as const,
        action: 'article.published_scheduled',
        message: `Artikel "${row.title}" terbit sesuai jadwal`,
        actorId: null,
        entityType: 'Article',
        entityId: row.id,
      })),
    });
    return { published: rows.length, slugs: rows.map((row) => row.slug) };
  });
}

export interface ScheduledPublishJob {
  /** Menjalankan satu putaran sekarang; dipakai tes dan pemicu manual. */
  runOnce: () => Promise<PublishScheduledResult>;
  stop: () => void;
}

/**
 * Menjalankan job setiap `intervalMs`. Timer di-`unref()` supaya ia tidak
 * pernah menahan proses tetap hidup: yang membuat server berumur panjang
 * adalah `listen()`, bukan job ini — dan tes yang lupa menutup app tidak boleh
 * menggantung karenanya.
 *
 * Kegagalan satu putaran dicatat dan **tidak** dilempar: job latar yang
 * menjatuhkan proses karena database sedang tidak tersedia akan mengubah
 * gangguan sementara menjadi downtime.
 */
export function startScheduledPublish(options: {
  prisma: PrismaClient;
  logger: FastifyBaseLogger;
  intervalMs?: number;
}): ScheduledPublishJob {
  const { prisma, logger } = options;
  const intervalMs = options.intervalMs ?? SCHEDULED_PUBLISH_INTERVAL_MS;
  let running = false;

  const runOnce = async (): Promise<PublishScheduledResult> => {
    const result = await publishScheduledArticles(prisma);
    if (result.published > 0) {
      logger.info(
        { published: result.published, slugs: result.slugs },
        'artikel terjadwal diterbitkan',
      );
    }
    return result;
  };

  const tick = (): void => {
    // Putaran sebelumnya masih jalan (database lambat): lewati alih-alih
    // menumpuk transaksi yang saling mengunci baris yang sama.
    if (running) return;
    running = true;
    void runOnce()
      .catch((err: unknown) => {
        logger.error({ err }, 'job publikasi terjadwal gagal');
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    runOnce,
    stop: () => {
      clearInterval(timer);
    },
  };
}

/**
 * Memasang job pada instance Fastify dan menghentikannya saat shutdown
 * (`app.close()`), sehingga tidak ada timer yang tertinggal setelah SIGTERM.
 */
export function registerScheduledPublish(
  app: FastifyInstance,
  options: { intervalMs?: number } = {},
): ScheduledPublishJob {
  const job = startScheduledPublish({
    prisma: app.prisma,
    logger: app.log,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });
  app.addHook('onClose', () => {
    job.stop();
    return Promise.resolve();
  });
  return job;
}
