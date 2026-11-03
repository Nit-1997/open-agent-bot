import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetAuthState } from "@oab/ui/lib/authState.ts";
import { chatIndex } from "@oab/ui/lib/chatIndex.ts";
import { resetProfileStore } from "@oab/ui/lib/profile.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localRespond } from "./support/localFetch.ts";
import { openAccountMenu } from "./support/accountMenu.tsx";

vi.mock("@copilotkit/react-core/v2", async () => (await import("./support/copilot.tsx")).copilotMock());

const GOLDEN = join(import.meta.dirname, "fixtures/account-menu.html");

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

describe("the local account menu without the desktop bridge (golden DOM)", { timeout: 20000 }, () => {
  it("is byte-equal to the fixture captured before the desktop slot existed", async () => {
    const html = (await openAccountMenu()).outerHTML;
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) writeFileSync(GOLDEN, `${html}\n`);
    expect(`${html}\n`).toBe(readFileSync(GOLDEN, "utf8"));
    expect(document.getElementById("account-menu-services")).toBeNull();
  });
});
