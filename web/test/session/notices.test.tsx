import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessDisabled } from "@/components/session/AccessDisabled";
import { SignedOutBanner } from "@/components/session/SignedOutBanner";
import { expectUniqueIds } from "../support/ids";
import { renderWithPlatform } from "../support/platform";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

describe("session notices", () => {
  it("render unique ids", () => {
    const { container } = renderWithPlatform(
      <>
        <SignedOutBanner />
        <AccessDisabled />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("Your access has been turned off.")).toBeInTheDocument();
  });
});
