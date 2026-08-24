"use client";

import Link from "next/link";
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Tabs } from "@/components/admin/Tabs";
import { AdminScreen } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { ARTICLES, toneForStatus } from "@/lib/data";

export default function AdminArticlesPage() {
  const toast = useToast();
  const [posts, setPosts] = useState(ARTICLES);
  const [tab, setTab] = useState("Semua");

  const view = tab === "Semua" ? posts : posts.filter((p) => p.status === tab);

  const trash = (slug: string) => {
    setPosts((prev) => prev.filter((p) => p.slug !== slug));
    toast("Artikel dipindahkan ke Trash.");
  };

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <div className="text-kicker uppercase text-muted-50">Konten</div>
          <h3 className="mt-1.5">Semua Artikel</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { label: "Semua", count: posts.length },
              { label: "Published", count: posts.filter((p) => p.status === "Published").length },
              { label: "Draft", count: posts.filter((p) => p.status === "Draft").length },
              { label: "Scheduled", count: posts.filter((p) => p.status === "Scheduled").length },
            ]}
          />
          <Link href="/admin/articles/new" className="btn btn-primary px-4.4 py-2.5">
            Tulis artikel
          </Link>
        </div>
      </div>

      <Panel className="ad-tablewrap px-3.5 py-1.5">
        <table>
          <thead>
            <tr>
              <th className="ad-th w-[34px]">
                <input type="checkbox" className="accent-accent" aria-label="Pilih semua artikel" />
              </th>
              <th className="ad-th">Judul</th>
              <th className="ad-th w-[150px]">Penulis</th>
              <th className="ad-th w-[180px]">Kategori</th>
              <th className="ad-th w-[150px]">Tanggal</th>
              <th className="ad-th w-[120px]">Status</th>
            </tr>
          </thead>
          <tbody>
            {view.map((p) => (
              <tr key={p.slug} className="ad-row">
                <td className="ad-td">
                  <input type="checkbox" className="accent-accent" aria-label={`Pilih ${p.title}`} />
                </td>
                <td className="ad-td">
                  <div className="font-heading text-[15px]">{p.title}</div>
                  <div className="ad-acts mt-1.5 flex gap-2.5">
                    <Link href="/admin/articles/new">Edit</Link>
                    <Link href={`/journal/${p.slug}`}>Lihat</Link>
                    <button type="button" className="del text-accent-700" onClick={() => trash(p.slug)}>
                      Trash
                    </button>
                  </div>
                </td>
                <td className="ad-td">{p.author}</td>
                <td className="ad-td">{p.category}</td>
                <td className="ad-td">{p.status === "Draft" ? "—" : p.date}</td>
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
