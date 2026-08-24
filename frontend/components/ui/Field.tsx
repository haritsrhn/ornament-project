import { cn } from "@/lib/cn";

/** Label + control pair. Matches `.field > label` from the design system. */
export function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("field block", className)}>
      <span className="block text-[12px] mb-[5px] text-muted-70">{label}</span>
      {children}
    </label>
  );
}
