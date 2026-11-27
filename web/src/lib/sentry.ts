import type { BrowserOptions } from "@sentry/nextjs";

// Options shared by the browser, Node.js and edge Sentry SDKs (docs/spec/backend.md#observability).
//
// - Off unless NEXT_PUBLIC_SENTRY_DSN was set at build time (no DSN → the SDK sends nothing).
// - release: the product version from version.txt, the same name the Rails API reports.
// - environment: staging/production, derived from VERCEL_ENV in next.config.ts.
// - Tracing and Session Replay stay off (no tracesSampleRate, no replay integration) to save
//   free-plan quota.
// - No personal data (AGENTS.md hard constraints): no user, IP, cookies, headers, bodies or
//   query strings.
export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  environment: process.env.NEXT_PUBLIC_APP_ENV,
  initialScope: { tags: { git_sha: process.env.NEXT_PUBLIC_GIT_SHA } },
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
  },
} satisfies BrowserOptions;
