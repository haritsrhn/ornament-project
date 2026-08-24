"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Field } from "@/components/ui/Field";
import { BASE_COMMENTS } from "@/lib/data";
import type { Comment } from "@/lib/types";

const HELP = "Komentar ditinjau admin sebelum tayang.";

/**
 * Article discussion. Front-end state only — a real submit would POST and land
 * in the admin Comments moderation queue. Name and comment are required; on
 * success the new comment is prepended, flagged as awaiting moderation.
 */
export function CommentSection() {
  const [comments, setComments] = useState<Comment[]>(BASE_COMMENTS);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState(HELP);
  const [error, setError] = useState(false);

  const submit = () => {
    if (!name.trim() || !text.trim()) {
      setError(true);
      setNote("Nama dan komentar wajib diisi.");
      return;
    }
    setComments((prev) => [
      {
        initial: name.trim()[0].toUpperCase(),
        name: name.trim(),
        when: "baru saja · menunggu moderasi",
        text: text.trim(),
      },
      ...prev,
    ]);
    setName("");
    setEmail("");
    setText("");
    setError(false);
    setNote("Komentar terkirim dan menunggu peninjauan admin.");
  };

  return (
    <div className="mt-12 max-w-[64ch]">
      <h3 className="mb-5">Diskusi ({comments.length})</h3>

      {comments.map((c, i) => (
        <div key={`${c.name}-${i}`} className="flex gap-3.5 border-t border-divider py-4">
          <Avatar initial={c.initial} size={38} />
          <div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <strong className="text-[14px]">{c.name}</strong>
              <span className="text-meta text-muted-50">{c.when}</span>
            </div>
            <p className="mt-1.5 text-[14px] leading-[1.7]">{c.text}</p>
          </div>
        </div>
      ))}

      <div className="mt-6.6 rounded-lg bg-surface p-6">
        <h4 className="mb-3.5">Tinggalkan komentar</h4>
        <div className="mb-3.5 grid gap-4 md:grid-cols-2">
          <Field label="Nama">
            <input
              className="input"
              type="text"
              placeholder="Nama Anda"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              placeholder="nama@perusahaan.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Komentar">
          <textarea
            className="input"
            placeholder="Tulis komentar…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <p
          className="mt-2.5 text-[12px]"
          style={{ color: error ? "var(--color-accent-700)" : "color-mix(in srgb,var(--color-text) 55%,transparent)" }}
          role={error ? "alert" : undefined}
        >
          {note}
        </p>
        <button type="button" className="btn btn-primary mt-3" onClick={submit}>
          Kirim komentar
        </button>
      </div>
    </div>
  );
}
