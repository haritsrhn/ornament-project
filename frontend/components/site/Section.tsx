import { cn } from "@/lib/cn";

/** Content column: 1240px max, 40px gutters at desktop, tighter on mobile. */
export function Shell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-shell px-5 lg:px-10", className)}>{children}</div>;
}

/** A landing section band. `tone="alt"` is the neutral-200 alternating ground. */
export function Section({
  id,
  tone = "base",
  className,
  children,
}: {
  id?: string;
  tone?: "base" | "alt";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-14 xl:py-20",
        tone === "alt" ? "bg-neutral-200" : "bg-bg",
        className,
      )}
    >
      <Shell>{children}</Shell>
    </section>
  );
}

/** The 11px uppercase eyebrow that opens nearly every section. */
export function Kicker({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h6 className={cn("mb-3.5 text-accent-700", className)}>{children}</h6>
  );
}

/** Section heading with an optional right-hand support paragraph or action. */
export function SectionHead({
  kicker,
  title,
  aside,
}: {
  kicker: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-9 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between xl:gap-10">
      <div>
        <Kicker>{kicker}</Kicker>
        <h2 className="text-[32px] leading-[1.05] xl:text-[40px]">{title}</h2>
      </div>
      {aside}
    </div>
  );
}
