import { describe, expect, it } from "vitest";
import { classifyRunError } from "@/lib/errors";

describe("classifyRunError", () => {
  it("finds agent error codes in the error message or context", () => {
    expect(classifyRunError({ error: new Error("run failed"), context: { event: { code: "THREAD_BUSY" } } })).toBe("THREAD_BUSY");
    expect(classifyRunError({ error: new Error("connection refused"), context: { code: "MODEL_ERROR" } })).toBe("MODEL_ERROR");
    expect(classifyRunError({ error: new Error("network down"), context: {} })).toBe("UNKNOWN");
  });
});

describe("classifyRunError (runtime wording)", () => {
  it("maps the runtime's thread-locked rejection to THREAD_BUSY", () => {
    expect(classifyRunError({ error: new Error("Thread already running"), context: {} })).toBe("THREAD_BUSY");
  });
});
