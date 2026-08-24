import Link from "next/link";
import { MapPin } from "lucide-react";
import { ImageSlot } from "@/components/ui/ImageSlot";
import { Tag } from "@/components/ui/Tag";
import type { Product } from "@/lib/types";

/**
 * Product card. `variant` matches the two densities in the design: "preview"
 * for the 4:3 home-page grid, "catalog" for the square catalogue grid that also
 * shows MOQ.
 */
export function ProductCard({
  product,
  variant = "preview",
}: {
  product: Product;
  variant?: "preview" | "catalog";
}) {
  const square = variant === "catalog";

  return (
    <Link
      href={`/produk/${product.slug}`}
      className="card card-lift gap-0 p-3 text-ink"
      style={{ background: square ? "var(--color-surface)" : "var(--color-bg)" }}
    >
      <div
        className="overflow-hidden rounded-[20px]"
        style={{ aspectRatio: square ? "1" : "4 / 3" }}
      >
        <ImageSlot label={product.name} />
      </div>
      <div className="px-2 pb-1 pt-3.5">
        <h4 className="mb-2 text-[17px] leading-[1.25] xl:text-[19px]">{product.name}</h4>
        {square ? (
          <div className="text-[12px] text-muted-60">{product.origin}</div>
        ) : (
          <div className="flex items-center gap-2 text-admin-sm text-muted-60">
            <MapPin size={14} strokeWidth={2.75} aria-hidden />
            {product.origin}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Tag tone="accent-2">{product.material}</Tag>
          {square ? (
            <span className="text-meta text-muted-55">MOQ {product.moq}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
