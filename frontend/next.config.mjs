/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Paket workspace berisi skema Zod & tipe kontrak API (ADR K6); dikompilasi ulang oleh Next.
  transpilePackages: ['@ornament/shared'],
};

export default nextConfig;
