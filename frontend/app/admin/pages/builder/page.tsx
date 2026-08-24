"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, GripVertical, Plus } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Field } from "@/components/ui/Field";
import { Logo } from "@/components/ui/Logo";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen } from "@/components/admin/PageHeading";
import { BUILDER_BLOCKS } from "@/lib/data";
import { cn } from "@/lib/cn";
import type { TagTone } from "@/lib/types";

const VIEWPORTS = ["Desktop", "Tablet", "Mobile"] as const;
type Viewport = (typeof VIEWPORTS)[number];

type Overrides = Record<number, Partial<{ title: string; cta: string; link: string }>>;

function stateTone(state: string): TagTone {
  if (state === "Tersembunyi") return "outline";
  if (state === "Global") return "neutral";
  return "accent-2";
}

/**
 * Page Builder.
 *
 * Three columns: block order, live preview, block settings. Edits are stored
 * per block, so switching selection and coming back keeps what was typed. The
 * selected block is filled + accent-outlined — a lighter tint would read as
 * disabled rather than chosen.
 */
export default function PageBuilderPage() {
  const [selected, setSelected] = useState(0);
  const [viewport, setViewport] = useState<Viewport>("Desktop");
  const [overrides, setOverrides] = useState<Overrides>({});

  const base = BUILDER_BLOCKS[selected];
  const block = { ...base, ...overrides[selected] };
  const nextBlock = BUILDER_BLOCKS[(selected + 1) % BUILDER_BLOCKS.length];
  const shortName = (n: string) => n.split(" — ")[0];

  const edit = (key: "title" | "cta" | "link") => (value: string) =>
    setOverrides((prev) => ({ ...prev, [selected]: { ...prev[selected], [key]: value } }));

  const previewWidth =
    viewport === "Mobile" ? "min(420px, 100%)" : viewport === "Tablet" ? "min(760px, 100%)" : "100%";

  return (
    <AdminScreen>
      <div className="mb-4.4 flex flex-wrap items-center gap-3">
        <Link href="/admin/pages" className="btn btn-secondary btn-icon" aria-label="Kembali">
          <ChevronLeft size={16} strokeWidth={2.75} />
        </Link>
        <div>
          <div className="text-kicker uppercase text-muted-50">Page Builder</div>
          <h3 className="mt-1">Landing Page — Beranda</h3>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tag tone="neutral">Tersimpan otomatis · 1 mnt lalu</Tag>
          <button type="button" className="btn btn-secondary">Pratinjau</button>
          <button type="button" className="btn btn-primary">Perbarui</button>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[300px_minmax(0,1fr)] 3xl:grid-cols-[300px_minmax(0,1fr)_260px] 2xl:items-start">
        <Panel className="p-5">
          <h4 className="mb-3">Susunan blok</h4>
          <div className="flex flex-col gap-1.5">
            {BUILDER_BLOCKS.map((b, i) => {
              const isSelected = i === selected;
              return (
                <button
                  key={b.name}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[18px] bg-surface px-3 py-2.5 text-left text-[13px]",
                    isSelected
                      ? "text-accent-800 outline outline-2 outline-offset-2 outline-accent"
                      : "text-ink",
                  )}
                >
                  <GripVertical size={14} strokeWidth={2.75} className="opacity-50" aria-hidden />
                  <span className="flex-1">{b.name}</span>
                  {isSelected ? (
                    <span className="tag bg-accent text-[10px] text-[#f5ead8]">Terpilih</span>
                  ) : (
                    <Tag tone={stateTone(b.state)} className="text-[10px]">
                      {b.state}
                    </Tag>
                  )}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn btn-secondary btn-block">
            <Plus size={15} strokeWidth={2.75} aria-hidden />
            Tambah blok
          </button>
        </Panel>

        <Panel className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-meta text-muted-55">Pratinjau</span>
            <div className="seg ml-auto">
              {VIEWPORTS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="seg-opt"
                  aria-pressed={viewport === v}
                  onClick={() => setViewport(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div
            className="mx-auto overflow-hidden rounded-[22px] border border-divider bg-bg transition-[width]"
            style={{ width: previewWidth }}
          >
            <div className="flex items-center gap-3 border-b border-divider px-4.4 py-3.5">
              <Logo height={18} />
              <span className="ml-auto text-[10.5px] text-muted-45">
                Our Story · Catalog · Process · Terms
              </span>
            </div>

            <div className="m-2.5 rounded-[20px] border-2 border-dashed border-accent-300 px-5 py-6">
              <div className="mb-2 text-[9.5px] uppercase tracking-[.16em] text-accent-700">
                Blok terpilih · {shortName(block.name)}
              </div>
              <div
                className="font-heading leading-[1.02]"
                style={{ fontSize: block.big ? 44 : 26 }}
              >
                {block.title}
              </div>
              <p className="mt-2.5 max-w-[38ch] text-meta leading-[1.6] text-muted-70">
                {block.body}
              </p>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                <span className="btn btn-primary px-3.5 py-1.5 text-[10.5px]">{block.cta}</span>
                {block.cta2 ? (
                  <span className="btn btn-secondary px-3.5 py-1.5 text-[10.5px]">{block.cta2}</span>
                ) : null}
              </div>
            </div>

            <div className="m-2.5 rounded-[20px] bg-neutral-200 px-5 py-5 opacity-75">
              <div className="text-[9.5px] uppercase tracking-[.14em] text-muted-50">
                Blok · {shortName(nextBlock.name)}
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <div className="h-[52px] rounded-sm bg-surface" />
                <div className="h-[52px] rounded-sm bg-surface" />
                <div className="h-[52px] rounded-sm bg-surface" />
              </div>
            </div>
          </div>
        </Panel>

        <div className="flex flex-col gap-4 2xl:col-span-2 2xl:flex-row 2xl:flex-wrap 3xl:col-span-1 3xl:flex-col">
          <Panel className="p-5 2xl:flex-1 2xl:basis-[260px]">
            <h4 className="mb-3">Blok: {shortName(block.name)}</h4>
            <Field label="Judul" className="mb-2.5">
              <input
                className="input"
                type="text"
                value={block.title}
                onChange={(e) => edit("title")(e.target.value)}
              />
            </Field>
            <Field label="Label CTA" className="mb-2.5">
              <input
                className="input"
                type="text"
                value={block.cta}
                onChange={(e) => edit("cta")(e.target.value)}
              />
            </Field>
            <Field label="Tautan CTA" className="mb-3">
              <input
                className="input"
                type="text"
                value={block.link}
                onChange={(e) => edit("link")(e.target.value)}
              />
            </Field>
            <div className="mb-1.5 text-[12px] text-muted-70">Tata letak</div>
            <div className="seg">
              {["Kiri", "Tengah", "Bleed"].map((o, i) => (
                <button key={o} type="button" className="seg-opt" aria-pressed={i === 0}>
                  {o}
                </button>
              ))}
            </div>
          </Panel>

          <Panel className="p-5 2xl:flex-1 2xl:basis-[260px]">
            <h4 className="mb-3">Gambar blok</h4>
            <div className="overflow-hidden rounded-[18px]" style={{ aspectRatio: "4 / 3" }}>
              <ImageSlot label={block.img} compact />
            </div>
            <button type="button" className="btn btn-secondary btn-block">
              Pilih dari Media
            </button>
          </Panel>
        </div>
      </div>
    </AdminScreen>
  );
}
