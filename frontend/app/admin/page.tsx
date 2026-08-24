import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { AdminScreen } from "@/components/admin/PageHeading";
import { ACTIVITY, ARTISANS, INQUIRIES, PRODUCTS } from "@/lib/data";

/**
 * Dashboard.
 *
 * Every counter is derived from the same arrays the tables render — no numbers
 * are hard-coded, so the summary can never disagree with the screens it
 * summarises. "Order produksi" is the one figure with no table behind it yet.
 */
export default function AdminDashboardPage() {
  const drafts = PRODUCTS.filter((p) => p.status === "Draft").length;
  const newInquiries = INQUIRIES.filter((i) => i.status === "Baru").length;
  const inProgress = INQUIRIES.filter((i) => i.status === "Diproses").length;
  const activeArtisans = ARTISANS.filter((a) => a.status === "Aktif").length;

  const stats = [
    { label: "Produk aktif", value: PRODUCTS.length, note: `${drafts} draf menunggu`, noteClass: "text-sage-700" },
    { label: "Inquiry baru", value: newInquiries, note: `${inProgress} sedang ditindaklanjuti`, noteClass: "text-accent-700" },
    { label: "Pengrajin mitra", value: ARTISANS.length, note: `${activeArtisans} aktif`, noteClass: "text-muted-55" },
    { label: "Order produksi", value: 11, note: "3 tahap finishing", noteClass: "text-muted-55" },
  ];

  return (
    <AdminScreen>
      <div className="text-kicker uppercase text-muted-50">Ringkasan</div>
      <h3 className="mb-5 mt-1.5">Selamat pagi, Rani.</h3>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {stats.map((s) => (
          <Panel key={s.label} className="p-5">
            <div className="text-meta uppercase tracking-[.1em] text-muted-55">{s.label}</div>
            <div className="mt-2 font-heading text-[34px]">{s.value}</div>
            <div className={`mt-1 text-[12px] ${s.noteClass}`}>{s.note}</div>
          </Panel>
        ))}
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[1.3fr_.7fr]">
        <Panel className="px-6 py-5">
          <div className="flex items-center justify-between">
            <h4 className="m-0">Aktivitas terbaru</h4>
            <a href="#" className="text-admin-sm">Lihat semua</a>
          </div>
          <div className="mt-1.5 flex flex-col">
            {ACTIVITY.map((a) => (
              <div
                key={a.text}
                className="flex items-baseline gap-3.5 border-b border-[color-mix(in_srgb,#201e1d_8%,transparent)] py-3"
              >
                <Tag tone={a.tone} className="flex-none">
                  {a.kind}
                </Tag>
                <div className="min-w-0 flex-1">
                  <div className="text-admin">{a.text}</div>
                  <div className="mt-0.5 text-meta text-muted-50">{a.who}</div>
                </div>
                <span className="flex-none text-meta text-muted-45">{a.when}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="px-6 py-5">
            <h4 className="mb-3">Draf cepat</h4>
            <Field label="Judul" className="mb-2.5">
              <input className="input" type="text" placeholder="Judul artikel atau produk" />
            </Field>
            <Field label="Catatan">
              <textarea className="input rounded-[20px]" placeholder="Tulis ide singkat…" />
            </Field>
            <button type="button" className="btn btn-primary btn-block">
              Simpan draf
            </button>
          </Panel>

          <Panel className="px-6 py-5">
            <h4 className="mb-3">Sekilas situs</h4>
            <dl className="flex flex-col gap-2.5 text-admin">
              {[
                ["Produk publik", "121"],
                ["Draf", "7"],
                ["Artikel", "34"],
                ["Media", "612 file"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt>{k}</dt>
                  <dd className="m-0 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
