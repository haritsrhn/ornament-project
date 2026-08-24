import { cn } from "@/lib/cn";
import type { TagTone } from "@/lib/types";

const TONE: Record<TagTone, string> = {
  accent: "tag-accent",
  "accent-2": "tag-accent-2",
  neutral: "tag-neutral",
  outline: "tag-outline",
};

export function Tag({
  tone = "neutral",
  className,
  style,
  children,
}: {
  tone?: TagTone;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("tag", TONE[tone], className)} style={style}>
      {children}
    </span>
  );
}
