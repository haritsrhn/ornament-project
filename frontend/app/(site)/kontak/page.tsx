import type { Metadata } from "next";
import { Instagram, Mail, MapPin } from "lucide-react";
import { InquiryForm } from "@/components/site/InquiryForm";
import { Kicker, Shell } from "@/components/site/Section";
import { COMPANY } from "@/lib/data";

export const metadata: Metadata = { title: "Consult Your Project" };

export default function ContactPage() {
  return (
    <Shell className="pb-20 pt-12">
      <div className="grid gap-8 xl:grid-cols-[.85fr_1.15fr] xl:items-start xl:gap-14">
        <div>
          <Kicker>Consult Your Project</Kicker>
          <h1 className="mb-5 text-[clamp(40px,4.6vw,62px)] leading-[.96]">Kirim brief Anda.</h1>
          <p className="max-w-[34ch] text-[16px] leading-[1.7] text-muted-78">
            Semakin lengkap informasi volume, target kirim, dan pelabuhan tujuan, semakin cepat
            kami balas dengan penawaran dan estimasi lead time.
          </p>

          <div className="mt-8 flex flex-col gap-3.5 text-[14px]">
            <div className="flex items-center gap-3">
              <Mail size={17} strokeWidth={2.75} className="text-accent" aria-hidden />
              <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
            </div>
            <div className="flex items-center gap-3">
              <Instagram size={17} strokeWidth={2.75} className="text-accent" aria-hidden />
              <a href={COMPANY.instagramUrl} target="_blank" rel="noreferrer">
                {COMPANY.instagram}
              </a>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={17} strokeWidth={2.75} className="mt-[3px] text-accent" aria-hidden />
              <address className="not-italic leading-[1.6]">
                {COMPANY.addressLines.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            </div>
          </div>

          <div className="mt-7 rounded-lg bg-surface p-5">
            <div className="mb-2.5 text-[12px] uppercase tracking-[.1em] text-muted-55">
              Waktu balasan
            </div>
            <div className="font-heading text-[26px]">1 × 24 jam kerja</div>
          </div>
        </div>

        <InquiryForm />
      </div>
    </Shell>
  );
}
