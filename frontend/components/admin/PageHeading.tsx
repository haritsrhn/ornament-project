import { cn } from "@/lib/cn";

/** Kicker + title + optional right-hand controls, shared by every admin screen. */
export function PageHeading({
  kicker,
  title,
  actions,
  className,
}: {
  kicker: string;
  title: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4.4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6", className)}>
      <div>
        <div className="text-kicker uppercase text-muted-50">{kicker}</div>
        <h3 className="mt-1.5">{title}</h3>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Screen padding shared by every admin route. */
export function AdminScreen({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pb-10 pt-6.6 lg:px-[30px]">{children}</div>;
}
