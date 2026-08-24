import type { Metadata } from "next";
import { CatalogBrowser } from "@/components/site/CatalogBrowser";
import { Kicker, Shell } from "@/components/site/Section";
import { PRODUCTS } from "@/lib/data";

export const metadata: Metadata = { title: "Katalog Produk" };

export default function CatalogPage() {
  return (
    <Shell className="pb-20 pt-12">
      <Kicker>Full Catalog</Kicker>
      <h1 className="mb-4.4 text-[clamp(44px,5vw,68px)] leading-[.95]">Katalog Produk</h1>
      <p className="max-w-[52ch] text-[16px] leading-[1.7] text-muted-75">
        Delapan produk unggulan dari 42 workshop mitra ditampilkan di bawah — katalog penuh 128
        item dikirim atas permintaan. Semua item dapat dikustomisasi pada dimensi, finishing, dan
        kemasan; MOQ mulai 50 pcs.
      </p>
      <CatalogBrowser products={PRODUCTS} />
    </Shell>
  );
}
