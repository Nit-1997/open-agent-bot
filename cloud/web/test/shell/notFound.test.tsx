import { parseRoute } from "@oab/shared/routes";
import { describe, expect, it, vi } from "vitest";
import MissingPage from "@/app/(app)/[...missing]/page";
import ShellNotFound from "@/app/(app)/not-found";
import { renderWithPlatform } from "../support/platform";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

describe("removed Plans section", () => {
  it("falls through to the shell's not-found page", () => {
    expect(parseRoute("/plans")).toBeNull();
    expect(parseRoute("/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/trip/dDE")).toBeNull();
    expect(() => MissingPage()).toThrow("notFound");
    renderWithPlatform(<ShellNotFound />);
    expect(document.getElementById("shell-not-found-title")).toHaveTextContent("This page doesn't exist.");
  });
});
