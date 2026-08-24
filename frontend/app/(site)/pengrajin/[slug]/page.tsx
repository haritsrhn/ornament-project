import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { ProductCard } from "@/components/site/ProductCard";
import { Section, Shell } from "@/components/site/Section";
import { ARTISANS, PRODUCTS } from "@/lib/data";

export function generateStaticParams() {
  return ARTISANS.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const artisan = ARTISANS.find((a) => a.slug === params.slug);
  return { title: artisan?.name ?? "Pengrajin" };
}

export default function ArtisanPage({ params }: { params: { slug: string } }) {
  const artisan = ARTISANS.find((a) => a.slug === params.slug);
  if (!artisan) notFound();

  const products = PRODUCTS.slice(0, 3);
  const stats = [
    { value: "8", label: "penganyam" },
    { value: "600", label: "pcs / bulan" },
    { value: "14", label: "produk aktif" },
  ];

  return (
    <>
      <Shell className="pb-10 pt-9">
        <Link href="/#artisans" className="btn btn-secondary mb-7">
          ← Artisan Network
        </Link>

        <div className="grid gap-8 xl:grid-cols-[.85fr_1.15fr] xl:items-start xl:gap-14">
          <div>
            <Avatar initial={artisan.initial} size={72} />
            <h1 className="mb-3.5 mt-5 text-[clamp(36px,4.2vw,58px)] leading-none">
              {artisan.name}
            </h1>
            <div className="mb-5 flex flex-wrap gap-2">
              <Tag tone="accent-2">{artisan.craft}</Tag>
              <Tag tone="neutral">{artisan.place}</Tag>
              <Tag tone="outline">Mitra sejak {artisan.since.replace("mitra sejak ", "")}</Tag>
            </div>
            <p className="max-w-[46ch] text-[16px] leading-[1.75] text-muted-80">
              Delapan penganyam, dipimpin Pak Slamet dan anaknya. Spesialis rangka lampu gantung
              dan kap besar dengan pola anyaman rapat yang jarang bisa dikerjakan mesin.
            </p>
            <p className="mt-3.3 max-w-[46ch] text-[16px] leading-[1.75] text-muted-80">
              Rotan didatangkan dari pengumpul di Kalimantan Tengah dengan catatan panen, lalu
              diseleksi ulang di workshop berdasarkan diameter dan kelenturan.
            </p>
            <div className="mt-7 grid gap-3.5 sm:grid-cols-3">
              {stats.map((s) => (
                <div key={s.label} className="rounded-[24px] bg-surface p-[18px]">
                  <div className="font-heading text-[26px]">{s.value}</div>
                  <div className="mt-1 text-[12px] text-muted-60">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="overflow-hidden rounded-xl" style={{ aspectRatio: "4 / 3" }}>
              <ImageSlot label="Foto workshop" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="overflow-hidden rounded-[22px]" style={{ aspectRatio: "4 / 3" }}>
                <ImageSlot label="Proses anyam" compact />
              </div>
              <div className="overflow-hidden rounded-[22px]" style={{ aspectRatio: "4 / 3" }}>
                <ImageSlot label="Detail material" compact />
              </div>
            </div>
          </div>
        </div>
      </Shell>

      <Section tone="alt">
        <div className="mb-6.6 flex flex-wrap items-end justify-between gap-6">
          <h3 className="m-0">Produk dari workshop ini</h3>
          <Link href="/catalog" className="btn btn-secondary">
            Lihat katalog
          </Link>
        </div>
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </Section>
    </>
  );
}
