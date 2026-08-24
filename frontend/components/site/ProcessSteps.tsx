import { FileText, Link2, Package } from "lucide-react";

const STEPS = [
  {
    no: "01",
    title: "Permintaan & Seleksi",
    body: "Brief, gambar teknis, atau sampel Anda kami terjemahkan menjadi spesifikasi kerja. Kami pilihkan workshop yang tepat, lalu kirim penawaran dan sampel.",
    Icon: FileText,
    ring: "bg-accent-100 text-accent-700",
    numeral: "text-accent-300",
  },
  {
    no: "02",
    title: "Sourcing & Produksi",
    body: "Material diadakan dan produksi dijalankan dengan pengawasan bertahap: material, frame, finishing, hingga packaging. Laporan foto berkala.",
    Icon: Link2,
    ring: "bg-sage-100 text-sage-800",
    numeral: "text-sage-300",
  },
  {
    no: "03",
    title: "Pengiriman Internasional",
    body: "Dokumen ekspor, stuffing kontainer, dan koordinasi forwarder kami tangani sampai barang tiba di pelabuhan tujuan Anda.",
    Icon: Package,
    ring: "bg-neutral-200 text-neutral-800",
    numeral: "text-neutral-400",
  },
];

export function ProcessSteps() {
  return (
    <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
      {STEPS.map(({ no, title, body, Icon, ring, numeral }) => (
        <div key={no} className="flex flex-col gap-[18px]">
          <div className="flex items-center gap-4">
            <span className={`inline-flex h-16 w-16 flex-none items-center justify-center rounded-pill ${ring}`}>
              <Icon size={28} strokeWidth={2.75} aria-hidden />
            </span>
            <span className={`font-heading text-[34px] ${numeral}`}>{no}</span>
          </div>
          <h4 className="m-0">{title}</h4>
          <p className="m-0 text-[14.5px] leading-[1.7] text-muted-72">{body}</p>
        </div>
      ))}
    </div>
  );
}
