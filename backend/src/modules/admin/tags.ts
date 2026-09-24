/**
 * Tag dipakai ulang lintas produk dan artikel (model domain §3.3): nama yang
 * diketik editor diubah menjadi slug, lalu baris `Tag` yang sudah ada dipakai
 * kembali alih-alih diduplikasi.
 *
 * Ditulis sekali di sini karena `ProductTag` dan `ArticleTag` menunjuk tabel
 * `Tag` yang **sama** — dua implementasi berarti dua aturan normalisasi yang
 * bisa menyimpang, dan itu akan melahirkan "Bantul" dan "bantul" sebagai dua
 * tag berbeda di journal dan katalog.
 *
 * Karena tabelnya bersama, **membuat** tag adalah menulis taksonomi, bukan
 * menulis draf sendiri: matriks §3.1 menempatkan itu di `taxonomy.write`
 * (Editor+). Contributor tetap bebas memakai tag yang sudah ada — yang datang
 * dari autocomplete `GET /v1/admin/tags` — tetapi tidak bisa menambah baris
 * baru ke taksonomi yang dikurasi Editor.
 */

import { FORBIDDEN_REASONS } from '@ornament/shared';

import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import { slugify } from '../../lib/slug.js';

type Tx = Prisma.TransactionClient;

export interface ResolveTagOptions {
  /** `false` → nama yang belum ada ditolak `403`, bukan dibuat diam-diam. */
  canCreate: boolean;
}

export async function resolveTagIds(
  tx: Tx,
  names: readonly string[],
  options: ResolveTagOptions,
): Promise<string[]> {
  const bySlug = new Map<string, string>();
  for (const name of names) {
    const slug = slugify(name);
    if (slug === '') continue;
    if (!bySlug.has(slug)) bySlug.set(slug, name.trim());
  }
  if (bySlug.size === 0) return [];

  if (!options.canCreate) return resolveExistingOnly(tx, bySlug);

  const ids: string[] = [];
  for (const [slug, name] of bySlug) {
    // `upsert` alih-alih find-then-create: dua penyimpanan bersamaan dengan
    // tag baru yang sama tidak boleh salah satunya gagal di kolom unik.
    const tag = await tx.tag.upsert({
      where: { slug },
      create: { slug, name },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

/**
 * Nama yang tidak ditemukan dilaporkan **semuanya sekaligus**: editor yang
 * mengetik tiga tag baru sebaiknya tahu ketiganya dalam satu kali simpan,
 * bukan menemukannya satu per satu.
 */
async function resolveExistingOnly(tx: Tx, bySlug: Map<string, string>): Promise<string[]> {
  const rows = await tx.tag.findMany({
    where: { slug: { in: [...bySlug.keys()] } },
    select: { id: true, slug: true },
  });
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));

  const unknown: string[] = [];
  const ids: string[] = [];
  for (const [slug, name] of bySlug) {
    const id = idBySlug.get(slug);
    if (id === undefined) unknown.push(name);
    else ids.push(id);
  }

  if (unknown.length > 0) {
    throw new AppError(
      'FORBIDDEN',
      'Tag baru hanya dapat dibuat Editor. Pilih tag yang sudah ada, atau minta Editor membuatnya.',
      { details: { reason: FORBIDDEN_REASONS.TAG_NOT_FOUND, unknownTags: unknown } },
    );
  }
  return ids;
}
