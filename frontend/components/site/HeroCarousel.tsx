"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { cn } from "@/lib/cn";

const SLIDES = [
  "Foto hero 1 — produk unggulan",
  "Foto hero 2 — proses pengerjaan",
  "Foto hero 3 — pengrajin",
];

export function HeroCarousel() {
  const [slide, setSlide] = useState(0);
  const step = (delta: number) =>
    setSlide((s) => (s + delta + SLIDES.length) % SLIDES.length);

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-xl bg-surface"
        style={{ aspectRatio: "4 / 3.4" }}
      >
        {SLIDES.map((label, i) => (
          <div
            key={label}
            className={cn("absolute inset-0", i === slide ? "block" : "hidden")}
            aria-hidden={i !== slide}
          >
            <ImageSlot label={label} />
          </div>
        ))}
        <div className="absolute bottom-[18px] left-[18px] flex gap-[7px]">
          {SLIDES.map((label, i) => (
            <span
              key={label}
              className="h-2 w-2 rounded-pill"
              style={{
                background:
                  i === slide
                    ? "var(--color-accent)"
                    : "color-mix(in srgb,#f5ead8 65%,transparent)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        {SLIDES.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={i === slide}
            aria-label={`Slide ${i + 1}: ${label}`}
            onClick={() => setSlide(i)}
            className={cn(
              "grid h-[66px] w-[88px] place-items-center rounded-[18px] bg-surface font-heading text-[15px]",
              i === slide
                ? "text-accent-700 outline outline-2 outline-offset-[3px] outline-accent"
                : "text-muted-45",
            )}
          >
            {String(i + 1).padStart(2, "0")}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            aria-label="Sebelumnya"
            onClick={() => step(-1)}
          >
            <ChevronLeft size={17} strokeWidth={2.75} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            aria-label="Berikutnya"
            onClick={() => step(1)}
          >
            <ChevronRight size={17} strokeWidth={2.75} />
          </button>
        </div>
      </div>
    </div>
  );
}
