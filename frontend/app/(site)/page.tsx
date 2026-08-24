import Link from "next/link";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { Tag } from "@/components/ui/Tag";
import { HeroCarousel } from "@/components/site/HeroCarousel";
import { ProductCard } from "@/components/site/ProductCard";
import { ArtisanCard } from "@/components/site/ArtisanCard";
import { ArticleCard } from "@/components/site/ArticleCard";
import { ProcessSteps } from "@/components/site/ProcessSteps";
import { TermsAccordion } from "@/components/site/TermsAccordion";
import { Kicker, Section, SectionHead, Shell } from "@/components/site/Section";
import { ARTICLES, ARTISANS, PRODUCTS } from "@/lib/data";

export default function HomePage() {
  const featured = PRODUCTS.slice(0, 6);
  const artisans = ARTISANS.slice(0, 3);
  const posts = ARTICLES.slice(0, 3);

  return (
    <>
      {/* ── Hero ── */}
      <Shell className="grid items-end gap-9 pb-10 pt-14 xl:grid-cols-[1.05fr_.95fr] xl:gap-14">
        <div>
          <div className="mb-6.6 flex items-center gap-2.5 text-kicker uppercase text-accent-700">
            <span className="h-px w-[26px] bg-accent" />
            Bangunjiwo, Bantul · Yogyakarta
          </div>
          <h1 className="mb-5 text-[clamp(64px,7.4vw,116px)] leading-[.88] tracking-[-.03em]">
            Good
            <br />
            Value.
          </h1>
          <p className="max-w-[34ch] text-body-lg leading-[1.6] text-muted-78">
            Menjembatani pengrajin lokal Indonesia dengan pembeli global — menjaga nilai
            kerajinan, presisi teknis, dan manajemen produksi yang profesional.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/kontak" className="btn btn-primary px-6 py-3 text-[15px]">
              Consult Your Project
            </Link>
            <Link href="/catalog" className="btn btn-secondary px-6 py-3 text-[15px]">
              Lihat Katalog
            </Link>
          </div>
        </div>
        <HeroCarousel />
      </Shell>

      {/* ── Our Story ── */}
      <Section id="about" className="xl:py-20">
        <div className="grid gap-9 xl:grid-cols-[.8fr_1.2fr] xl:gap-14">
          <div>
            <Kicker className="mb-4.4">Our Story</Kicker>
            <h2 className="max-w-[14ch] text-[32px] leading-[1.05] xl:text-[40px]">
              Menjaga nilai industri kerajinan.
            </h2>
            <div className="mt-8 h-[120px] w-[120px] overflow-hidden rounded-pill">
              <ImageSlot label="Potret pengrajin" shape="circle" compact />
            </div>
          </div>
          <div className="grid gap-9 text-body-sm text-muted-80 md:grid-cols-2">
            <div className="space-y-3.3">
              <p>
                Ornament lahir di Bangunjiwo, Bantul — sebuah desa di mana rotan, kayu jati,
                dan bambu sudah menjadi bahasa sehari-hari. Selama bertahun-tahun kami bekerja
                berdampingan dengan workshop keluarga, memahami cara mereka mengukur,
                menganyam, dan menyelesaikan setiap permukaan.
              </p>
              <p>
                Peran kami sederhana: menerjemahkan spesifikasi pembeli global menjadi
                instruksi kerja yang presisi, lalu menjaga standarnya sampai kontainer terakhir
                dimuat.
              </p>
            </div>
            <div className="space-y-3.3">
              <p>
                Material dipilih dari sumber yang dapat dilacak — kayu reclaimed, rotan dan
                bambu hasil panen berkelanjutan, serta serat alami yang dipanen musiman.
              </p>
              <p>
                Kolaborasi tiga arah antara pengrajin, agen, dan pembeli membuat harga tetap
                adil, jadwal tetap realistis, dan kualitas tetap terjaga.
              </p>
              <div className="flex flex-wrap gap-2 pt-2.5">
                <Tag tone="accent-2">Material terlacak</Tag>
                <Tag tone="accent">Harga adil</Tag>
                <Tag tone="neutral">Ekspor terkelola</Tag>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Artisan Product Preview ── */}
      <Section id="catalog" tone="alt">
        <SectionHead
          kicker="Artisan Product Preview"
          title="Dibuat tangan, diukur mesin."
          aside={
            <p className="m-0 max-w-[34ch] text-[14px] leading-[1.65] text-muted-65">
              Setiap produk dapat dikustomisasi pada dimensi, finishing, dan kemasan. MOQ dan
              lead time tersedia pada katalog lengkap.
            </p>
          }
        />
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {featured.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
        <div className="mt-11 flex justify-center">
          <Link href="/catalog" className="btn btn-primary px-[30px] py-3.5 text-[15px]">
            View Full Catalog
          </Link>
        </div>
      </Section>

      {/* ── Process ── */}
      <Section id="process">
        <Kicker className="mb-4.4">Process with Ornament</Kicker>
        <h2 className="mb-12 text-[32px] leading-[1.05] xl:text-[40px]">
          Tiga langkah, satu penanggung jawab.
        </h2>
        <ProcessSteps />
      </Section>

      {/* ── Artisan Network ── */}
      <Section id="artisans" className="pt-0">
        <SectionHead
          kicker="Artisan Network"
          title="42 workshop, 9 desa."
          aside={
            <p className="m-0 max-w-[32ch] text-[14px] leading-[1.65] text-muted-65">
              Setiap produk dapat dilacak sampai ke workshop yang mengerjakannya.
            </p>
          }
        />
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {artisans.map((a) => (
            <ArtisanCard key={a.slug} artisan={a} />
          ))}
        </div>
      </Section>

      {/* ── Craft Journal ── */}
      <Section id="journal" tone="alt">
        <SectionHead
          kicker="Craft Journal"
          title="Catatan dari workshop."
          aside={
            <Link href="/journal" className="btn btn-secondary self-start px-6 py-3 text-[14px]">
              Semua artikel
            </Link>
          }
        />
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {posts.map((a) => (
            <ArticleCard key={a.slug} article={a} />
          ))}
        </div>
      </Section>

      {/* ── Terms summary ── */}
      <Section id="terms">
        <div className="grid gap-9 xl:grid-cols-[.75fr_1.25fr] xl:items-start xl:gap-14">
          <div>
            <Kicker className="mb-4.4">Terms &amp; Conditions</Kicker>
            <h2 className="mb-4 text-[30px] leading-[1.06] xl:text-[36px]">
              Transparan sejak halaman pertama.
            </h2>
            <p className="text-[14px] leading-[1.7] text-muted-65">
              Ringkasan ketentuan kerja sama. Versi lengkap dikirim bersama penawaran.
            </p>
          </div>
          <TermsAccordion />
        </div>
      </Section>
    </>
  );
}
