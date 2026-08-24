import Link from "next/link";
import { ImageSlot } from "@/components/ui/ImageSlot";
import type { Article } from "@/lib/types";

export function ArticleCard({
  article,
  withExcerpt = false,
  surface = "bg",
}: {
  article: Article;
  withExcerpt?: boolean;
  surface?: "bg" | "surface";
}) {
  return (
    <Link
      href={`/journal/${article.slug}`}
      className="card card-lift gap-0 p-3.5 text-ink"
      style={{ background: surface === "bg" ? "var(--color-bg)" : "var(--color-surface)" }}
    >
      <div className="overflow-hidden rounded-[22px]" style={{ aspectRatio: "16 / 10" }}>
        <ImageSlot label={article.title} />
      </div>
      <div className="px-2.5 pb-1.5 pt-4">
        <div className="text-meta text-muted-55">
          {article.category} · {article.date}
        </div>
        <h4 className="mt-2 text-[18px] leading-[1.25]">{article.title}</h4>
        {withExcerpt ? (
          <p className="mt-2 text-admin leading-[1.7] text-muted-72">{article.excerpt}</p>
        ) : null}
      </div>
    </Link>
  );
}
