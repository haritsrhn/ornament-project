import Link from "next/link";
import type { Metadata } from "next";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { Kicker, Section, Shell } from "@/components/site/Section";
import { MILESTONES } from "@/lib/data";

export const metadata: Metadata = { title: "Our Story" };

const VALUES = [
  {
    kicker: "Nilai kerajinan",
    title: "Harga yang adil di hulu",
    body: "Biaya pengrajin dihitung dari jam kerja nyata, bukan sisa margin. Kenaikan harga material diteruskan, tidak ditahan.",
  },
  {
    kicker: "Presisi teknis",
    title: "Toleransi tertulis",
    body: 'Setiap order punya gambar kerja dan angka toleransi. Tidak ada "kurang lebih" yang dibiarkan sampai packing.',
  },
  {
    kicker: "Keberlanjutan",
    title: "Material yang terlacak",
    body: "Kayu reclaimed dengan dokumen asal, rotan dan bambu dari panen berkelanjutan, serat alami musiman.",
  },
];

export default function OurStoryPage() {
  return (
    <>
      <Shell className="pb-10 pt-12">
        <Kicker>Our Story</Kicker>
        <h1 className="mb-6 max-w-[20ch] text-[clamp(44px,5.4vw,76px)] leading-[.94]">
          Menjaga nilai industri kerajinan.
        </h1>
        <p className="max-w-[52ch] text-body-lg leading-[1.7] text-muted-80">
          Ornament lahir di Bangunjiwo, Bantul — desa di mana rotan, kayu jati, dan bambu sudah
          menjadi bahasa sehari-hari. Kami bekerja berdampingan dengan workshop keluarga,
          memahami cara mereka mengukur, menganyam, dan menyelesaikan setiap permukaan.
        </p>
      </Shell>

      <Shell className="pb-14 pt-5">
        <div className="overflow-hidden rounded-2xl" style={{ aspectRatio: "21 / 9" }}>
          <ImageSlot label="Foto workshop / desa" />
        </div>
      </Shell>

      <Shell className="grid gap-9 pb-20 xl:grid-cols-[.8fr_1.2fr] xl:gap-14">
        <div>
          <Kicker className="mb-4.4">Perjalanan</Kicker>
          <h2 className="max-w-[16ch] text-[30px] leading-[1.06] xl:text-[36px]">
            Dari satu workshop ke sembilan desa.
          </h2>
        </div>
        <ol className="flex flex-col">
          {MILESTONES.map((m) => (
            <li
              key={m.year}
              className="grid gap-2 border-t border-divider py-5 md:grid-cols-[110px_minmax(0,1fr)] md:gap-6"
            >
              <div className="font-heading text-[26px] text-accent">{m.year}</div>
              <div>
                <div className="mb-1.5 font-heading text-[19px]">{m.title}</div>
                <p className="m-0 text-[14.5px] leading-[1.7] text-muted-75">{m.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Shell>

      <Section tone="alt">
        <Kicker className="mb-4.4">Yang kami pegang</Kicker>
        <h2 className="mb-8 text-[30px] leading-[1.06] xl:text-[36px]">
          Tiga hal yang tidak kami tawar.
        </h2>
        <div className="grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.kicker} className="card bg-bg p-6.6">
              <div className="card-kicker">{v.kicker}</div>
              <div className="card-title text-[21px]">{v.title}</div>
              <p className="card-body text-[14px] leading-[1.7]">{v.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/kontak" className="btn btn-primary px-6 py-3 text-[15px]">
            Consult Your Project
          </Link>
          <Link href="/catalog" className="btn btn-secondary px-6 py-3 text-[15px]">
            Lihat katalog
          </Link>
        </div>
      </Section>
    </>
  );
}
