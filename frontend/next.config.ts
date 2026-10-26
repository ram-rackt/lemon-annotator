import type { NextConfig } from "next";

// Local: the browser talks only to Next.js; /api/* is proxied to FastAPI, so no CORS setup is needed.
// Hosted: NEXT_PUBLIC_API_URL is set and the browser calls the API directly, so nothing is proxied.
const backendUrl = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const apiIsRemote = Boolean(process.env.NEXT_PUBLIC_API_URL);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The floating dev badge overlaps the queue / save buttons.
  devIndicators: false,
  experimental: {
    // Listing very large buckets can take a while.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return apiIsRemote ? [] : [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
