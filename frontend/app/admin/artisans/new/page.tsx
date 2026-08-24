"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, FileText } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";

/** New workshops always land as Verifikasi — nothing goes live unvetted. */
export default function ArtisanEditorPage() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [capacity, setCapacity] = useState("");

  const save = () => {
    if (!name.trim()) {
      toast("Nama workshop wajib diisi.");
      return;
    }
    toast("Pengrajin ditambahkan, status Verifikasi.");
    router.push("/admin/artisans");
  };

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-wrap items-center gap-3">
        <Link href="/admin/artisans" className="btn btn-secondary btn-icon" aria-label="Kembali">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </Link>
        <div>
          <div className="text-kicker uppercase text-muted-50">Artisan Database</div>
          <h3 className="mt-1">Tambah Pengrajin</h3>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_302px] 2xl:items-start">
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-4 px-6 py-5">
            <h4 className="m-0">Identitas workshop</h4>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Nama workshop">
                <input
                  className="input"
                  type="text"
                  placeholder="mis. Workshop Pak Slamet"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Nama penanggung jawab">
                <input className="input" type="text" placeholder="Nama lengkap" />
              </Field>
              <Field label="Nomor telepon">
                <input className="input" type="tel" placeholder="+62…" />
              </Field>
              <Field label="Mitra sejak">
                <input className="input" type="text" placeholder="2026" />
              </Field>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Desa / kelurahan">
                <input className="input" type="text" placeholder="mis. Bangunjiwo" />
              </Field>
              <Field label="Kabupaten / provinsi">
                <input
                  className="input"
                  type="text"
                  placeholder="mis. Bantul, DIY"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Alamat lengkap">
              <textarea className="input rounded-[20px]" placeholder="Alamat workshop" />
            </Field>
          </Panel>

          <Panel className="flex flex-col gap-4 px-6 py-5">
            <h4 className="m-0">Kapasitas &amp; keahlian</h4>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Jumlah pengrajin">
                <input className="input" type="text" placeholder="8" />
              </Field>
              <Field label="Kapasitas / bulan">
                <input
                  className="input"
                  type="text"
                  placeholder="600 pcs"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </Field>
              <Field label="Lead time rata-rata">
                <input className="input" type="text" placeholder="30 hari" />
              </Field>
            </div>
            <div>
              <div className="mb-2 text-[12px] text-muted-70">Keahlian utama</div>
              <div className="flex flex-wrap gap-2">
                <Tag tone="accent-2">anyaman rotan</Tag>
                <Tag tone="accent-2">rangka besi</Tag>
                <Tag tone="outline">+ tambah keahlian</Tag>
              </div>
            </div>
            <Field label="Catatan internal">
              <textarea
                className="input rounded-[20px]"
                placeholder="Kekuatan, keterbatasan, atau catatan negosiasi"
              />
            </Field>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="p-5">
            <h4 className="mb-3.5">Status</h4>
            {["Verifikasi", "Aktif", "Kapasitas penuh"].map((s, i) => (
              <label key={s} className="radio mb-2 flex">
                <input type="radio" name="astat" defaultChecked={i === 0} />
                <span className="dot" />
                {s}
              </label>
            ))}
            <div className="mt-4 flex gap-2">
              <Link href="/admin/artisans" className="btn btn-secondary flex-1">
                Batal
              </Link>
              <button type="button" className="btn btn-primary flex-1" onClick={save}>
                Simpan
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Foto workshop</h4>
            <div className="overflow-hidden rounded-[20px]" style={{ aspectRatio: "4 / 3" }}>
              <ImageSlot label="Unggah foto workshop" compact />
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Dokumen</h4>
            <div className="flex flex-col gap-2 text-[13px]">
              {["Perjanjian kerja sama", "Catatan asal material"].map((d) => (
                <div key={d} className="flex items-center gap-2.5 rounded-pill bg-surface px-3.5 py-2.5">
                  <FileText size={14} strokeWidth={2.75} aria-hidden />
                  {d}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary btn-block">
              Unggah dokumen
            </button>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
