import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/landing/page";
import { RUNS } from "@/components/landing/LiveRun";
import { expectUniqueIds } from "../../../packages/ui/test/support/ids.ts";

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

  it("keeps every sandbox button on request access", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("#landing-way-sandbox-cta")?.getAttribute("href")).toBe("/request-access");
  });

  it("links the source code and the Mac download in a new tab", () => {
    const { container } = render(<LandingPage />);
    const repo = "https://github.com/Nit-1997/open-agent-bot";
    for (const id of [
      "landing-nav-github",
      "landing-hero-source",
      "landing-way-mac-source",
      "landing-cta-source",
      "landing-footer-github",
    ]) {
      const link = container.querySelector(`#${id}`);
      expect(link?.getAttribute("href")).toBe(repo);
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link?.querySelector("svg")).toBeTruthy();
    }
    expect(container.querySelector("#landing-way-mac-download")?.getAttribute("href")).toBe(`${repo}/releases/latest`);
  });

  it("shows the brand logo in the nav", () => {
    const { container } = render(<LandingPage />);
    const logo = container.querySelector("#landing-nav-logo-image");
    expect(logo?.getAttribute("alt")).toBe("Open Agent");
    expect(logo?.getAttribute("src")).toContain("open-agent-logo-dark.svg");
  });

  it("says the project is open source", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("#landing-hero-label")?.textContent).toBe("Open source · MIT");
    expect(container.textContent).not.toMatch(/private beta|invite only/i);
  });

  it("links Terms and Privacy from the footer", () => {
    const { container } = render(<LandingPage />);
    expect(container.querySelector("#landing-footer-terms")?.getAttribute("href")).toBe("/terms");
    expect(container.querySelector("#landing-footer-privacy")?.getAttribute("href")).toBe("/privacy");
    expect(container.querySelector("#landing-footer-signin")?.getAttribute("href")).toBe("/login");
  });

  it("starts on the finished first run so the demo reads without animation", () => {
    render(<LandingPage />);
    expect(screen.getByText(RUNS[0].question)).toBeTruthy();
    for (const step of RUNS[0].steps) expect(screen.getByText(step)).toBeTruthy();
    expect(screen.getByAltText(`Report preview: ${RUNS[0].report.title}`)).toBeTruthy();
  });
});
