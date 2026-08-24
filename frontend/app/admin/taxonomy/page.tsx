"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { CATEGORIES_TREE, MATERIAL_TAGS } from "@/lib/data";

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Categories are hierarchical (children are indented); materials are flat tags. */
export default function TaxonomyPage() {
  const toast = useToast();
  const [cats, setCats] = useState(CATEGORIES_TREE);
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) {
      toast("Nama kategori wajib diisi.");
      return;
    }
    setCats((prev) => [{ name: name.trim(), slug: slugify(name), count: "0", indent: 0 }, ...prev]);
    setName("");
    toast("Kategori ditambahkan.");
  };

  const remove = (slug: string) => {
    setCats((prev) => prev.filter((c) => c.slug !== slug));
    toast("Kategori dihapus.");
  };

  return (
    <AdminScreen>
      <PageHeading kicker="Taksonomi" title="Kategori & Material" />

      <div className="grid gap-4 2xl:grid-cols-[330px_minmax(0,1fr)] 2xl:items-start">
        <Panel className="flex flex-col gap-3.5 px-6 py-5">
          <h4 className="m-0">Tambah kategori</h4>
          <Field label="Nama">
            <input
              className="input"
              type="text"
              placeholder="mis. Lighting"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Slug">
            <input className="input" type="text" readOnly value={slugify(name)} />
          </Field>
          <Field label="Induk">
            <select className="input" defaultValue="— tanpa induk —">
              {["— tanpa induk —", "Lighting", "Furniture", "Home Decor"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="Deskripsi">
            <textarea className="input rounded-[20px]" placeholder="Opsional" />
          </Field>
          <button type="button" className="btn btn-primary btn-block" onClick={add}>
            Tambah kategori
          </button>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel className="ad-tablewrap px-3.5 py-1.5">
            <table>
              <thead>
                <tr>
                  <th className="ad-th w-[34px]">
                    <input type="checkbox" className="accent-accent" aria-label="Pilih semua kategori" />
                  </th>
                  <th className="ad-th">Kategori</th>
                  <th className="ad-th w-[180px]">Slug</th>
                  <th className="ad-th w-[110px]">Produk</th>
                  <th className="ad-th w-[96px] text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.slug} className="ad-row">
                    <td className="ad-td">
                      <input type="checkbox" className="accent-accent" aria-label={`Pilih ${c.name}`} />
                    </td>
                    <td className="ad-td">
                      <div className="font-heading text-[15px]" style={{ paddingLeft: c.indent }}>
                        {c.name}
                      </div>
                      <div className="ad-acts mt-1.5 flex gap-2.5">
                        <a href="#">Edit</a>
                        <a href="#">Lihat</a>
                        <button type="button" className="del text-accent-700" onClick={() => remove(c.slug)}>
                          Hapus
                        </button>
                      </div>
                    </td>
                    <td className="ad-td">{c.slug}</td>
                    <td className="ad-td">{c.count}</td>
                    <td className="ad-td">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="btn btn-secondary btn-icon h-[30px] w-[30px]"
                          aria-label={`Edit ${c.name}`}
                        >
                          <Pencil size={14} strokeWidth={2.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel className="px-6 py-5">
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
              <h4 className="m-0">Material (tag)</h4>
              <span className="text-admin-sm text-muted-55">Ukuran mengikuti jumlah produk</span>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {MATERIAL_TAGS.map((m) => (
                <Tag key={m.label} tone={m.tone} style={{ fontSize: m.size, padding: "5px 15px" }}>
                  {m.label}
                </Tag>
              ))}
              <Tag tone="outline" style={{ fontSize: 11, padding: "4px 12px" }}>
                + tambah material
              </Tag>
            </div>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
