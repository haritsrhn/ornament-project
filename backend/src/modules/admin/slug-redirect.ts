/**
 * Redirect slug lama (model domain §6.10, Q8) — berlaku untuk `Product` **dan**
 * `Article`.
 *
 * Aturannya identik untuk kedua entitas, jadi ia ditulis sekali di sini dengan
 * `type` sebagai parameter: satu tempat yang memutuskan bahwa slug aktif selalu
 * menang, sehingga artikel tidak bisa mewarisi versi aturan yang berbeda dari
 * produk.
 */

import type { SlugRedirectType } from '@ornament/shared';

import type { Prisma } from '../../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/** Kolom pemilik redirect per tipe; tabelnya satu, FK-nya dua (model §3.8). */
function ownerColumn(type: SlugRedirectType, entityId: string): Prisma.SlugRedirectCreateInput {
  return type === 'PRODUCT'
    ? { type, fromSlug: '', product: { connect: { id: entityId } } }
    : { type, fromSlug: '', article: { connect: { id: entityId } } };
}

/**
 * Dipanggil **dalam transaksi yang sama** dengan perubahan slug:
 * 1. catat slug lama sebagai `SlugRedirect`;
 * 2. hapus redirect bertipe sama yang `fromSlug`-nya = slug **baru** — slug
 *    aktif selalu menang, jadi URL yang kini hidup tidak boleh mengalihkan.
 */
export async function recordSlugRedirect(
  tx: Tx,
  type: SlugRedirectType,
  entityId: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  if (oldSlug === newSlug) return;

  await tx.slugRedirect.deleteMany({ where: { type, fromSlug: newSlug } });
  const owner = ownerColumn(type, entityId);
  // Slug lama mungkin sudah tercatat (A → B → A → B). `upsert` menjaga
  // barisnya menunjuk entitas terkini alih-alih gagal di constraint unik.
  await tx.slugRedirect.upsert({
    where: { type_fromSlug: { type, fromSlug: oldSlug } },
    create: { ...owner, fromSlug: oldSlug },
    update:
      type === 'PRODUCT'
        ? { product: { connect: { id: entityId } } }
        : { article: { connect: { id: entityId } } },
    select: { id: true },
  });
}

/** Membuat/memulihkan slug yang tercatat sebagai `fromSlug` ikut menghapusnya (§6.10). */
export async function releaseSlugRedirect(
  tx: Tx,
  type: SlugRedirectType,
  slug: string,
): Promise<void> {
  await tx.slugRedirect.deleteMany({ where: { type, fromSlug: slug } });
}
