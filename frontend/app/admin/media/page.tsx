"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { AdminScreen, PageHeading } from "@/components/admin/PageHeading";
import { useToast } from "@/components/admin/ToastProvider";

const STEP = 12;
const MAX_SHOWN = 36;
const BASE_TOTAL = 612;

export default function MediaLibraryPage() {
  const toast = useToast();
  const [shown, setShown] = useState(STEP);
  const [extra, setExtra] = useState(0);

  const total = BASE_TOTAL + extra;
  const storage = (1.8 + extra * 0.1).toFixed(1);

  const upload = () => {
    setExtra((e) => e + 1);
    setShown((s) => s + 1);
    toast("1 file diunggah ke Media Library.");
  };

  return (
    <AdminScreen>
      <PageHeading
        kicker="Aset"
        title="Media Library"
        actions={
          <>
            <select className="input w-auto" aria-label="Filter tipe" defaultValue="Semua tipe">
              {["Semua tipe", "Gambar", "Dokumen"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <select className="input w-auto" aria-label="Filter tanggal" defaultValue="Semua tanggal">
              {["Semua tanggal", "Agustus 2026", "Juli 2026"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <button type="button" className="btn btn-primary px-5 py-2.5" onClick={upload}>
              Unggah file
            </button>
          </>
        }
      />

      <Panel className="px-6 py-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {Array.from({ length: shown }, (_, i) => (
            <button
              key={i}
              type="button"
              className="overflow-hidden rounded-[18px] bg-surface hover:outline hover:outline-2 hover:outline-offset-2 hover:outline-accent"
              style={{ aspectRatio: "1" }}
              aria-label={`Berkas media ${i + 1}`}
            >
              <ImageSlot label="" compact />
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span className="text-admin-sm text-muted-55">
            Menampilkan {shown} dari {total} file · {storage} GB terpakai
          </span>
          {shown < MAX_SHOWN ? (
            <button type="button" className="btn btn-secondary" onClick={() => setShown((s) => s + STEP)}>
              Muat lebih banyak
            </button>
          ) : null}
        </div>
      </Panel>
    </AdminScreen>
  );
}
