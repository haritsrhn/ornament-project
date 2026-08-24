"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { SITE_PAGES, toneForStatus } from "@/lib/data";

export default function AdminPagesPage() {
  const toast = useToast();
  const [pages, setPages] = useState(SITE_PAGES);

  const trash = (url: string) => {
    setPages((prev) => prev.filter((p) => p.url !== url));
    toast("Halaman dipindahkan ke Trash.");
  };

  return (
    <AdminScreen>
      <PageHeading
        kicker="Struktur situs"
        title="Semua Halaman"
        actions={
          <Link href="/admin/pages/builder" className="btn btn-primary px-5 py-2.5">
            <Plus size={16} strokeWidth={2.75} aria-hidden />
            Halaman baru
          </Link>
        }
      />

      <Panel className="ad-tablewrap px-3.5 py-1.5">
        <table>
          <thead>
            <tr>
              <th className="ad-th w-[34px]">
                <input type="checkbox" className="accent-accent" aria-label="Pilih semua halaman" />
              </th>
              <th className="ad-th">Judul halaman</th>
              <th className="ad-th w-[190px]">URL</th>
              <th className="ad-th w-[110px]">Blok</th>
              <th className="ad-th w-[150px]">Diperbarui</th>
              <th className="ad-th w-[120px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.url} className="ad-row">
                <td className="ad-td">
                  <input type="checkbox" className="accent-accent" aria-label={`Pilih ${p.title}`} />
                </td>
                <td className="ad-td">
                  <div className="font-heading text-[15px]">{p.title}</div>
                  <div className="ad-acts mt-1.5 flex gap-2.5">
                    <Link href="/admin/pages/builder">Edit blok</Link>
                    <Link href={p.url}>Lihat</Link>
                    <button type="button" className="del text-accent-700" onClick={() => trash(p.url)}>
                      Trash
                    </button>
                  </div>
                </td>
                <td className="ad-td">{p.url}</td>
                <td className="ad-td">{p.blocks}</td>
                <td className="ad-td">{p.updated}</td>
                <td className="ad-td">
                  <Tag tone={toneForStatus(p.status)}>{p.status}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AdminScreen>
  );
}
