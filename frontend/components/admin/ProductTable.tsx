"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Pencil, Trash2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { Tabs } from "@/components/admin/Tabs";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { useToast } from "@/components/admin/ToastProvider";
import { useAdminSearch } from "@/components/admin/AdminSearchContext";
import { toneForStatus } from "@/lib/data";
import { cn } from "@/lib/cn";
import type { Product } from "@/lib/types";

const PER_PAGE = 4;
const BULK_ACTIONS = ["Aksi massal", "Tandai In Stock", "Tandai Draft", "Pindahkan ke Trash"];
const MATERIAL_FILTERS = [
  "Semua material",
  "Rotan alami",
  "Jati reclaimed",
  "Bambu petung",
  "Water hyacinth",
  "Kayu suar",
  "Cangkang kelapa",
];
const REGION_FILTERS = ["Semua daerah", "Bantul", "Jepara", "Kulon Progo", "Sleman", "Gianyar"];

/**
 * Product management.
 *
 * Search, status tab, material filter, and region filter all apply together and
 * every one of them resets to page 1 — otherwise a narrowed result set can
 * leave the user stranded on an empty page. Rows live in component state so the
 * table behaves like the real thing; nothing is persisted.
 */
export function ProductTable({ initial }: { initial: Product[] }) {
  const toast = useToast();
  const { query } = useAdminSearch();

  const [rows, setRows] = useState<Product[]>(initial);
  const [status, setStatus] = useState("Semua");
  const [material, setMaterial] = useState(MATERIAL_FILTERS[0]);
  const [region, setRegion] = useState(REGION_FILTERS[0]);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState(BULK_ACTIONS[0]);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkError, setBulkError] = useState(false);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<string | "bulk" | null>(null);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (status === "Published" && r.status === "Draft") return false;
        if (status === "Draft" && r.status !== "Draft") return false;
        if (material !== MATERIAL_FILTERS[0] && r.material !== material) return false;
        if (region !== REGION_FILTERS[0] && !r.origin.includes(region)) return false;
        if (q && !`${r.name} ${r.sku} ${r.material} ${r.origin}`.toLowerCase().includes(q))
          return false;
        return true;
      }),
    [rows, status, material, region, q],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, pageCount);
  const slice = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);
  const allSelected = slice.length > 0 && slice.every((r) => selected.includes(r.sku));

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const toggleRow = (sku: string) =>
    setSelected((prev) => (prev.includes(sku) ? prev.filter((s) => s !== sku) : [...prev, sku]));

  const duplicate = (row: Product) => {
    setRows((prev) => [
      ...prev,
      {
        ...row,
        slug: `${row.slug}-copy`,
        name: `${row.name} (copy)`,
        sku: `${row.sku}-C`,
        status: "Draft",
        stock: "Draf duplikat",
      },
    ]);
    toast("Produk diduplikasi sebagai draf.");
  };

  const applyBulk = () => {
    if (!selected.length) {
      setBulkNote("Pilih dulu produk yang ingin diubah.");
      setBulkError(true);
      return;
    }
    if (bulk === BULK_ACTIONS[0]) {
      setBulkNote("Pilih aksi massal terlebih dahulu.");
      setBulkError(true);
      return;
    }
    if (bulk === "Pindahkan ke Trash") {
      setPending("bulk");
      setBulkNote("");
      setBulkError(false);
      return;
    }

    const target: Product["status"] = bulk === "Tandai Draft" ? "Draft" : "In Stock";
    setRows((prev) =>
      prev.map((r) =>
        selected.includes(r.sku)
          ? { ...r, status: target, stock: target === "Draft" ? "Disimpan sebagai draf" : "Stok diperbarui" }
          : r,
      ),
    );
    toast(`${selected.length} produk ditandai ${target}.`);
    setSelected([]);
    setBulk(BULK_ACTIONS[0]);
    setBulkNote("");
    setBulkError(false);
  };

  const confirmTrash = () => {
    const kill = pending === "bulk" ? selected : [pending as string];
    setRows((prev) => prev.filter((r) => !kill.includes(r.sku)));
    toast(`${kill.length} produk dipindahkan ke Trash.`);
    setPending(null);
    setSelected([]);
  };

  return (
    <>
      <div className="mb-4.4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <div className="text-kicker uppercase text-muted-50">Katalog</div>
          <h3 className="mt-1.5">Semua Produk</h3>
        </div>
        <Tabs
          value={status}
          onChange={resetPage(setStatus)}
          tabs={[
            { label: "Semua", count: rows.length },
            { label: "Published", count: rows.filter((r) => r.status !== "Draft").length },
            { label: "Draft", count: rows.filter((r) => r.status === "Draft").length },
          ]}
        />
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <select
          className="input w-auto"
          aria-label="Aksi massal"
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        >
          {BULK_ACTIONS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary" onClick={applyBulk}>
          Terapkan
        </button>
        <span className="h-[22px] w-px bg-divider" />
        <select
          className="input w-auto"
          aria-label="Filter material"
          value={material}
          onChange={(e) => resetPage(setMaterial)(e.target.value)}
        >
          {MATERIAL_FILTERS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select
          className="input w-auto"
          aria-label="Filter daerah"
          value={region}
          onChange={(e) => resetPage(setRegion)(e.target.value)}
        >
          {REGION_FILTERS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        {bulkNote ? (
          <span
            className="text-admin-sm"
            role={bulkError ? "alert" : undefined}
            style={{ color: bulkError ? "var(--color-accent-700)" : "color-mix(in srgb,var(--color-text) 55%,transparent)" }}
          >
            {bulkNote}
          </span>
        ) : null}
        <span className="ml-auto text-admin-sm text-muted-55">{filtered.length} item</span>
      </div>

      <Panel className="ad-tablewrap px-3.5 py-1.5">
        <table>
          <thead>
            <tr>
              <th className="ad-th w-[34px]">
                <input
                  type="checkbox"
                  aria-label="Pilih semua di halaman ini"
                  className="accent-accent"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : slice.map((r) => r.sku))}
                />
              </th>
              <th className="ad-th w-[66px]">Image</th>
              <th className="ad-th">Product Name</th>
              <th className="ad-th w-[150px]">Material</th>
              <th className="ad-th w-[180px]">Artisan Origin</th>
              <th className="ad-th w-[160px]">Stock / Status</th>
              <th className="ad-th w-[96px] text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.sku} className="ad-row">
                <td className="ad-td">
                  <input
                    type="checkbox"
                    aria-label={`Pilih ${r.name}`}
                    className="accent-accent"
                    checked={selected.includes(r.sku)}
                    onChange={() => toggleRow(r.sku)}
                  />
                </td>
                <td className="ad-td">
                  <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-md bg-surface opacity-40">
                    <ImageIcon size={22} strokeWidth={2.75} aria-hidden />
                  </div>
                </td>
                <td className="ad-td">
                  <div className="font-heading text-[15px]">{r.name}</div>
                  <div className="mt-0.5 text-meta text-muted-50">{r.sku}</div>
                  <div className="ad-acts mt-1.5 flex flex-wrap gap-2.5">
                    <Link href="/admin/products/new">Edit</Link>
                    <button type="button" onClick={() => duplicate(r)} className="text-accent">
                      Duplikat
                    </button>
                    <Link href={`/produk/${r.slug}`}>Lihat</Link>
                    <button type="button" className="del text-accent-700" onClick={() => setPending(r.sku)}>
                      Trash
                    </button>
                  </div>
                </td>
                <td className="ad-td">{r.material}</td>
                <td className="ad-td">{r.origin}</td>
                <td className="ad-td">
                  <Tag tone={toneForStatus(r.status)}>{r.status}</Tag>
                  <div className="mt-1 text-meta text-muted-50">{r.stock}</div>
                </td>
                <td className="ad-td">
                  <div className="flex justify-end gap-1.5">
                    <Link
                      href="/admin/products/new"
                      className="btn btn-secondary btn-icon h-[30px] w-[30px]"
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil size={14} strokeWidth={2.75} />
                    </Link>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon h-[30px] w-[30px] text-accent-700"
                      aria-label={`Hapus ${r.name}`}
                      onClick={() => setPending(r.sku)}
                    >
                      <Trash2 size={14} strokeWidth={2.75} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center justify-between gap-3 px-1.5 py-3.5">
          <div className="text-admin-sm text-muted-55">
            {filtered.length
              ? `Menampilkan ${(current - 1) * PER_PAGE + 1}–${Math.min(current * PER_PAGE, filtered.length)} dari ${filtered.length} produk`
              : "Tidak ada produk yang cocok"}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-secondary btn-icon h-[30px] w-[30px]"
              aria-label="Halaman sebelumnya"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} strokeWidth={2.75} />
            </button>
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Halaman ${i + 1}`}
                aria-current={i + 1 === current ? "page" : undefined}
                className={cn(
                  "btn btn-icon h-[30px] w-[30px] text-[13px]",
                  i + 1 === current ? "btn-primary" : "btn-secondary",
                )}
                onClick={() => setPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-icon h-[30px] w-[30px]"
              aria-label="Halaman berikutnya"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight size={14} strokeWidth={2.75} />
            </button>
          </div>
        </div>
      </Panel>

      <ConfirmDialog
        open={pending !== null}
        title="Pindahkan ke Trash?"
        body={
          pending === "bulk"
            ? `${selected.length} produk terpilih akan dipindahkan ke Trash. Bisa dipulihkan dalam 30 hari.`
            : "Produk ini akan dipindahkan ke Trash dan hilang dari situs publik. Bisa dipulihkan dalam 30 hari."
        }
        confirmLabel="Pindahkan ke Trash"
        onCancel={() => setPending(null)}
        onConfirm={confirmTrash}
      />
    </>
  );
}
