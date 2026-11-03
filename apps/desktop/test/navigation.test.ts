import { describe, expect, it } from "vitest";
import {
  createOpenBudget,
  type NavContext,
  type NavDecision,
  navigationDecision,
  SHELL_URL,
  subframeDecision,
} from "../src/main/navigation.ts";

const P = 18420;
const O = `http://127.0.0.1:${P}`;
const app = (kind: NavContext["kind"], mainFrame = true): NavContext => ({ view: "app", appOrigin: O, mainFrame, kind });
const report = (kind: NavContext["kind"], mainFrame = true): NavContext => ({ view: "report", appOrigin: O, mainFrame, kind });
const shell = (kind: NavContext["kind"]): NavContext => ({ view: "shell", mainFrame: true, kind });

const allow: NavDecision = { action: "allow" };
const deny: NavDecision = { action: "deny" };
const external = (url: string): NavDecision => ({ action: "external", url });
const toReport = (url: string): NavDecision => ({ action: "report", url });

const rows: [string, NavContext, NavDecision][] = [
  [`${O}/`, app("navigate"), allow],
  [`${O}/chats/abc?x=1#y`, app("navigate"), allow],
  [`HTTP://127.0.0.1:${P}/`, app("navigate"), allow],
  [`http://127.0.0.1.:${P}/`, app("navigate"), allow],
  [`${O}/api/artifacts/AbCdEfGhIjKl`, app("redirect"), allow],
  [`${O}/`, report("navigate"), allow],
  [`http://localhost:${P}/`, app("navigate"), deny],
  [`http://localhost.:${P}/`, app("navigate"), deny],
  [`http://127.0.0.1:${P + 1}/`, app("navigate"), deny],
  [`http://127.0.0.2:${P}/`, app("navigate"), deny],
  [`http://[::1]:${P}/`, app("navigate"), deny],
  [`http://0.0.0.0:${P}/`, app("navigate"), deny],
  [`https://127.0.0.1:${P}/`, app("navigate"), deny],
  [`http://127.0.0.1:${P + 1}/`, app("redirect"), deny],
  [`http://127.0.0.1:${P}@evil.com/`, app("navigate"), deny],
  [`http://user:pw@127.0.0.1:${P}/`, app("navigate"), deny],
  [`http://user@example.com/`, app("navigate"), deny],
  ["https://example.com/oa-external", app("navigate"), external("https://example.com/oa-external")],
  ["https://example.com/oa-external", report("navigate"), deny],
  ["https://example.com/oa-external", report("redirect"), deny],
  ["https://example.com/oa-external", app("redirect"), deny],
  ["https://example.com/oa-external", app("navigate", false), deny],
  ["http://example.com/", app("navigate"), external("http://example.com/")],
  ["file:///etc/hosts", app("navigate"), deny],
  ["file:///etc/hosts", app("redirect"), deny],
  ["data:text/html,<p>x</p>", app("navigate"), deny],
  ["javascript:alert(1)", app("navigate"), deny],
  ["oa-shell://screens/index.html", app("navigate"), deny],
  ["chrome://settings", app("navigate"), deny],
  ["vscode://open", app("navigate"), deny],
  ["about:blank", app("navigate"), deny],
  ["not a url", app("navigate"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKl`, app("open"), toReport(`${O}/api/artifacts/AbCdEfGhIjKl`)],
  [`${O}/api/artifacts/Ab-dEf_hIjKl`, app("open"), toReport(`${O}/api/artifacts/Ab-dEf_hIjKl`)],
  [`${O}/api/artifacts/AbCdEfGhIjK`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKlm`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKl?format=pdf`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKl#x`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKl/`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGh%2fjKl`, app("open"), deny],
  [`${O}/api/artifacts/../chats`, app("open"), deny],
  [`${O}/x`, app("open"), deny],
  [`${O}/api/artifacts/AbCdEfGhIjKl`, report("open"), deny],
  [`http://localhost:${P}/api/artifacts/AbCdEfGhIjKl`, app("open"), deny],
  ["https://example.com/oa-external", app("open"), external("https://example.com/oa-external")],
  ["https://example.com/oa-external", report("open"), external("https://example.com/oa-external")],
  [`http://127.0.0.1:${P + 1}/`, app("open"), deny],
  ["javascript:alert(1)", app("open"), deny],
  ["about:blank", app("open"), deny],
  [SHELL_URL, shell("navigate"), allow],
  [`${SHELL_URL}?x=1`, shell("navigate"), deny],
  ["oa-shell://screens/other.html", shell("navigate"), deny],
  ["oa-shell://evil/index.html", shell("navigate"), deny],
  [`${O}/`, shell("navigate"), deny],
  ["https://example.com/", shell("navigate"), deny],
  [SHELL_URL, shell("open"), deny],
  ["https://example.com/", shell("open"), deny],
  [SHELL_URL, shell("redirect"), deny],
];

describe("navigationDecision (D5)", () => {
  it("has at least 30 rows", () => expect(rows.length).toBeGreaterThanOrEqual(30));
  for (const [url, ctx, expected] of rows) {
    it(`${ctx.view} ${ctx.kind}${ctx.mainFrame ? "" : " subframe"} ${url} → ${expected.action}`, () => {
      expect(navigationDecision(url, ctx)).toEqual(expected);
    });
  }

  it("denies everything for the app view before an app origin is known", () => {
    expect(navigationDecision(`${O}/`, { view: "app", mainFrame: true, kind: "navigate" })).toEqual(deny);
    expect(navigationDecision("https://example.com/", { view: "app", mainFrame: true, kind: "open" })).toEqual(deny);
  });
});

describe("subframeDecision", () => {
  it("allows same-origin, about:blank and about:srcdoc frames", () => {
    expect(subframeDecision(`${O}/api/artifacts/AbCdEfGhIjKl`, O)).toBe("allow");
    expect(subframeDecision("about:blank", O)).toBe("allow");
    expect(subframeDecision("about:srcdoc", O)).toBe("allow");
  });

  it("cancels cross-origin frames and unknown parents", () => {
    expect(subframeDecision("https://example.com/oa-frame", O)).toBe("cancel");
    expect(subframeDecision(`http://localhost:${P}/`, O)).toBe("cancel");
    expect(subframeDecision("data:text/html,x", O)).toBe("cancel");
    expect(subframeDecision(`${O}/`, "null")).toBe("cancel");
    expect(subframeDecision(`${O}/`, undefined)).toBe("cancel");
    expect(subframeDecision("not a url", O)).toBe("cancel");
  });
});

describe("report window open budget (S1)", () => {
  it("allows three external opens per window, then denies", () => {
    const budget = createOpenBudget(3);
    expect([budget.take(), budget.take(), budget.take(), budget.take(), budget.take()]).toEqual([true, true, true, false, false]);
    expect(budget.spent()).toBe(true);
  });

  it("each window gets its own budget", () => {
    const a = createOpenBudget(3);
    const b = createOpenBudget(3);
    for (let i = 0; i < 3; i++) a.take();
    expect(a.take()).toBe(false);
    expect(b.take()).toBe(true);
  });
});
