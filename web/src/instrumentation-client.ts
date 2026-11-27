// Browser Sentry SDK, loaded before the app becomes interactive. It reports uncaught errors and
// unhandled rejections. Navigation tracing (onRouterTransitionStart) is left out: tracing is off.
import * as Sentry from "@sentry/nextjs";

import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions);
