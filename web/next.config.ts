import type { NextConfig } from "next";

// Rails API origin. Server-side only: the browser always calls same-origin /api/*,
// so the session cookie stays first-party and no CORS setup is needed.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
