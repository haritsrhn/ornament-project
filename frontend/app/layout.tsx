import type { Metadata } from "next";
import { Caprasimo, Figtree } from "next/font/google";
import "./globals.css";

/* Organic uses exactly two faces: Caprasimo for display, Figtree for everything
   that is read as text. Self-hosted by next/font so there is no render-blocking
   request to Google Fonts. */
const caprasimo = Caprasimo({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-heading",
});

const figtree = Figtree({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: {
    default: "Ornament Sourcing Agent — Good Value",
    template: "%s · Ornament Sourcing Agent",
  },
  description:
    "Agen sourcing kerajinan Indonesia di Bantul, Yogyakarta. Menjembatani pengrajin lokal dengan pembeli global — QC empat titik, garansi 7 hari.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={`${caprasimo.variable} ${figtree.variable}`}>
      <body>{children}</body>
    </html>
  );
}
