import Link from "next/link";
import { Home, Plus } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { COMPANY } from "@/lib/data";

/** The 38px top bar: site identity on the left, session controls on the right. */
export function AdminBar() {
  return (
    <div className="flex h-[38px] items-center gap-5 overflow-x-auto whitespace-nowrap bg-neutral-900 px-4.4 text-[#f5ead8]">
      {/* Situs publik adalah deployment terpisah dari admin (lihat frontend/README.md),
          jadi dua tautan ini memang navigasi penuh, bukan client-side <Link>. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="ad-barlink flex items-center gap-1.5">
        <Home size={14} strokeWidth={2.75} aria-hidden />
        {COMPANY.domain}
      </a>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="ad-barlink">Lihat situs</a>
      <Link href="/admin/products/new" className="ad-barlink flex items-center gap-1.5">
        <Plus size={13} strokeWidth={2.75} aria-hidden />
        Baru
      </Link>
      <a href="#" className="ad-barlink ml-auto">Bantuan</a>
      <Link href="/admin/login" className="ad-barlink">Keluar</Link>
      <span className="ad-barlink flex items-center gap-2">
        Rani Prasetyo
        <Avatar initial="R" size={22} tone="solid" />
      </span>
    </div>
  );
}
