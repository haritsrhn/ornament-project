import { Plus } from "lucide-react";
import { Tag } from "@/components/ui/Tag";
import { PAYMENT_STAGES } from "@/lib/data";

function Item({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="overflow-hidden rounded-lg bg-surface">
      <summary className="os-summary flex items-center justify-between gap-4 px-5 py-5 font-heading text-[17px] xl:px-[26px] xl:text-[19px]">
        {title}
        <span className="os-chev inline-flex">
          <Plus size={18} strokeWidth={2.75} aria-hidden />
        </span>
      </summary>
      <div className="px-5 pb-6 xl:px-[26px]">{children}</div>
    </details>
  );
}

/** The three-item summary accordion on the home page's Terms section. */
export function TermsAccordion() {
  return (
    <div className="flex flex-col gap-3">
      <Item title="Pembayaran 3 tahap" defaultOpen>
        <div className="grid gap-3.5 md:grid-cols-3">
          {PAYMENT_STAGES.map((s) => (
            <div key={s.pct} className="rounded-[22px] bg-bg p-[18px]">
              <div className="font-heading text-[32px] text-accent">{s.pct}</div>
              <div className="mt-1.5 text-[13px] text-muted-70">{s.short}</div>
            </div>
          ))}
        </div>
      </Item>

      <Item title="Quality Control 4 titik">
        <div className="flex flex-wrap gap-2.5">
          {["01 Material", "02 Frame", "03 Finishing", "04 Packaging"].map((t) => (
            <Tag key={t} tone="accent-2" className="px-4 py-[7px] text-admin-sm">
              {t}
            </Tag>
          ))}
          <p className="mt-3 w-full text-admin leading-[1.7] text-muted-70">
            Setiap titik diperiksa dan didokumentasikan. Temuan di luar toleransi dikembalikan
            ke workshop sebelum tahap berikutnya dimulai.
          </p>
        </div>
      </Item>

      <Item title="Garansi produk 7 hari">
        <p className="text-admin leading-[1.7] text-muted-70">
          Klaim atas cacat produksi dapat diajukan dalam 7 hari setelah barang diterima, dengan
          foto dan nomor batch. Penggantian atau perbaikan mengikuti kesepakatan penawaran.
        </p>
      </Item>
    </div>
  );
}
