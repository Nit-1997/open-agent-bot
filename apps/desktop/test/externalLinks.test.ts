import { describe, expect, it } from "vitest";
import { createExternalOpener, LINKS, validateExternalUrl } from "../src/main/externalLinks.ts";
import { LINK_IDS } from "../src/shared/actions.ts";

describe("validateExternalUrl (S3)", () => {
  const ok = [
    "https://example.com/oa-external",
    "http://example.com/",
    "https://github.com/Nit-1997/open-agent-bot/releases/",
    "https://example.com/a?b=c#d",
  ];
  for (const url of ok) it(`accepts ${url}`, () => expect(validateExternalUrl(url)).toEqual({ ok: true, url }));

  const refused: [string, string][] = [
    ["file:///etc/hosts", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["data:text/html,hi", "scheme"],
    ["mailto:a@example.com", "scheme"],
    ["oa-shell://screens/index.html", "scheme"],
    ["vscode://x", "scheme"],
    ["https://user:pw@example.com/", "userinfo"],
    ["https://user@example.com/", "userinfo"],
    [`https://example.com/${"a".repeat(2049 - "https://example.com/".length)}`, "too_long"],
    ["https://example.com/a\nb", "control_or_space"],
    ["https://example.com/a\tb", "control_or_space"],
    ["https://example.com/a b", "control_or_space"],
    ["https://example.com/\u0000", "control_or_space"],
    ["https://example.com/\u007f", "control_or_space"],
    [" https://example.com/", "control_or_space"],
    ["https://example.com", "not_canonical"],
    ["HTTPS://example.com/", "not_canonical"],
    ["https://EXAMPLE.com/", "not_canonical"],
    ["https://example.com/a/../b", "not_canonical"],
    ["http://127.0.0.1:18420/", "loopback"],
    ["http://localhost:3000/", "loopback"],
    ["not a url", "invalid"],
  ];
  for (const [url, reason] of refused)
    it(`refuses ${JSON.stringify(url).slice(0, 60)} (${reason})`, () => expect(validateExternalUrl(url)).toEqual({ ok: false, reason }));

  it("accepts exactly 2048 characters", () => {
    const url = `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`;
    expect(url.length).toBe(2048);
    expect(validateExternalUrl(url).ok).toBe(true);
  });

  it("refuses a non-string", () => {
    expect(validateExternalUrl(42 as unknown as string)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("LINKS", () => {
  it("maps every LinkId to a fixed https URL that passes the guard", () => {
    expect(Object.keys(LINKS).sort()).toEqual([...LINK_IDS].sort());
    for (const url of Object.values(LINKS)) expect(validateExternalUrl(url)).toEqual({ ok: true, url });
  });
});

describe("createExternalOpener", () => {
  const setup = () => {
    let now = 1_000_000;
    const opened: string[] = [];
    const lines: string[] = [];
    const open = createExternalOpener({
      now: () => now,
      open: (u) => void opened.push(u),
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) },
    });
    return { open, opened, lines, advance: (ms: number) => (now += ms) };
  };

  it("opens a valid URL once", () => {
    const s = setup();
    expect(s.open("https://example.com/a")).toBe("opened");
    expect(s.opened).toEqual(["https://example.com/a"]);
  });

  it("allows at most one open per second across the app", () => {
    const s = setup();
    expect(s.open("https://example.com/a")).toBe("opened");
    s.advance(999);
    expect(s.open("https://example.com/b")).toBe("dropped_rate");
    s.advance(1);
    expect(s.open("https://example.com/b")).toBe("opened");
    expect(s.opened).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(s.lines.some((l) => l.includes("[external] dropped rate"))).toBe(true);
  });

  it("de-duplicates the same URL for 10 s", () => {
    const s = setup();
    s.open("https://example.com/a");
    s.advance(5_000);
    expect(s.open("https://example.com/a")).toBe("dropped_duplicate");
    s.advance(4_999);
    expect(s.open("https://example.com/a")).toBe("dropped_duplicate");
    s.advance(1);
    expect(s.open("https://example.com/a")).toBe("opened");
  });

  it("drops 20 scripted calls in a loop down to one", () => {
    const s = setup();
    const results = Array.from({ length: 20 }, () => s.open("https://example.com/oa-external"));
    expect(results.filter((r) => r === "opened")).toHaveLength(1);
    expect(s.opened).toHaveLength(1);
  });

  it("refuses invalid URLs without consuming the rate budget", () => {
    const s = setup();
    expect(s.open("file:///etc/hosts")).toBe("refused");
    expect(s.open("https://example.com/a")).toBe("opened");
    expect(s.lines.some((l) => l.includes("[external] refused scheme"))).toBe(true);
  });

  it("never logs the full URL", () => {
    const s = setup();
    s.open("https://example.com/secret-path?token=abc");
    expect(s.lines.join("\n")).not.toContain("secret-path");
    expect(s.lines.join("\n")).not.toContain("token=abc");
  });
});
