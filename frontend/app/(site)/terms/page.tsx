import Link from "next/link";
import type { Metadata } from "next";
import { Kicker, Shell } from "@/components/site/Section";
import { PAYMENT_STAGES, TERMS_SECTIONS } from "@/lib/data";

export const metadata: Metadata = { title: "Terms & Conditions" };

const TOC = [
  { href: "#t-pay", label: "01 · Skema pembayaran" },
  { href: "#t-qc", label: "02 · Quality control" },
  { href: "#t-warranty", label: "03 · Garansi 7 hari" },
  { href: "#t-lead", label: "04 · Lead time & MOQ" },
  { href: "#t-ship", label: "05 · Pengiriman & dokumen" },
  { href: "#t-ip", label: "06 · Desain & kerahasiaan" },
];

export default function TermsPage() {
  return (
    <>
      <Shell className="pb-8 pt-12">
        <Kicker>Terms &amp; Conditions</Kicker>
        <h1 className="mb-4.4 text-[clamp(40px,4.8vw,66px)] leading-[.96]">
          Ketentuan kerja sama
        </h1>
        <p className="max-w-[52ch] text-[16px] leading-[1.7] text-muted-75">
          Berlaku untuk semua order sourcing melalui Ornament. Versi yang mengikat dikirim
          bersama penawaran resmi. Terakhir diperbarui 2 Agustus 2026.
        </p>
      </Shell>

      <Shell className="grid gap-10 pb-20 pt-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-12">
        <div className="flex flex-col gap-10">
          <section id="t-pay" className="scroll-mt-24">
            <div className="mb-4 flex items-baseline gap-3.5">
              <span className="font-heading text-[22px] text-accent-300">01</span>
              <h3 className="m-0">Skema pembayaran</h3>
            </div>
            <div className="grid gap-3.5 md:grid-cols-3">
              {PAYMENT_STAGES.map((s) => (
                <div key={s.pct} className="rounded-[26px] bg-surface p-[22px]">
                  <div className="font-heading text-[34px] text-accent">{s.pct}</div>
                  <div className="mt-2 text-admin leading-[1.65] text-muted-75">{s.long}</div>
                </div>
              ))}
            </div>
          </section>

          {TERMS_SECTIONS.map((t) => (
            <section key={t.id} id={t.id} className="scroll-mt-24">
              <div className="mb-3 flex items-baseline gap-3.5">
                <span className="font-heading text-[22px] text-accent-300">{t.no}</span>
                <h3 className="m-0">{t.title}</h3>
              </div>
              <p className="m-0 max-w-[62ch] text-body-sm leading-[1.8] text-muted-82">{t.body}</p>
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-2.5 xl:sticky xl:top-24">
          <div className="mb-1.5 text-meta uppercase tracking-[.12em] text-muted-50">
            Isi halaman
          </div>
          {TOC.map((t) => (
            <a key={t.href} href={t.href} className="text-admin text-ink hover:text-accent">
              {t.label}
            </a>
          ))}
          <div className="mt-4 rounded-[26px] bg-sage-900 p-5 text-neutral-200">
            <div className="font-heading text-[18px] leading-[1.25]">Ada yang perlu disesuaikan?</div>
            <p className="mt-2 text-admin-sm leading-[1.7] opacity-80">
              Ketentuan dapat dinegosiasikan untuk order berulang atau proyek kontrak.
            </p>
            <Link href="/kontak" className="btn btn-primary btn-block">
              Hubungi kami
            </Link>
          </div>
        </aside>
      </Shell>
    </>
  );
}
