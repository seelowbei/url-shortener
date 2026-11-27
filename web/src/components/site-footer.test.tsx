import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows NEXT_PUBLIC_APP_VERSION", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.2.3");

    render(<SiteFooter />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent("v1.2.3");
  });

  it("shows no version when none was set at build time", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", undefined);

    render(<SiteFooter />);

    expect(screen.getByRole("contentinfo")).toBeEmptyDOMElement();
  });
});
