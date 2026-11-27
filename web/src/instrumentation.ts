// Server-side Sentry SDK (Node.js and edge runtimes on Vercel).
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/sentry";

export function register() {
  Sentry.init(sentryOptions);
}

// Errors from Server Components, route handlers and the proxy.
export const onRequestError = Sentry.captureRequestError;
