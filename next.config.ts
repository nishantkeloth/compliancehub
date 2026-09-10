import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the Turbopack project root to this folder. Without this, Turbopack
  // auto-detects the root by scanning upward for lockfiles and picks up the
  // stray package-lock.json/node_modules sitting in the Windows user profile
  // folder (C:\Users\Nishant), which breaks module/CSS resolution and the
  // dev-server manifest. See: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
  turbopack: {
    root: path.join(__dirname),
  },
  // Without this, the client-side router cache treats every dynamic
  // (server-rendered) segment as stale immediately, so it's re-fetched
  // from the server on every navigation -- even a shared layout like
  // app/crew/layout.tsx, which otherwise wouldn't need to re-run at all
  // when moving between two pages under the same layout. 30s means
  // re-visiting a page (or the crew/team layout) within 30 seconds of
  // last loading it reuses what's already been fetched instead of
  // re-querying Supabase for it.
  experimental: {
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
