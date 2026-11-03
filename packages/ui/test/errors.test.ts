import { describe, expect, it } from "vitest";
import { classifyRunError, isUserStop } from "../src/lib/errors.ts";

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

describe("isUserStop", () => {
  const abort = { code: "abort", message: "This operation was aborted" };

  it("is true only when the user asked to stop and the run ended in an abort", () => {
    expect(isUserStop(true, abort)).toBe(true);
    expect(isUserStop(true, { name: "AbortError", message: "The user aborted a request." })).toBe(true);
    expect(isUserStop(true, { message: "This operation was aborted" })).toBe(true);
  });

  it("keeps an abort without a user stop an error", () => {
    expect(isUserStop(false, abort)).toBe(false);
    expect(isUserStop(false, { name: "AbortError" })).toBe(false);
  });

  it("keeps any other error after a stop an error", () => {
    expect(isUserStop(true, { code: "MODEL_ERROR", message: "model failed" })).toBe(false);
    expect(isUserStop(true, { code: "THREAD_BUSY", message: "Thread already running" })).toBe(false);
    expect(isUserStop(true, { message: "This operation was aborted because the model failed" })).toBe(false);
    expect(isUserStop(true, {})).toBe(false);
  });
});
