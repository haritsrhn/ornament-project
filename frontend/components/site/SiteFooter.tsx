import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { COMPANY } from "@/lib/data";

export function SiteFooter() {
  return (
    <footer className="bg-sage-900 px-5 pb-7 pt-[72px] text-neutral-200 lg:px-0">
      <div className="mx-auto max-w-shell lg:px-10">
        <div className="grid gap-12 md:grid-cols-2 xl:grid-cols-[1.4fr_.8fr_.8fr]">
          <div>
            <div className="mb-5 flex items-center gap-3.5">
              <Logo light height={32} />
              <span className="max-w-[9ch] text-[10px] uppercase leading-[1.3] tracking-[.18em] opacity-60">
                Sourcing Agent
              </span>
            </div>
            <p className="max-w-[32ch] text-[14px] leading-[1.7] opacity-75">
              Punya proyek? Kirimkan brief atau gambar teknis Anda — kami balas dengan
              penawaran dan estimasi lead time.
            </p>
            <Link href="/kontak" className="btn btn-primary mt-4 px-6 py-3 text-[15px]">
              Consult Your Project
            </Link>
          </div>

          <div className="text-[14px] leading-[2.1]">
            <h6 className="mb-3 opacity-55">Kontak</h6>
            <div>
              <a href={`mailto:${COMPANY.email}`} className="text-accent-300 hover:text-accent-200">
                {COMPANY.email}
              </a>
            </div>
            <div>
              <a
                href={COMPANY.instagramUrl}
                className="text-accent-300 hover:text-accent-200"
                target="_blank"
                rel="noreferrer"
              >
                Instagram — {COMPANY.instagram}
              </a>
            </div>
          </div>

          <div className="text-[14px] leading-[1.8]">
            <h6 className="mb-3 opacity-55">Workshop</h6>
            <address className="not-italic opacity-80">
              {COMPANY.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[color-mix(in_srgb,#f5ead8_18%,transparent)] pt-5 text-[12px] opacity-60">
          <span>© 2026 {COMPANY.name}</span>
          <span className="flex flex-wrap gap-[18px]">
            <Link href="/catalog" className="text-inherit hover:text-inherit">Catalog</Link>
            <Link href="/journal" className="text-inherit hover:text-inherit">Journal</Link>
            <Link href="/kontak" className="text-inherit hover:text-inherit">Kontak</Link>
            <Link href="/terms" className="text-inherit hover:text-inherit">Terms &amp; Conditions</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
