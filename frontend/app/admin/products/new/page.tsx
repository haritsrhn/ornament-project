"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ImageIcon, Link2, List, ListOrdered } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { Avatar } from "@/components/ui/Avatar";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";

/** Slugs are derived from the name, never typed by hand. */
function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Product editor. Serves both "Tambah Produk" and "Edit Produk"; this phase
 * only wires the empty-form case, so a new SKU is generated on mount.
 * Publishing sets In Stock, saving sets Draft — neither writes anywhere yet.
 */
export default function ProductEditorPage() {
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [sku] = useState(() => `ORN-NEW-${1000 + Math.floor(Math.random() * 9000)}`);
  const [moq, setMoq] = useState("50 pcs");
  const [lead, setLead] = useState("30 hari");
  const [price, setPrice] = useState("USD 0.00");
  const [status, setStatus] = useState("Draft");

  const commit = (next: "In Stock" | "Draft", message: string) => {
    if (!name.trim()) {
      toast("Nama produk wajib diisi.");
      return;
    }
    setStatus(next);
    toast(message);
    router.push("/admin/products");
  };

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-wrap items-center gap-3">
        <Link href="/admin/products" className="btn btn-secondary btn-icon" aria-label="Kembali">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </Link>
        <div>
          <div className="text-kicker uppercase text-muted-50">Produk</div>
          <h3 className="mt-1">Tambah Produk</h3>
        </div>
        <Tag tone="neutral" className="ml-2">
          Produk baru — belum tersimpan
        </Tag>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_302px] 2xl:items-start">
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-4 px-6 py-5">
            <Field label="Nama produk">
              <input
                className="input min-h-[46px] font-heading text-[18px]"
                type="text"
                placeholder="mis. Bulan Pendant Lamp"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Slug">
              <input
                className="input"
                type="text"
                readOnly
                value={slugify(name)}
                placeholder="dihasilkan dari nama produk"
              />
            </Field>
            <Field label="Deskripsi">
              <div className="overflow-hidden rounded-[22px] border border-divider bg-surface">
                <div className="flex items-center gap-0.5 border-b border-divider px-2.5 py-1.5">
                  <button type="button" className="ad-toolbtn font-bold" aria-label="Tebal">B</button>
                  <button type="button" className="ad-toolbtn italic" aria-label="Miring">I</button>
                  <button type="button" className="ad-toolbtn underline" aria-label="Garis bawah">U</button>
                  <span className="mx-1.5 h-[18px] w-px bg-divider" />
                  <button type="button" className="ad-toolbtn" aria-label="Daftar">
                    <List size={15} strokeWidth={2.75} />
                  </button>
                  <button type="button" className="ad-toolbtn" aria-label="Daftar bernomor">
                    <ListOrdered size={15} strokeWidth={2.75} />
                  </button>
                  <button type="button" className="ad-toolbtn" aria-label="Tautan">
                    <Link2 size={15} strokeWidth={2.75} />
                  </button>
                  <button type="button" className="ad-toolbtn" aria-label="Gambar">
                    <ImageIcon size={15} strokeWidth={2.75} />
                  </button>
                </div>
                <div className="min-h-[170px] px-4.4 py-4 text-[14px] leading-[1.75] text-muted-85">
                  <p className="mb-3">
                    Lampu gantung anyaman rotan dengan rangka besi bubuk lapis hitam matte.
                    Diameter 45 cm, tinggi 38 cm, kabel 150 cm.
                  </p>
                  <p className="m-0">
                    Dianyam oleh workshop keluarga di Bantul. Finishing natural clear coat,
                    tersedia opsi pewarna walnut atau ebony.
                  </p>
                </div>
              </div>
            </Field>
          </Panel>

          <Panel className="px-6 py-5">
            <h4 className="mb-4">Spesifikasi &amp; produksi</h4>
            <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="SKU">
                <input className="input" type="text" readOnly value={sku} />
              </Field>
              <Field label="MOQ">
                <input className="input" type="text" value={moq} onChange={(e) => setMoq(e.target.value)} />
              </Field>
              <Field label="Lead time">
                <input className="input" type="text" value={lead} onChange={(e) => setLead(e.target.value)} />
              </Field>
              <Field label="Dimensi (cm)">
                <input className="input" type="text" defaultValue="45 × 45 × 38" />
              </Field>
              <Field label="Berat / pcs">
                <input className="input" type="text" defaultValue="1,8 kg" />
              </Field>
              <Field label="Harga FOB">
                <input className="input" type="text" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
            </div>
            <div className="mb-2 mt-4 text-[12px] text-muted-60">Checklist QC</div>
            <div className="flex flex-wrap gap-2">
              <Tag tone="accent-2">Material ✓</Tag>
              <Tag tone="accent-2">Frame ✓</Tag>
              <Tag tone="accent">Finishing — proses</Tag>
              <Tag tone="outline">Packaging</Tag>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="p-5">
            <h4 className="mb-3.5">Publikasi</h4>
            <dl className="flex flex-col gap-2.5 text-[13px]">
              {[
                ["Status", status],
                ["Visibilitas", "Publik"],
                ["Revisi", "4"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="opacity-65">{k}</dt>
                  <dd className="m-0 font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => commit("Draft", "Draf produk disimpan.")}
              >
                Simpan draf
              </button>
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={() => commit("In Stock", "Produk diterbitkan.")}
              >
                Terbitkan
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Foto utama</h4>
            <div className="overflow-hidden rounded-[20px]" style={{ aspectRatio: "4 / 3" }}>
              <ImageSlot label="Set foto utama" compact />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="overflow-hidden rounded-sm bg-surface" style={{ aspectRatio: "1" }}>
                <ImageSlot label="" compact />
              </div>
              <div className="overflow-hidden rounded-sm bg-surface" style={{ aspectRatio: "1" }}>
                <ImageSlot label="" compact />
              </div>
              <button
                type="button"
                className="grid place-items-center rounded-sm bg-surface text-[20px] text-accent"
                style={{ aspectRatio: "1" }}
                aria-label="Tambah foto"
              >
                +
              </button>
            </div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Kategori</h4>
            {["Lighting", "Furniture", "Home Decor"].map((c, i) => (
              <label key={c} className="radio mb-2 flex">
                <input type="radio" name="cat" defaultChecked={i === 0} />
                <span className="dot" />
                {c}
              </label>
            ))}
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Material &amp; tag</h4>
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              <Tag tone="accent-2">rotan</Tag>
              <Tag tone="accent-2">handwoven</Tag>
              <Tag tone="accent-2">natural finish</Tag>
            </div>
            <input className="input" type="text" placeholder="Tambah tag lalu Enter" aria-label="Tambah tag" />
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Pengrajin</h4>
            <div className="flex items-center gap-2.5">
              <Avatar initial="S" size={38} />
              <div>
                <div className="text-admin">Workshop Pak Slamet</div>
                <div className="text-meta text-muted-55">Bantul, Yogyakarta</div>
              </div>
            </div>
            <button type="button" className="btn btn-secondary btn-block">
              Ganti pengrajin
            </button>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
