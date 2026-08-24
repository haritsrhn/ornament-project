"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { Tabs } from "@/components/admin/Tabs";
import { AdminScreen } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";
import { INQUIRIES } from "@/lib/data";
import type { Inquiry } from "@/lib/types";

const TAB_TO_STATUS: Record<string, Inquiry["status"]> = {
  "Belum dibaca": "Baru",
  Ditindaklanjuti: "Diproses",
  Selesai: "Selesai",
};

function dotFor(status: Inquiry["status"]) {
  if (status === "Baru") return "var(--color-accent)";
  if (status === "Diproses") return "var(--color-accent-2)";
  return "var(--color-neutral-400)";
}

function toneFor(status: Inquiry["status"]) {
  if (status === "Baru") return "accent" as const;
  if (status === "Diproses") return "accent-2" as const;
  return "neutral" as const;
}

/**
 * Inquiries. List on the left, detail on the right; below 1180px the detail
 * panel drops under the list. Sending a reply moves the inquiry to Diproses and
 * follows it to the Ditindaklanjuti tab, so the user is never left staring at a
 * row that has just left the list they were looking at.
 */
export default function AdminInquiriesPage() {
  const toast = useToast();
  const [tab, setTab] = useState("Belum dibaca");
  const [selected, setSelected] = useState(0);
  const [states, setStates] = useState<Record<number, Inquiry["status"]>>({});
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState<string | null>(null);

  const statusOf = (i: number) => states[i] ?? INQUIRIES[i].status;
  const view = INQUIRIES.map((q, i) => ({ ...q, i })).filter(
    (q) => statusOf(q.i) === TAB_TO_STATUS[tab],
  );

  const current = INQUIRIES[selected];
  const currentStatus = statusOf(selected);
  const draft =
    replyText ??
    `Hai ${current.name.split(" ")[0]}, terima kasih atas permintaannya. Untuk ${current.volume} kami sanggup memenuhi dengan lead time 40 hari kerja; penawaran rinci menyusul di lampiran.`;

  const sendReply = () => {
    setStates((prev) => ({ ...prev, [selected]: "Diproses" }));
    setReplyOpen(false);
    setReplyText(null);
    setTab("Ditindaklanjuti");
    toast(`Balasan terkirim ke ${current.email}.`);
  };

  const markDone = () => {
    setStates((prev) => ({ ...prev, [selected]: "Selesai" }));
    setTab("Selesai");
    toast("Inquiry ditandai selesai.");
  };

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <div className="text-kicker uppercase text-muted-50">Masuk</div>
          <h3 className="mt-1.5">Inquiries</h3>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={Object.entries(TAB_TO_STATUS).map(([label, status]) => ({
            label,
            count: INQUIRIES.filter((_, i) => statusOf(i) === status).length,
          }))}
        />
      </div>

      <div className="grid gap-4 3xl:grid-cols-[minmax(0,1fr)_380px] 3xl:items-start">
        <Panel className="min-w-0 px-2.5 py-2">
          {view.length === 0 ? (
            <p className="px-3.5 py-6 text-admin text-muted-55">Tidak ada inquiry di tab ini.</p>
          ) : null}
          {view.map((q) => (
            <button
              key={q.i}
              type="button"
              onClick={() => setSelected(q.i)}
              aria-pressed={selected === q.i}
              className="flex w-full flex-wrap gap-3 border-b border-[color-mix(in_srgb,#201e1d_8%,transparent)] px-3.5 py-4 text-left"
              style={{
                background:
                  selected === q.i
                    ? "color-mix(in srgb,var(--color-accent) 10%,transparent)"
                    : "transparent",
              }}
            >
              <span
                className="mt-1.5 h-2 w-2 flex-none rounded-pill"
                style={{ background: dotFor(statusOf(q.i)) }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-admin">{q.name}</strong>
                  <span className="text-meta text-muted-50">{q.company}</span>
                  <span className="ml-auto text-meta text-muted-45">{q.when}</span>
                </span>
                <span className="mt-0.5 block text-[13px]">{q.subject}</span>
                <span className="mt-0.5 block truncate text-admin-sm text-muted-55">
                  {q.preview}
                </span>
              </span>
              <Tag tone={toneFor(statusOf(q.i))} className="flex-none self-start">
                {statusOf(q.i)}
              </Tag>
            </button>
          ))}
        </Panel>

        <Panel className="px-6 py-5">
          <div className="text-kicker uppercase tracking-[.12em] text-muted-50">
            Detail inquiry · {currentStatus}
          </div>
          <h4 className="mb-1 mt-2">{current.subject}</h4>
          <div className="mb-4 text-admin-sm text-muted-55">
            {current.name} · {current.company}
          </div>
          <p className="text-admin leading-[1.75]">{current.body}</p>

          <dl className="my-4 flex flex-col gap-2 rounded-[20px] bg-surface p-3.5 text-[13px]">
            {[
              ["Volume", current.volume],
              ["Target kirim", current.target],
              ["Tujuan", current.port],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="opacity-65">{k}</dt>
                <dd className="m-0 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={markDone}>
              Tandai selesai
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              aria-expanded={replyOpen}
              onClick={() => setReplyOpen((v) => !v)}
            >
              Balas
            </button>
          </div>

          {replyOpen ? (
            <div className="mt-4 border-t border-divider pt-4">
              <Field label="Kepada" className="mb-2.5">
                <input className="input" type="email" readOnly value={current.email} />
              </Field>
              <Field label="Subjek" className="mb-2.5">
                <input className="input" type="text" defaultValue={`Re: ${current.subject}`} />
              </Field>
              <Field label="Pesan">
                <textarea
                  className="input min-h-[120px]"
                  value={draft}
                  onChange={(e) => setReplyText(e.target.value)}
                />
              </Field>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary gap-1.5">
                  <Upload size={15} strokeWidth={2.75} aria-hidden />
                  Lampirkan penawaran
                </button>
                <button type="button" className="btn btn-secondary">Simpan draf</button>
                <button type="button" className="btn btn-primary" onClick={sendReply}>
                  Kirim balasan
                </button>
              </div>
              <p className="mt-2.5 text-meta text-muted-50">
                Balasan tercatat pada riwayat inquiry dan aktivitas dashboard.
              </p>
            </div>
          ) : null}
        </Panel>
      </div>
    </AdminScreen>
  );
}
