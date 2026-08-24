import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Photo placeholder.
 *
 * The handoff ships no photography — every `<image-slot>` in the prototype is a
 * hole with a note about what belongs there. This keeps that contract visible:
 * correct aspect ratio, correct radius, and the brief printed inside, so the
 * layout is final before the client's photos arrive. Swap for next/image once
 * real assets land.
 */
export function ImageSlot({
  label,
  className,
  shape = "rect",
  compact = false,
}: {
  label: string;
  className?: string;
  shape?: "rect" | "circle";
  compact?: boolean;
}) {
  return (
    <div
      role="img"
      aria-label={label ? `Placeholder foto: ${label}` : "Placeholder foto"}
      className={cn(
        "washed grid h-full w-full place-items-center overflow-hidden bg-surface",
        shape === "circle" && "rounded-pill",
        className,
      )}
    >
      <span className="flex flex-col items-center gap-2 px-4 text-center opacity-40">
        <ImageIcon size={compact ? 20 : 24} strokeWidth={2.75} aria-hidden />
        {!compact && label.trim() ? (
          <span className="max-w-[22ch] text-[11px] leading-snug">{label}</span>
        ) : null}
      </span>
    </div>
  );
}
