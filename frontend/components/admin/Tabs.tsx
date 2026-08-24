"use client";

/** The pill tab row above admin tables. Counts are computed by the caller. */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { label: string; count?: number }[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((t) => (
        <button
          key={t.label}
          type="button"
          className="ad-tab"
          aria-pressed={value === t.label}
          onClick={() => onChange(t.label)}
        >
          {t.count === undefined ? t.label : `${t.label} (${t.count})`}
        </button>
      ))}
    </div>
  );
}
