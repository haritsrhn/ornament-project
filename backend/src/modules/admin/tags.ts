/**
 * Tag dipakai ulang lintas produk dan artikel (model domain §3.3): nama yang
 * diketik editor diubah menjadi slug, lalu baris `Tag` yang sudah ada dipakai
 * kembali alih-alih diduplikasi.
 *
 * Ditulis sekali di sini karena `ProductTag` dan `ArticleTag` menunjuk tabel
 * `Tag` yang **sama** — dua implementasi berarti dua aturan normalisasi yang
 * bisa menyimpang, dan itu akan melahirkan "Bantul" dan "bantul" sebagai dua
 * tag berbeda di journal dan katalog.
 */

import type { Prisma } from '../../generated/prisma/client.js';
import { slugify } from '../../lib/slug.js';

type Tx = Prisma.TransactionClient;

export async function resolveTagIds(tx: Tx, names: readonly string[]): Promise<string[]> {
  const bySlug = new Map<string, string>();
  for (const name of names) {
    const slug = slugify(name);
    if (slug === '') continue;
    if (!bySlug.has(slug)) bySlug.set(slug, name.trim());
  }
  if (bySlug.size === 0) return [];

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
