import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/page";
import { RUNS } from "@/components/landing/LiveRun";
import { expectUniqueIds } from "../../packages/ui/test/support/ids.ts";

describe("landing page", () => {
  it("gives every element a unique id", () => {
    const { container } = render(<LandingPage />);
    expectUniqueIds(container);
  });

  it("sends the beta buttons to request access and the nav button to sign in", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("#landing-hero-cta")?.getAttribute("href")).toBe("/request-access");
    expect(container.querySelector("#landing-cta-button")?.getAttribute("href")).toBe("/request-access");
    expect(container.querySelector("#landing-nav-signin")?.getAttribute("href")).toBe("/login");
    expect(container.querySelector("#landing-nav a[href='/request-access']")).toBeNull();
  });

  it("starts on the finished first run so the demo reads without animation", () => {
    render(<LandingPage />);
    expect(screen.getByText(RUNS[0].question)).toBeTruthy();
    for (const step of RUNS[0].steps) expect(screen.getByText(step)).toBeTruthy();
    expect(screen.getByAltText(`Report preview: ${RUNS[0].report.title}`)).toBeTruthy();
  });
});
