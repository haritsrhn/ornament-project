"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { ROLE_CAPS, USERS } from "@/lib/data";
import type { TagTone } from "@/lib/types";

type Row = (typeof USERS)[number];

export default function AdminUsersPage() {
  const toast = useToast();
  const [pending, setPending] = useState<Row[]>([]);

  const invite = () => {
    const n = pending.length + 1;
    setPending((prev) => [
      {
        initial: "U",
        name: `Undangan tertunda ${n}`,
        email: `undangan${n}@ornament.id`,
        role: "Contributor",
        content: "—",
        last: "Belum masuk",
        tone: "outline" as TagTone,
      } as Row,
      ...prev,
    ]);
    toast("Undangan dikirim, menunggu penerimaan.");
  };

  const rows = [...pending, ...USERS];

  return (
    <AdminScreen>
      <PageHeading
        kicker="Akses"
        title="Users & Roles"
        actions={
          <button type="button" className="btn btn-primary px-5 py-2.5" onClick={invite}>
            Undang pengguna
          </button>
        }
      />

      <Panel className="ad-tablewrap mb-4 px-3.5 py-1.5">
        <table>
          <thead>
            <tr>
              <th className="ad-th w-[34px]">
                <input type="checkbox" className="accent-accent" aria-label="Pilih semua pengguna" />
              </th>
              <th className="ad-th">Nama</th>
              <th className="ad-th w-[230px]">Email</th>
              <th className="ad-th w-[150px]">Peran</th>
              <th className="ad-th w-[130px]">Konten</th>
              <th className="ad-th w-[150px]">Terakhir aktif</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.email} className="ad-row">
                <td className="ad-td">
                  <input type="checkbox" className="accent-accent" aria-label={`Pilih ${u.name}`} />
                </td>
                <td className="ad-td">
                  <div className="flex items-center gap-2.5">
                    <Avatar initial={u.initial} size={34} />
                    <div>
                      <div className="text-admin">{u.name}</div>
                      <div className="ad-acts mt-0.5 flex gap-2.5">
                        <a href="#">Edit</a>
                        <a href="#" className="del">Cabut akses</a>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="ad-td">{u.email}</td>
                <td className="ad-td">
                  <Tag tone={u.tone}>{u.role}</Tag>
                </td>
                <td className="ad-td">{u.content}</td>
                <td className="ad-td">{u.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="px-6 py-5">
        <h4 className="mb-4">Hak akses per peran</h4>
        <div className="ad-tablewrap">
          <table>
            <thead>
              <tr>
                <th className="ad-th">Kemampuan</th>
                <th className="ad-th w-[120px]">Admin</th>
                <th className="ad-th w-[120px]">Editor</th>
                <th className="ad-th w-[120px]">Contributor</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_CAPS.map((c) => (
                <tr key={c.name}>
                  <td className="ad-td">{c.name}</td>
                  <td className="ad-td">{c.admin}</td>
                  <td className="ad-td">{c.editor}</td>
                  <td className="ad-td">{c.contrib}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminScreen>
  );
}
