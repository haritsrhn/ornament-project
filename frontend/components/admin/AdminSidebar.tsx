"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  FileText,
  Image as ImageIcon,
  LayoutDashboard,
  MessageCircle,
  MessagesSquare,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";
import { INQUIRIES, PRODUCTS } from "@/lib/data";

type Item = {
  href: string;
  label: string;
  Icon: LucideIcon;
  badge?: React.ReactNode;
  /** Sub-items are always visible, mirroring the prototype's expanded tree. */
  children?: { href: string; label: string }[];
};

const NEW_INQUIRIES = INQUIRIES.filter((i) => i.status === "Baru").length;

const ITEMS: Item[] = [
  { href: "/admin", label: "Dashboard", Icon: LayoutDashboard },
  {
    href: "/admin/products",
    label: "Products",
    Icon: Boxes,
    badge: <span className="ml-auto text-[11px] opacity-70">{PRODUCTS.length}</span>,
    children: [
      { href: "/admin/products", label: "Semua Produk" },
      { href: "/admin/products/new", label: "Tambah Produk" },
      { href: "/admin/taxonomy", label: "Kategori & Material" },
    ],
  },
  {
    href: "/admin/pages",
    label: "Pages",
    Icon: FileText,
    children: [
      { href: "/admin/pages", label: "Semua Halaman" },
      { href: "/admin/pages/builder", label: "Page Builder" },
    ],
  },
  { href: "/admin/artisans", label: "Artisan Database", Icon: UserPlus },
  {
    href: "/admin/articles",
    label: "Articles",
    Icon: FileText,
    children: [
      { href: "/admin/articles", label: "Semua Artikel" },
      { href: "/admin/articles/new", label: "Tulis Artikel" },
      { href: "/admin/taxonomy", label: "Kategori & Tag" },
    ],
  },
  { href: "/admin/media", label: "Media Library", Icon: ImageIcon },
  {
    href: "/admin/comments",
    label: "Comments",
    Icon: MessageCircle,
    badge: <span className="ml-auto text-[11px] opacity-70">3</span>,
  },
  {
    href: "/admin/inquiries",
    label: "Inquiries",
    Icon: MessagesSquare,
    badge: (
      <span className="tag ml-auto bg-accent px-2.5 py-0.5 text-[10.5px] text-[#f5ead8]">
        {NEW_INQUIRIES}
      </span>
    ),
  },
  { href: "/admin/users", label: "Users & Roles", Icon: Users },
  { href: "/admin/settings", label: "Settings", Icon: Settings },
];

/** A group is current when the pathname is inside it, not only exactly on it. */
function groupActive(pathname: string, item: Item) {
  if (item.href === "/admin") return pathname === "/admin";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex min-h-0 flex-col gap-5 bg-sage-900 px-3.5 py-5 lg:sticky lg:top-0 lg:min-h-[calc(100vh-38px)]">
      <div className="flex flex-wrap items-center gap-2.5 px-2">
        <Logo light height={22} />
        <span className="text-[9px] uppercase tracking-[.16em] text-[color-mix(in_srgb,#f5ead8_55%,transparent)]">
          Admin CMS
        </span>
      </div>

      <nav className="flex flex-col gap-[3px]" aria-label="Navigasi admin">
        {ITEMS.map((item) => {
          const { Icon } = item;
          return (
            <div key={item.label} className="flex flex-col gap-[2px]">
              <Link
                href={item.href}
                className="ad-navlink"
                aria-current={groupActive(pathname, item) ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={2.75} />
                {item.label}
                {item.badge}
              </Link>
              {item.children?.map((child) => (
                <Link
                  key={`${item.label}-${child.label}`}
                  href={child.href}
                  className={cn("ad-navlink ad-subnav")}
                  aria-current={pathname === child.href ? "page" : undefined}
                >
                  {child.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto rounded-[24px] bg-[color-mix(in_srgb,#f5ead8_8%,transparent)] p-4">
        <div className="text-[10.5px] uppercase tracking-[.12em] text-[color-mix(in_srgb,#f5ead8_55%,transparent)]">
          QC minggu ini
        </div>
        <div className="mt-1.5 font-heading text-[24px] text-neutral-200">18 / 20</div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-[color-mix(in_srgb,#f5ead8_18%,transparent)]">
          <div className="h-full bg-accent" style={{ width: "90%" }} />
        </div>
      </div>
    </aside>
  );
}
