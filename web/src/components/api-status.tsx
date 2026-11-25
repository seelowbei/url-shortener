"use client";

import { useEffect, useState } from "react";

type Health = { status: string; version: string; sha: string };

type State =
  { kind: "loading" } | { kind: "ok"; health: Health } | { kind: "error" };

// Calls the Rails health endpoint through the /api rewrite in next.config.ts.
export function ApiStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/health returned ${res.status}`);
        return res.json() as Promise<Health>;
      })
      .then((health) => setState({ kind: "ok", health }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });

    return () => controller.abort();
  }, []);

  if (state.kind === "loading") {
    return <p className="text-muted-foreground">Checking the API…</p>;
  }

  if (state.kind === "error") {
    return (
      <p role="alert" className="text-destructive">
        API unreachable
      </p>
    );
  }

  return (
    <p>
      API version <span className="font-mono">{state.health.version}</span>{" "}
      <span className="font-mono text-muted-foreground">
        ({state.health.sha})
      </span>
    </p>
  );
}
