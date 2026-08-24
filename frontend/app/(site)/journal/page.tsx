import type { Metadata } from "next";
import { JournalBrowser } from "@/components/site/JournalBrowser";
import { Kicker, Shell } from "@/components/site/Section";
import { ARTICLES } from "@/lib/data";

export const metadata: Metadata = { title: "Journal" };

export default function JournalPage() {
  return (
    <Shell className="pb-20 pt-12">
      <Kicker>Craft Journal</Kicker>
      <h1 className="mb-4.4 text-[clamp(44px,5vw,68px)] leading-[.95]">Journal</h1>
      <p className="max-w-[50ch] text-[16px] leading-[1.7] text-muted-75">
        Catatan tentang material, proses produksi, dan orang-orang di baliknya.
      </p>
      <JournalBrowser articles={ARTICLES} />
    </Shell>
  );
}
