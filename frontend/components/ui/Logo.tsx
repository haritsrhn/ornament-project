import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The Ornmnt wordmark. `light` is the knocked-out version for dark grounds
 * (sidebar, footer, admin bar); the default is for the warm cream ground.
 */
export function Logo({
  light = false,
  height = 30,
  className,
}: {
  light?: boolean;
  height?: number;
  className?: string;
}) {
  return (
    <Image
      src={light ? "/assets/ornmnt-logo-light.png" : "/assets/ornmnt-logo.png"}
      alt="Ornmnt"
      width={height * 4}
      height={height}
      priority
      className={cn("w-auto", className)}
      style={{ height }}
    />
  );
}
