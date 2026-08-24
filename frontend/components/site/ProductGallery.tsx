"use client";

import { useState } from "react";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { cn } from "@/lib/cn";

const THUMBS = ["Foto produk utama", "Detail anyaman", "Rangka & sambungan", "Skala ruang"];

export function ProductGallery({ name }: { name: string }) {
  const [active, setActive] = useState(0);

  return (
    <div>
      <div className="overflow-hidden rounded-xl" style={{ aspectRatio: "1" }}>
        <ImageSlot label={`${name} — ${THUMBS[active]}`} />
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-2.5">
        {THUMBS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "overflow-hidden rounded-md bg-surface",
              i === active && "outline outline-2 outline-offset-2 outline-accent",
            )}
            style={{ aspectRatio: "1" }}
          >
            <ImageSlot label="" compact />
          </button>
        ))}
      </div>
    </div>
  );
}
