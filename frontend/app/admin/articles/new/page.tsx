import Link from "next/link";
import { ChevronLeft, ImageIcon, Link2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen } from "@/components/admin/PageHeading";

export default function ArticleEditorPage() {
  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-wrap items-center gap-3">
        <Link href="/admin/articles" className="btn btn-secondary btn-icon" aria-label="Kembali">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </Link>
        <div>
          <div className="text-kicker uppercase text-muted-50">Artikel</div>
          <h3 className="mt-1">Tulis Artikel</h3>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_302px] 2xl:items-start">
        <Panel className="flex flex-col gap-4 px-6 py-5">
          <input
            className="input min-h-[54px] font-heading text-[22px]"
            type="text"
            placeholder="Judul artikel"
            aria-label="Judul artikel"
          />
          <div className="overflow-hidden rounded-[22px] border border-divider bg-surface">
            <div className="flex flex-wrap items-center gap-0.5 border-b border-divider px-2.5 py-1.5">
              <select
                className="input min-h-[28px] w-auto py-0.5 text-admin-sm"
                aria-label="Jenis blok"
                defaultValue="Paragraf"
              >
                {["Paragraf", "Heading 2", "Kutipan"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <span className="mx-1.5 h-[18px] w-px bg-divider" />
              <button type="button" className="ad-toolbtn font-bold" aria-label="Tebal">B</button>
              <button type="button" className="ad-toolbtn italic" aria-label="Miring">I</button>
              <button type="button" className="ad-toolbtn" aria-label="Tautan">
                <Link2 size={15} strokeWidth={2.75} />
              </button>
              <button type="button" className="ad-toolbtn" aria-label="Gambar">
                <ImageIcon size={15} strokeWidth={2.75} />
              </button>
              <span className="ml-auto text-meta text-muted-50">Blok: 4 · Kata: 612</span>
            </div>
            <div className="min-h-[300px] px-5 py-4.4 text-[14.5px] leading-[1.8] text-muted-55">
              Mulai menulis, atau tambahkan blok pertama…
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="p-5">
            <h4 className="mb-3.5">Publikasi</h4>
            <dl className="flex flex-col gap-2.5 text-[13px]">
              {[
                ["Status", "Draf"],
                ["Jadwal", "Segera"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="opacity-65">{k}</dt>
                  <dd className="m-0 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn btn-secondary flex-1">Pratinjau</button>
              <button type="button" className="btn btn-primary flex-1">Terbitkan</button>
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Gambar unggulan</h4>
            <div className="overflow-hidden rounded-[20px]" style={{ aspectRatio: "16 / 10" }}>
              <ImageSlot label="Set gambar unggulan" compact />
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Kategori &amp; tag</h4>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Tag tone="accent">Craft Journal</Tag>
              <Tag tone="accent-2">material</Tag>
              <Tag tone="accent-2">bantul</Tag>
            </div>
            <input className="input" type="text" placeholder="Tambah tag lalu Enter" aria-label="Tambah tag" />
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
