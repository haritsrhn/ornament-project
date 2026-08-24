"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Beranda" },
  { href: "/catalog", label: "Catalog" },
  { href: "/journal", label: "Journal" },
  { href: "/our-story", label: "Our Story" },
];

/** True for the section's own page and anything nested under it. */
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-bg">
      <div className="mx-auto flex max-w-shell items-center gap-4.4 px-5 pb-2.2 pt-4.4 lg:px-10">
        <Link href="/" className="mr-auto flex items-center gap-3.3 text-ink">
          <Logo height={30} />
          <span className="max-w-[9ch] text-[10px] uppercase leading-[1.3] tracking-[.18em] opacity-55">
            Sourcing Agent
          </span>
        </Link>

        <nav className="hidden items-center gap-[30px] lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(pathname, l.href) ? "page" : undefined}
              className={cn(
                "text-[14px] text-ink hover:text-accent",
                isActive(pathname, l.href) && "text-accent",
              )}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/kontak" className="btn btn-primary">
            Consult Your Project
          </Link>
        </nav>

        <button
          type="button"
          className="btn btn-secondary btn-icon lg:hidden"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={18} strokeWidth={2.75} /> : <Menu size={18} strokeWidth={2.75} />}
        </button>
      </div>

      {open ? (
        <div className="mx-auto max-w-shell px-5 pb-2.5 pt-1.5 lg:hidden">
          <div className="flex flex-col rounded-lg bg-surface px-2 py-3.5">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="px-4 py-2.5 text-[14px] text-ink hover:text-accent"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/kontak"
              onClick={() => setOpen(false)}
              className="btn btn-primary mx-2 mt-2"
            >
              Consult Your Project
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
