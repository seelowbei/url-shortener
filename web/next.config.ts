import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

// The product version that release-please bumps in the repo-root version.txt, inlined into the
// bundle for the footer. Vercel builds can read it because the project keeps "Include files
// outside the root directory in the Build Step" on (the default). An explicit env var wins.
const appVersion =
  process.env.NEXT_PUBLIC_APP_VERSION ??
  readFileSync(new URL("../version.txt", import.meta.url), "utf8").trim();

// development/staging/production, for the staging banner. Derived from VERCEL_ENV, so nothing is
// configured in Vercel: staging and PR previews are both Preview deploys against the staging API.
// Local builds have no VERCEL_ENV. An explicit env var wins.
const appEnv =
  process.env.NEXT_PUBLIC_APP_ENV ??
  { production: "production", preview: "staging" }[
    process.env.VERCEL_ENV ?? ""
  ] ??
  "development";

// Rails API origin. Server-side only: the browser always calls same-origin /api/*,
// so the session cookie stays first-party and no CORS setup is needed.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_ENV: appEnv,
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
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
