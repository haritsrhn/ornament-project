import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import { CommentSection } from "@/components/site/CommentSection";
import { Shell } from "@/components/site/Section";
import { ARTICLES } from "@/lib/data";

export function generateStaticParams() {
  return ARTICLES.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const article = ARTICLES.find((a) => a.slug === params.slug);
  return { title: article?.title ?? "Artikel" };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const article = ARTICLES.find((a) => a.slug === params.slug);
  if (!article) notFound();

  const others = ARTICLES.filter((a) => a.slug !== article.slug).slice(0, 3);

  return (
    <Shell className="pb-20 pt-10">
      <Link href="/journal" className="btn btn-secondary mb-6.6">
        ← Journal
      </Link>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start xl:gap-12">
        <article>
          <div className="text-meta uppercase tracking-[.1em] text-accent-700">
            {article.category} · {article.date}
          </div>
          <h1 className="mb-5 mt-3.5 max-w-[24ch] text-[clamp(34px,4vw,54px)] leading-none">
            {article.title}
          </h1>
          <div className="overflow-hidden rounded-lg" style={{ aspectRatio: "16 / 9" }}>
            <ImageSlot label={`Foto artikel — ${article.title}`} />
          </div>

          <div className="mt-7 max-w-[64ch] space-y-3.3 text-[16.5px] leading-[1.8] text-muted-85">
            {article.paragraphs.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>

          <div className="mt-6.6 flex flex-wrap gap-2">
            {article.tags.map((t) => (
              <Tag key={t} tone="accent-2">
                {t}
              </Tag>
            ))}
          </div>

          <CommentSection />
        </article>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-24">
          <div className="card p-5">
            <div className="card-kicker">Penulis</div>
            <div className="mt-2.5 flex items-center gap-3">
              <Avatar initial={article.author[0]} size={42} />
              <div>
                <div className="text-[14px]">{article.author}</div>
                <div className="text-meta text-muted-55">Tim Ornament</div>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <div className="card-kicker">Artikel lain</div>
            <div className="mt-2.5 flex flex-col gap-3">
              {others.map((o) => (
                <Link
                  key={o.slug}
                  href={`/journal/${o.slug}`}
                  className="text-admin leading-[1.5] text-ink hover:text-accent"
                >
                  {o.title}
                </Link>
              ))}
            </div>
          </div>

          <div className="card bg-sage-900 p-[22px] text-neutral-200">
            <div className="font-heading text-[19px] leading-[1.2]">Punya proyek serupa?</div>
            <p className="mt-2.5 text-[13px] leading-[1.7] opacity-80">
              Kirim brief Anda, kami balas dengan penawaran dan lead time.
            </p>
            <Link href="/kontak" className="btn btn-primary btn-block">
              Consult Your Project
            </Link>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
