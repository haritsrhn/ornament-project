"use client";

import { useState } from "react";
import { GripVertical, Info } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { Tabs } from "@/components/admin/Tabs";
import { useToast } from "@/components/admin/ToastProvider";
import { COMPANY, NAV_ITEMS } from "@/lib/data";

const TABS = ["Umum", "Menu & Navigasi", "Permalink", "SEO", "Tema"];

const META_DESCRIPTION =
  "Agen sourcing kerajinan Indonesia di Bantul, Yogyakarta. Menjembatani pengrajin lokal dengan pembeli global — QC empat titik, garansi 7 hari.";

/* Didefinisikan di module scope, bukan di dalam AdminSettingsPage: komponen yang
   dibuat ulang tiap render akan me-reset state-nya (react-hooks/static-components).
   Markup yang dihasilkan sama persis seperti sebelumnya. */
function SaveRow({ onSave }: { onSave: () => void }) {
  return (
    <div className="mt-1 flex justify-end gap-2">
      <button type="button" className="btn btn-secondary">Batal</button>
      <button type="button" className="btn btn-primary" onClick={onSave}>
        Simpan perubahan
      </button>
    </div>
  );
}

export default function AdminSettingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState(TABS[0]);
  const [metaDescription, setMetaDescription] = useState(META_DESCRIPTION);

  const saveSettings = () => { toast("Pengaturan disimpan."); };

  return (
    <AdminScreen>
      <PageHeading kicker="Konfigurasi" title="Settings" />

      <div className="mb-4">
        <Tabs tabs={TABS.map((label) => ({ label }))} value={tab} onChange={setTab} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px] 2xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {tab === "Umum" ? (
            <Panel className="flex flex-col gap-4 px-6 py-6">
              <h4 className="m-0">Umum</h4>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Nama situs">
                  <input className="input" type="text" defaultValue={COMPANY.name} />
                </Field>
                <Field label="Tagline">
                  <input className="input" type="text" defaultValue={COMPANY.tagline} />
                </Field>
                <Field label="Email kontak">
                  <input className="input" type="email" defaultValue={COMPANY.email} />
                </Field>
                <Field label="Instagram">
                  <input className="input" type="text" defaultValue={COMPANY.instagramHandle} />
                </Field>
                <Field label="Bahasa situs">
                  <select className="input" defaultValue="Bahasa Indonesia">
                    {["Bahasa Indonesia", "English", "Dwibahasa"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Zona waktu">
                  <select className="input" defaultValue="WIB (UTC+7)">
                    {["WIB (UTC+7)", "UTC"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Alamat workshop">
                <textarea
                  className="input rounded-[20px]"
                  defaultValue={COMPANY.addressLines.join(", ")}
                />
              </Field>
              <SaveRow onSave={saveSettings} />
            </Panel>
          ) : null}

          {tab === "Menu & Navigasi" ? (
            <Panel className="flex flex-col gap-4 px-6 py-6">
              <h4 className="m-0">Menu &amp; Navigasi</h4>
              <p className="m-0 text-[13px] text-muted-65">
                Susun item menu utama situs publik. Tarik untuk mengubah urutan.
              </p>
              <div className="flex flex-col gap-2">
                {NAV_ITEMS.map((n) => (
                  <div
                    key={n.url + n.label}
                    className="flex flex-wrap items-center gap-3 rounded-pill bg-surface px-4 py-3 text-admin"
                  >
                    <GripVertical
                      size={15}
                      strokeWidth={2.75}
                      className="cursor-grab opacity-45"
                      aria-hidden
                    />
                    <span className="flex-1">{n.label}</span>
                    <span className="text-[12px] text-muted-50">{n.url}</span>
                    <Tag tone={n.tone}>{n.type}</Tag>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2.5">
                <select className="input w-auto" aria-label="Jenis item baru" defaultValue="Tambah: Halaman">
                  {["Tambah: Halaman", "Tambah: Kategori", "Tambah: Tautan khusus"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary">Tambah item</button>
              </div>
              <SaveRow onSave={saveSettings} />
            </Panel>
          ) : null}

          {tab === "Permalink" ? (
            <Panel className="flex flex-col gap-4 px-6 py-6">
              <h4 className="m-0">Permalink</h4>
              <div>
                <div className="mb-2 text-[12px] text-muted-70">Struktur URL produk</div>
                <div className="seg flex-wrap">
                  {["/produk/nama-produk", "/p/123", "/kategori/nama-produk"].map((o, i) => (
                    <button key={o} type="button" className="seg-opt" aria-pressed={i === 0}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] text-muted-70">Struktur URL artikel</div>
                <div className="seg flex-wrap">
                  {["/journal/judul-artikel", "/2026/08/judul-artikel"].map((o, i) => (
                    <button key={o} type="button" className="seg-opt" aria-pressed={i === 0}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Prefiks kategori">
                  <input className="input" type="text" defaultValue="kategori" />
                </Field>
                <Field label="Prefiks material">
                  <input className="input" type="text" defaultValue="material" />
                </Field>
              </div>
              <div className="rounded-[24px] bg-surface px-4.4 py-4 text-admin-sm text-muted-70">
                Contoh URL: <code>{COMPANY.domain}/produk/bulan-pendant-lamp</code>
              </div>
              <SaveRow onSave={saveSettings} />
            </Panel>
          ) : null}

          {tab === "SEO" ? (
            <Panel className="flex flex-col gap-4 px-6 py-6">
              <h4 className="m-0">SEO</h4>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Judul meta beranda">
                  <input
                    className="input"
                    type="text"
                    defaultValue="Ornament Sourcing Agent — Good Value"
                  />
                </Field>
                <Field label="Kata kunci utama">
                  <input className="input" type="text" defaultValue="indonesian craft sourcing" />
                </Field>
              </div>
              <div>
                <Field label="Deskripsi meta">
                  <textarea
                    className="input"
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                  />
                </Field>
                <div className="mt-1.5 text-meta text-muted-50">
                  {metaDescription.length} / 160 karakter
                </div>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Sitemap">
                  <select className="input" defaultValue="Aktif — /sitemap.xml">
                    {["Aktif — /sitemap.xml", "Nonaktif"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Indeks mesin pencari">
                  <select className="input" defaultValue="Izinkan">
                    {["Izinkan", "Blokir (noindex)"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="rounded-[24px] bg-surface px-4.4 py-4">
                <div className="mb-1.5 text-meta text-muted-55">Pratinjau hasil pencarian</div>
                <div className="text-[12px] text-sage-700">{COMPANY.domain}</div>
                <div className="mt-0.5 text-[16px] text-accent-700">
                  Ornament Sourcing Agent — Good Value
                </div>
                <div className="mt-1 text-admin-sm leading-[1.6] text-muted-70">
                  {metaDescription}
                </div>
              </div>
              <SaveRow onSave={saveSettings} />
            </Panel>
          ) : null}

          {tab === "Tema" ? (
            <Panel className="flex flex-col gap-4 px-6 py-6">
              <h4 className="m-0">Tema</h4>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
                <div className="rounded-[24px] bg-surface p-3.5 outline outline-2 outline-offset-2 outline-accent">
                  <div
                    className="grid place-items-center rounded-[18px] bg-bg font-heading text-[15px]"
                    style={{ aspectRatio: "16 / 10" }}
                  >
                    Organic
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-admin">Organic v1.2</span>
                    <Tag tone="accent-2">Aktif</Tag>
                  </div>
                </div>
                <div className="rounded-[24px] bg-surface p-3.5">
                  <div
                    className="grid place-items-center rounded-[18px] bg-neutral-300 text-[13px] text-neutral-800"
                    style={{ aspectRatio: "16 / 10" }}
                  >
                    Warm Editorial
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-admin">Editorial v0.9</span>
                    <button type="button" className="btn btn-secondary px-3 py-1.5 text-[12px]">
                      Aktifkan
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Warna aksen">
                  <select className="input" defaultValue="Terracotta (#c67139)">
                    {["Terracotta (#c67139)", "Sage (#7a8a5e)"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Font heading">
                  <select className="input" defaultValue="Caprasimo">
                    {["Caprasimo", "Figtree"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex items-center gap-3 rounded-[24px] bg-surface px-4.4 py-3.5 text-[13px] text-muted-70">
                <Info size={17} strokeWidth={2.75} className="flex-none text-accent" aria-hidden />
                Perubahan tema berlaku untuk seluruh halaman publik setelah disimpan.
              </div>
              <SaveRow onSave={saveSettings} />
            </Panel>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="p-5">
            <h4 className="mb-3">Logo &amp; ikon</h4>
            <div className="grid place-items-center rounded-[20px] bg-surface p-4">
              <Logo height={26} />
            </div>
            <button type="button" className="btn btn-secondary btn-block">Ganti logo</button>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Tema aktif</h4>
            <div className="overflow-hidden rounded-[18px]" style={{ aspectRatio: "16 / 10" }}>
              <ImageSlot label="Pratinjau tema" compact />
            </div>
            <div className="mt-2.5 text-admin">Organic — v1.2</div>
            <div className="text-[12px] text-muted-55">Terakhir diperbarui 12 Agu 2026</div>
          </Panel>

          <Panel className="p-5">
            <h4 className="mb-3">Menu navigasi</h4>
            <div className="flex flex-col gap-1.5 text-admin">
              {["Our Story", "Catalog", "Process", "Terms"].map((m) => (
                <div key={m} className="flex items-center gap-2.5 rounded-pill bg-surface px-3 py-2.5">
                  <GripVertical size={14} strokeWidth={2.75} className="opacity-45" aria-hidden />
                  {m}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-secondary btn-block">Tambah item menu</button>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
