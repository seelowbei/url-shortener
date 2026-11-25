import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiStatus } from "./api-status";

describe("ApiStatus", () => {
  it("shows the API version from /api/health", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ status: "ok", version: "0.0.0", sha: "abc1234" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiStatus />);

    expect(screen.getByText("Checking the API…")).toBeInTheDocument();
    expect(await screen.findByText("0.0.0")).toBeInTheDocument();
    expect(screen.getByText("(abc1234)")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows an error when the API is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ status: "error" }, { status: 503 })),
    );

    render(<ApiStatus />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "API unreachable",
    );
  });
});
