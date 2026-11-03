import { describe, expect, it } from "vitest";
import { redact } from "../src/main/redact.ts";

const cur = "a".repeat(32) + "b".repeat(32);
const prev = "c".repeat(64);

describe("redact", () => {
  it("replaces the current and the previous token anywhere", () => {
    expect(redact(`${cur} x ${prev} y ${cur}`, [cur, prev])).toBe("[token] x [token] y [token]");
  });

  it("replaces at the start and end and inside JSON", () => {
    const json = JSON.stringify({ env: [`OPEN_AGENT_LAUNCH_TOKEN=${cur}`], t: prev });
    const out = redact(json, [cur, prev]);
    expect(out).not.toContain(cur);
    expect(out).not.toContain(prev);
    expect(out).toContain("OPEN_AGENT_LAUNCH_TOKEN=[token]");
    expect(redact(`${cur}`, [cur])).toBe("[token]");
  });

  it("ignores undefined and empty tokens", () => {
    expect(redact("hello", [undefined, "", undefined])).toBe("hello");
    expect(redact(`x${cur}`, [undefined, cur])).toBe("x[token]");
  });

  it("leaves a no-token input unchanged", () => {
    expect(redact("plain text [startup] refused code=config bad", [cur, prev])).toBe("plain text [startup] refused code=config bad");
  });
});
