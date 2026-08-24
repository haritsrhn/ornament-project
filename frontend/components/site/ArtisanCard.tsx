import Link from "next/link";
import { Tag } from "@/components/ui/Tag";
import { Avatar } from "@/components/ui/Avatar";
import type { Artisan } from "@/lib/types";

export function ArtisanCard({ artisan }: { artisan: Artisan }) {
  return (
    <Link href={`/pengrajin/${artisan.slug}`} className="card card-lift p-[22px] text-ink">
      <Avatar initial={artisan.initial} size={52} />
      <h4 className="mb-1.5 mt-3.5 text-[19px]">{artisan.name}</h4>
      <div className="text-admin-sm text-muted-60">
        {artisan.place} · {artisan.since}
      </div>
      <p className="mt-3 text-admin leading-[1.7] text-muted-75">{artisan.note}</p>
      <div className="mt-3.5">
        <Tag tone="accent-2">{artisan.craft}</Tag>
      </div>
    </Link>
  );
}
