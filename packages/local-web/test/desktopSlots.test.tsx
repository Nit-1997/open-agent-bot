import { resetAuthState } from "@oab/ui/lib/authState.ts";
import { chatIndex } from "@oab/ui/lib/chatIndex.ts";
import { resetProfileStore } from "@oab/ui/lib/profile.ts";
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopSlots } from "../src/desktopSlots.tsx";
import { openAccountMenu } from "./support/accountMenu.tsx";
import { expectUniqueIds } from "./support/ids.ts";
import { localRespond } from "./support/localFetch.ts";

vi.mock("@copilotkit/react-core/v2", async () => (await import("./support/copilot.tsx")).copilotMock());

beforeEach(() => {
  resetProfileStore();
  resetAuthState();
  chatIndex.reset();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => localRespond(url)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "openAgentDesktop");
  window.history.replaceState(null, "", "/");
});

describe("desktopSlots", () => {
  it("no bridge, or a bridge without openServices → no slots", () => {
    expect(desktopSlots(undefined)).toEqual({});
    expect(desktopSlots({})).toEqual({});
    expect(desktopSlots({ openServices: "nope" })).toEqual({});
    expect(desktopSlots(null)).toEqual({});
  });

  it("a bridge → an accountMenuExtra item", () => {
    expect(Object.keys(desktopSlots({ openServices: () => {} }))).toEqual(["accountMenuExtra"]);
  });
});

describe("the account menu with the desktop bridge", { timeout: 20000 }, () => {
  it("shows Services & data with unique ids, and a click calls openServices once and closes the menu", async () => {
    const openServices = vi.fn();
    Object.defineProperty(window, "openAgentDesktop", { value: Object.freeze({ openServices }), configurable: true });
    const items = await openAccountMenu();
    const button = document.getElementById("account-menu-services");
    expect(button).not.toBeNull();
    expect(items.contains(button)).toBe(true);
    expect(button?.getAttribute("role")).toBe("menuitem");
    expect(button?.textContent).toBe("Services & data");
    expect(document.getElementById("account-menu-services-icon")?.tagName.toLowerCase()).toBe("svg");
    expectUniqueIds(document.body);
    for (const el of button?.querySelectorAll("*") ?? []) expect(el.id, el.outerHTML).not.toBe("");
    await act(async () => {
      fireEvent.click(button!);
    });
    expect(openServices).toHaveBeenCalledTimes(1);
    expect(document.getElementById("account-menu-items")).toBeNull();
  });
});
