"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductCard } from "@/components/site/ProductCard";
import { MATERIALS, PRODUCT_CATEGORIES } from "@/lib/data";
import type { Product } from "@/lib/types";

const PAGE_STEP = 4;
const INITIAL_SHOWN = 8;

/**
 * Catalogue filtering. Category is single-select, material is multi-select, and
 * the two apply together (AND). Changing either filter resets the visible count
 * so the user never lands mid-way through a list they have not seen the top of.
 */
export function CatalogBrowser({ products }: { products: Product[] }) {
  const [category, setCategory] = useState<string>("Semua");
  const [materials, setMaterials] = useState<string[]>([]);
  const [shown, setShown] = useState(INITIAL_SHOWN);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (category !== "Semua" && p.category !== category) return false;
        if (materials.length && !materials.includes(p.material)) return false;
        return true;
      }),
    [products, category, materials],
  );

  const view = filtered.slice(0, shown);
  const hasFilters = category !== "Semua" || materials.length > 0;

  const pickCategory = (c: string) => {
    setCategory(c);
    setShown(INITIAL_SHOWN);
  };

  const toggleMaterial = (m: string) => {
    setMaterials((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
    setShown(INITIAL_SHOWN);
  };

  const countFor = (c: string) =>
    c === "Semua" ? products.length : products.filter((p) => p.category === c).length;

  return (
    <>
      <div className="mt-7 flex flex-wrap gap-2.5">
        {PRODUCT_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="lp-chip"
            aria-pressed={category === c}
            onClick={() => pickCategory(c)}
          >
            {c} ({countFor(c)})
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        {MATERIALS.map((m) => (
          <button
            key={m}
            type="button"
            className="lp-chip lp-chip-mat"
            aria-pressed={materials.includes(m)}
            onClick={() => toggleMaterial(m)}
          >
            {m.toLowerCase()}
          </button>
        ))}
      </div>

      <div className="mt-10 grid gap-[22px] md:grid-cols-2 xl:grid-cols-4">
        {view.map((p) => (
          <ProductCard key={p.slug} product={p} variant="catalog" />
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-5">
        <span className="text-[13px] text-muted-55">
          {filtered.length === 0
            ? "Tidak ada produk yang cocok dengan filter ini"
            : `Menampilkan ${view.length} dari ${filtered.length} produk`}
        </span>
        <div className="flex flex-wrap gap-2.5">
          {view.length < filtered.length ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShown((s) => s + PAGE_STEP)}
            >
              Muat {PAGE_STEP} lagi
            </button>
          ) : null}
          {hasFilters ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setCategory("Semua");
                setMaterials([]);
                setShown(INITIAL_SHOWN);
              }}
            >
              Hapus filter
            </button>
          ) : null}
          <Link href="/kontak" className="btn btn-primary">
            Minta penawaran
          </Link>
        </div>
      </div>
    </>
  );
}
