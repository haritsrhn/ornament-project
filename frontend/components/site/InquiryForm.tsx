"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Upload } from "lucide-react";
import { Field } from "@/components/ui/Field";

const HELP = "Data Anda hanya digunakan untuk keperluan penawaran.";

type FormState = {
  name: string;
  company: string;
  email: string;
  country: string;
  category: string;
  material: string;
  volume: string;
  target: string;
  port: string;
  budget: string;
  note: string;
};

const EMPTY: FormState = {
  name: "",
  company: "",
  email: "",
  country: "",
  category: "Lighting",
  material: "Rotan",
  volume: "",
  target: "",
  port: "",
  budget: "",
  note: "",
};

/**
 * Consult Your Project form.
 *
 * Front-end validation and confirmation only — nothing is sent anywhere yet. In
 * production a successful submit becomes a new row in the admin Inquiries
 * screen. Required: name, a plausible email, and volume.
 */
export function InquiryForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [note, setNote] = useState(HELP);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState<(FormState & { ref: string }) | null>(null);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = () => {
    const missing: string[] = [];
    if (!form.name.trim()) missing.push("Nama lengkap");
    if (!form.email.includes("@")) missing.push("Email");
    if (!form.volume.trim()) missing.push("Volume");

    if (missing.length) {
      setError(true);
      setNote(`Mohon lengkapi: ${missing.join(", ")}.`);
      return;
    }

    setError(false);
    setSent({ ...form, ref: `INQ-${1000 + Math.floor(Math.random() * 9000)}` });
  };

  if (sent) {
    return (
      <div className="card flex-col gap-4 px-8 py-8">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-pill bg-sage-200 text-sage-800">
          <Check size={26} strokeWidth={2.75} aria-hidden />
        </span>
        <h3 className="m-0">Permintaan terkirim.</h3>
        <p className="m-0 max-w-[44ch] text-[15px] leading-[1.75] text-muted-78">
          Terima kasih, {sent.name}. Permintaan Anda masuk ke daftar inquiry kami dengan nomor{" "}
          {sent.ref} — kami balas dalam 1 × 24 jam kerja ke {sent.email}.
        </p>
        <dl className="flex flex-col gap-2.5 rounded-[24px] bg-bg px-5 py-4.4 text-admin">
          {[
            ["Volume", sent.volume],
            ["Target kirim", sent.target || "—"],
            ["Pelabuhan tujuan", sent.port || "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="opacity-60">{k}</dt>
              <dd className="m-0 font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSent(null);
              setForm(EMPTY);
              setNote(HELP);
            }}
          >
            Kirim permintaan lain
          </button>
          <Link href="/catalog" className="btn btn-primary">
            Kembali ke katalog
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card px-6 py-7 sm:px-8">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nama lengkap">
          <input
            className="input"
            type="text"
            placeholder="Nama Anda"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
          />
        </Field>
        <Field label="Perusahaan / brand">
          <input
            className="input"
            type="text"
            placeholder="Nama perusahaan"
            value={form.company}
            onChange={(e) => set("company")(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            placeholder="nama@perusahaan.com"
            value={form.email}
            onChange={(e) => set("email")(e.target.value)}
          />
        </Field>
        <Field label="Negara tujuan">
          <input
            className="input"
            type="text"
            placeholder="mis. Swedia"
            value={form.country}
            onChange={(e) => set("country")(e.target.value)}
          />
        </Field>
        <Field label="Kategori produk">
          <select
            className="input"
            value={form.category}
            onChange={(e) => set("category")(e.target.value)}
          >
            {["Lighting", "Furniture", "Home Decor", "Storage & Basketry", "Belum menentukan"].map(
              (o) => (
                <option key={o}>{o}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Material utama">
          <select
            className="input"
            value={form.material}
            onChange={(e) => set("material")(e.target.value)}
          >
            {["Rotan", "Jati reclaimed", "Bambu petung", "Water hyacinth", "Kayu suar", "Terbuka untuk saran"].map(
              (o) => (
                <option key={o}>{o}</option>
              ),
            )}
          </select>
        </Field>
        <Field label="Volume (pcs)">
          <input
            className="input"
            type="text"
            placeholder="mis. 400"
            value={form.volume}
            onChange={(e) => set("volume")(e.target.value)}
          />
        </Field>
        <Field label="Target pengiriman">
          <input
            className="input"
            type="text"
            placeholder="mis. Nov 2026"
            value={form.target}
            onChange={(e) => set("target")(e.target.value)}
          />
        </Field>
        <Field label="Pelabuhan tujuan">
          <input
            className="input"
            type="text"
            placeholder="mis. Göteborg"
            value={form.port}
            onChange={(e) => set("port")(e.target.value)}
          />
        </Field>
        <Field label="Anggaran per unit (USD)">
          <input
            className="input"
            type="text"
            placeholder="opsional"
            value={form.budget}
            onChange={(e) => set("budget")(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Detail proyek" className="mt-4">
        <textarea
          className="input min-h-[120px] rounded-[24px]"
          placeholder="Ceritakan spesifikasi, finishing, atau referensi desain Anda…"
          value={form.note}
          onChange={(e) => set("note")(e.target.value)}
        />
      </Field>

      <div className="mt-4 flex items-center gap-3 rounded-[24px] border border-dashed border-neutral-400 px-4.4 py-3.5 text-[13px] text-muted-65">
        <Upload size={18} strokeWidth={2.75} aria-hidden />
        Lampirkan gambar teknis atau foto referensi (PDF, JPG, maks 10 MB)
      </div>

      <div className="mt-4.4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary px-6 py-3 text-[15px]" onClick={submit}>
          Kirim permintaan
        </button>
        <span
          className="text-[12px]"
          style={{ color: error ? "var(--color-accent-700)" : "color-mix(in srgb,var(--color-text) 55%,transparent)" }}
          role={error ? "alert" : undefined}
        >
          {note}
        </span>
      </div>
    </div>
  );
}
