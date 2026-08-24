"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { Tabs } from "@/components/admin/Tabs";
import { AdminScreen } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { ADMIN_COMMENTS, toneForStatus } from "@/lib/data";

type Status = "Menunggu" | "Disetujui" | "Spam" | "Terhapus";

/**
 * Moderation queue. Comments arrive from the public article pages; an action
 * moves the comment between tabs, so the counts always match what is listed.
 */
export default function AdminCommentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<string>("Menunggu");
  const [states, setStates] = useState<Record<number, Status>>({});

  const statusOf = (i: number): Status => states[i] ?? ADMIN_COMMENTS[i].status;
  const setStatus = (i: number, next: Status, message: string) => {
    setStates((prev) => ({ ...prev, [i]: next }));
    toast(message);
  };

  const countOf = (label: string) =>
    ADMIN_COMMENTS.filter((_, i) => statusOf(i) === label).length;

  const view = ADMIN_COMMENTS.map((c, i) => ({ ...c, i })).filter((c) => statusOf(c.i) === tab);

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <div className="text-kicker uppercase text-muted-50">Moderasi</div>
          <h3 className="mt-1.5">Comments</h3>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={["Menunggu", "Disetujui", "Spam"].map((label) => ({
            label,
            count: countOf(label),
          }))}
        />
      </div>

      <Panel className="px-2.5 py-2">
        {view.length === 0 ? (
          <p className="px-3.5 py-6 text-admin text-muted-55">Tidak ada komentar di tab ini.</p>
        ) : null}
        {view.map((c) => (
          <div
            key={c.i}
            className="ad-row flex flex-wrap gap-3.5 border-b border-[color-mix(in_srgb,#201e1d_8%,transparent)] px-3.5 py-4"
          >
            <Avatar initial={c.initial} size={34} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong className="text-admin">{c.name}</strong>
                <span className="text-meta text-muted-50">pada “{c.post}”</span>
                <span className="ml-auto text-meta text-muted-45">{c.when}</span>
              </div>
              <p className="mt-1.5 text-admin leading-[1.6]">{c.text}</p>
              <div className="ad-acts mt-1.5 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-accent"
                  onClick={() => setStatus(c.i, "Disetujui", "Komentar disetujui dan tayang.")}
                >
                  Setujui
                </button>
                <button type="button" className="text-accent">Balas</button>
                <button
                  type="button"
                  className="text-accent"
                  onClick={() => setStatus(c.i, "Spam", "Komentar ditandai spam.")}
                >
                  Tandai spam
                </button>
                <button
                  type="button"
                  className="del text-accent-700"
                  onClick={() => setStatus(c.i, "Terhapus", "Komentar dihapus.")}
                >
                  Hapus
                </button>
              </div>
            </div>
            <Tag tone={toneForStatus(statusOf(c.i))} className="flex-none self-start">
              {statusOf(c.i)}
            </Tag>
          </div>
        ))}
      </Panel>
    </AdminScreen>
  );
}
