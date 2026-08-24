"use client";

import Link from "next/link";
import { Bell, Plus, Search } from "lucide-react";
import { useAdminSearch } from "@/components/admin/AdminSearchContext";

/**
 * Sticky content header. The query is held in shared context so the screen
 * below can filter on it; wiring it to a real index is a later phase.
 */
export function AdminHeader() {
  const { query, setQuery } = useAdminSearch();

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-divider bg-bg px-5 py-4 lg:px-[30px]">
      <div className="relative min-w-[200px] flex-1 lg:max-w-[400px]">
        <Search
          size={16}
          strokeWidth={2.75}
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-45"
        />
        <input
          className="input pl-10"
          type="search"
          placeholder="Cari produk, artikel, pengrajin…"
          aria-label="Cari"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-icon relative ml-auto"
        aria-label="Notifikasi"
      >
        <Bell size={18} strokeWidth={2.75} />
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-pill border-[1.5px] border-bg bg-accent" />
      </button>

      <Link href="/admin/products/new" className="btn btn-primary px-5 py-2.5">
        <Plus size={16} strokeWidth={2.75} aria-hidden />
        Add New Product
      </Link>
    </header>
  );
}
