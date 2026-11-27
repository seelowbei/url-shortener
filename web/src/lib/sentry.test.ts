import { afterEach, describe, expect, it, vi } from "vitest";

async function loadOptions() {
  vi.resetModules();
  return (await import("./sentry")).sentryOptions;
}

describe("sentryOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tags events with the version, environment and commit inlined at build time", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "0.2.0");
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_GIT_SHA", "abc123");

    const options = await loadOptions();

    expect(options).toMatchObject({
      dsn: "https://key@o1.ingest.sentry.io/1",
      release: "0.2.0",
      environment: "production",
      initialScope: { tags: { git_sha: "abc123" } },
    });
  });

  it("is off without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");

    expect((await loadOptions()).dsn).toBeUndefined();
  });

  it("collects no personal data and has tracing off", async () => {
    const options = await loadOptions();

    expect(options.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
    });
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("integrations");
  });
});
