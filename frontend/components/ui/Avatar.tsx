import { cn } from "@/lib/cn";

/** Initial-letter avatar — the design has no people photography yet. */
export function Avatar({
  initial,
  size = 38,
  tone = "accent",
  className,
}: {
  initial: string;
  size?: number;
  tone?: "accent" | "solid";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-pill font-heading",
        tone === "accent" ? "bg-accent-200 text-accent-800" : "bg-accent text-bg",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37) }}
    >
      {initial}
    </span>
  );
}
