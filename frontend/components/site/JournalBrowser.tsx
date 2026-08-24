"use client";

import { useState } from "react";
import { ArticleCard } from "@/components/site/ArticleCard";
import { ARTICLE_CATEGORIES } from "@/lib/data";
import type { Article } from "@/lib/types";

export function JournalBrowser({ articles }: { articles: Article[] }) {
  const [category, setCategory] = useState<string>("Semua");
  const view =
    category === "Semua" ? articles : articles.filter((a) => a.category === category);

  return (
    <>
      <div className="mt-6.6 flex flex-wrap gap-2.5">
        {ARTICLE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className="lp-chip"
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="mt-10 grid gap-[22px] md:grid-cols-2 xl:grid-cols-3">
        {view.map((a) => (
          <ArticleCard key={a.slug} article={a} withExcerpt surface="surface" />
        ))}
      </div>
    </>
  );
}
