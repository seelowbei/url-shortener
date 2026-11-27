import { readFileSync } from "node:fs";

import { withSentryConfig } from "@sentry/nextjs/config";
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

// The commit, for the git_sha tag on Sentry events. Vercel sets VERCEL_GIT_COMMIT_SHA on every
// deploy, including the CLI deploys from pipeline.yml.
const gitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown";

// Rails API origin. Server-side only: the browser always calls same-origin /api/*,
// so the session cookie stays first-party and no CORS setup is needed.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_ENV: appEnv,
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_SHA: gitSha,
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

// Sentry (docs/spec/backend.md#observability; runtime options in src/lib/sentry.ts). At build time
// it names the release after version.txt, like the Rails API, and uploads source maps when
// SENTRY_AUTH_TOKEN is set (Vercel Production and Preview), then deletes the client maps from the
// deploy. SENTRY_ORG and SENTRY_PROJECT come from the environment too. Without the token (local
// and CI builds) nothing is uploaded. A Sentry outage only logs a warning, never fails the build.
export default withSentryConfig(nextConfig, {
  release: { name: appVersion },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  silent: !process.env.CI && !process.env.VERCEL,
  telemetry: false,
  errorHandler: (error) => {
    console.warn(`Sentry build step failed: ${error.message}`);
  },
});
