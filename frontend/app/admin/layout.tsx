"use client";

import { usePathname } from "next/navigation";
import { AdminBar } from "@/components/admin/AdminBar";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { ToastProvider } from "@/components/admin/ToastProvider";
import { AdminSearchProvider } from "@/components/admin/AdminSearchContext";

/**
 * Admin CMS shell.
 *
 * Login is the one screen that hides the whole chrome, so it renders bare
 * inside the same layout rather than living in a separate route tree — the
 * toast host still wraps it, because sign-in confirms with a toast too.
 *
 * The sidebar is permanent and sticky from 881px up; below that it stops being
 * sticky and stacks above the content, exactly as in the prototype.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/admin/login";

  if (bare) {
    return (
      <ToastProvider>
        <div className="min-h-screen bg-neutral-200 text-ink">{children}</div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AdminSearchProvider>
        <div className="min-h-screen bg-neutral-200 text-ink">
          <AdminBar />
          <div className="grid items-start lg:grid-cols-[238px_minmax(0,1fr)]">
            <AdminSidebar />
            <main className="flex min-w-0 flex-col">
              <AdminHeader />
              {children}
            </main>
          </div>
        </div>
      </AdminSearchProvider>
    </ToastProvider>
  );
}
