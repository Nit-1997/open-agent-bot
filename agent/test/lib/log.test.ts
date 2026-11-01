import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact } from "../../src/lib/log.js";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("masks keys, bearer tokens, JWTs and secret JSON fields", () => {
    const text = [
      "key sk-ant-api03-abcdefghijkl",
      "sb_secret_abc123 sb_publishable_xyz",
      "Authorization: Bearer abc.def.ghi",
      "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
      '{"apiKey":"k1","refresh":"r1","access":"a1","name":"ok"}',
    ].join(" ");
    const out = String(redact(text));
    for (const leak of ["sk-ant-api03", "sb_secret_abc", "sb_publishable_xyz", "abc.def.ghi", "eyJhbGci", '"k1"', '"r1"', '"a1"'])
      expect(out).not.toContain(leak);
    expect(out).toContain('"name":"ok"');
  });

  it("is applied to every argument of log.error and log.warn, including errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.error("[x] failed", new Error("bad key sk-or-v1-0123456789abcdef"));
    log.warn("[x]", { token: "secret-token" });
    const written =
      JSON.stringify([err.mock.calls, warn.mock.calls.map((c) => c.map(String))]) + String((err.mock.calls[0][1] as Error).message);
    expect(written).not.toContain("sk-or-v1-0123");
    expect(written).not.toContain("secret-token");
  });

  describe("log lines", () => {
    it("escapes control characters so a value can't forge or split log lines", () => {
      const out = vi.spyOn(console, "log").mockImplementation(() => {});
      log.info(`[run] run=${"x\n[auth] verified user=admin\r\u001b[31m\u2028"}`);
      expect(out.mock.calls[0][0]).toBe("[run] run=x\\u000a[auth] verified user=admin\\u000d\\u001b[31m\\u2028");
      out.mockRestore();
    });
  });
});
