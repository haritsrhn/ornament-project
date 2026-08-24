import { cn } from "@/lib/cn";

/** The admin content panel: page-coloured card on the neutral-200 workspace. */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("ad-panel", className)}>{children}</div>;
}
