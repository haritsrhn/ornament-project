import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { ProductGallery } from "@/components/site/ProductGallery";
import { ProductCard } from "@/components/site/ProductCard";
import { Shell } from "@/components/site/Section";
import { ARTISANS, PRODUCTS, PRODUCT_SPEC, QC_POINTS } from "@/lib/data";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const product = PRODUCTS.find((p) => p.slug === params.slug);
  return { title: product?.name ?? "Produk" };
}

export default function ProductPage({ params }: { params: { slug: string } }) {
  const product = PRODUCTS.find((p) => p.slug === params.slug);
  if (!product) notFound();

  const artisan = ARTISANS[0];
  const related = PRODUCTS.filter((p) => p.slug !== product.slug).slice(0, 3);

  return (
    <Shell className="pb-20 pt-9">
      <nav aria-label="Breadcrumb" className="mb-6.6 flex flex-wrap items-center gap-2.5 text-admin-sm text-muted-55">
        <Link href="/catalog" className="text-inherit hover:text-accent">Catalog</Link>
        <span>/</span>
        <span>{product.category}</span>
        <span>/</span>
        <span className="text-ink">{product.name}</span>
      </nav>

      <div className="grid gap-8 xl:grid-cols-[.85fr_1.15fr] xl:items-start xl:gap-14">
        <ProductGallery name={product.name} />

        <div>
          <div className="text-meta uppercase tracking-[.14em] text-accent-700">
            {product.sku} · {product.category}
          </div>
          <h1 className="mb-4.4 mt-3.5 text-[clamp(36px,4vw,54px)] leading-none">{product.name}</h1>
          <p className="max-w-[46ch] text-[16px] leading-[1.75] text-muted-80">
            Lampu gantung anyaman rotan dengan rangka besi lapis hitam matte. Dianyam oleh
            workshop keluarga di Bantul, finishing natural clear coat dengan opsi pewarna walnut
            atau ebony.
          </p>
          <div className="mt-4.4 flex flex-wrap gap-2">
            <Tag tone="accent-2">{product.material}</Tag>
            <Tag tone="accent-2">Handwoven</Tag>
            <Tag tone="neutral">{product.origin}</Tag>
          </div>

          <div className="mt-7 rounded-lg bg-surface px-5 py-1.5">
            <table className="w-full border-collapse text-[14px]">
              <tbody>
                {PRODUCT_SPEC.map((row) => (
                  <tr key={row.k}>
                    <th
                      scope="row"
                      className="border-b border-[color-mix(in_srgb,#201e1d_8%,transparent)] py-3.5 text-left font-normal text-muted-60"
                    >
                      {row.k}
                    </th>
                    <td className="border-b border-[color-mix(in_srgb,#201e1d_8%,transparent)] py-3.5 text-right font-semibold">
                      {row.v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-wrap gap-2.5">
            <Link href="/kontak" className="btn btn-primary px-6 py-3 text-[15px]">
              Minta penawaran
            </Link>
            <button type="button" className="btn btn-secondary px-6 py-3 text-[15px]">
              Unduh spec sheet
            </button>
          </div>

          <Link
            href={`/pengrajin/${artisan.slug}`}
            className="mt-6.6 flex items-center gap-3.5 rounded-lg bg-sage-900 px-5 py-5 text-neutral-200 hover:text-neutral-200"
          >
            <Avatar initial={artisan.initial} size={44} tone="solid" />
            <span className="flex-1">
              <span className="block text-[14.5px]">Dikerjakan oleh {artisan.name}</span>
              <span className="block text-[12px] opacity-70">
                {artisan.place} · {artisan.since}
              </span>
            </span>
            <ChevronRight size={18} strokeWidth={2.75} aria-hidden />
          </Link>
        </div>
      </div>

      <section className="mt-16">
        <h3 className="mb-2">Kontrol kualitas produk ini</h3>
        <p className="mb-6 text-[14px] text-muted-65">
          Empat titik pemeriksaan, didokumentasikan per batch.
        </p>
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-4">
          {QC_POINTS.map((q) => (
            <div key={q.no} className="card p-5">
              <div className="card-kicker">{q.no}</div>
              <div className="card-title">{q.title}</div>
              <p className="card-body">{q.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <h3 className="m-0">Produk terkait</h3>
          <Link href="/catalog" className="btn btn-secondary">
            Semua produk
          </Link>
        </div>
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {related.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </section>
    </Shell>
  );
}
