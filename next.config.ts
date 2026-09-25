import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Note: `output: "standalone"` intentionally removed — it breaks Vercel's
  // node file tracing on Next.js 16 (ENOENT .next/next-server.js.nft.json).
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The "Vulnerable demo repo" button stages this fixture at runtime (an fs
  // copy, invisible to static tracing) — ship it explicitly with /api/scan.
  outputFileTracingIncludes: {
    "/api/scan": ["./tests/fixtures/sample-ai-repo/**"],
  },
};

export default nextConfig;
