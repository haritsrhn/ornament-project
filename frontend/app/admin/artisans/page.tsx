"use client";

import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { ARTISANS, toneForStatus } from "@/lib/data";

export default function AdminArtisansPage() {
  return (
    <AdminScreen>
      <PageHeading
        kicker="Jaringan"
        title="Artisan Database"
        actions={
          <Link href="/admin/artisans/new" className="btn btn-primary px-5 py-2.5">
            <Plus size={16} strokeWidth={2.75} aria-hidden />
            Tambah pengrajin
          </Link>
        }
      />

      <Panel className="ad-tablewrap px-3.5 py-1.5">
        <table>
          <thead>
            <tr>
              <th className="ad-th w-[34px]">
                <input type="checkbox" className="accent-accent" aria-label="Pilih semua pengrajin" />
              </th>
              <th className="ad-th">Workshop</th>
              <th className="ad-th w-[150px]">Keahlian</th>
              <th className="ad-th w-[180px]">Desa / Kabupaten</th>
              <th className="ad-th w-[130px]">Kapasitas / bln</th>
              <th className="ad-th w-[120px]">Status</th>
              <th className="ad-th w-[96px] text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {ARTISANS.map((a) => (
              <tr key={a.slug} className="ad-row">
                <td className="ad-td">
                  <input type="checkbox" className="accent-accent" aria-label={`Pilih ${a.name}`} />
                </td>
                <td className="ad-td">
                  <div className="flex items-center gap-2.5">
                    <Avatar initial={a.initial} size={38} />
                    <div>
                      <div className="font-heading text-[15px]">{a.name}</div>
                      <div className="mt-0.5 text-meta text-muted-50">
                        Mitra sejak {a.since.replace("mitra sejak ", "")}
                      </div>
                      <div className="ad-acts mt-1.5 flex gap-2.5">
                        <Link href="/admin/artisans/new">Edit</Link>
                        <a href="#">Riwayat order</a>
                        <a href="#" className="del">Arsipkan</a>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="ad-td">{a.craft}</td>
                <td className="ad-td">{a.place}</td>
                <td className="ad-td">{a.capacity}</td>
                <td className="ad-td">
                  <Tag tone={toneForStatus(a.status)}>{a.status}</Tag>
                </td>
                <td className="ad-td">
                  <div className="flex justify-end gap-1.5">
                    <Link
                      href="/admin/artisans/new"
                      className="btn btn-secondary btn-icon h-[30px] w-[30px]"
                      aria-label={`Edit ${a.name}`}
                    >
                      <Pencil size={14} strokeWidth={2.75} />
                    </Link>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon h-[30px] w-[30px] text-accent-700"
                      aria-label={`Arsipkan ${a.name}`}
                    >
                      <Trash2 size={14} strokeWidth={2.75} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AdminScreen>
  );
}
