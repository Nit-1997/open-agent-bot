import { describe, expect, it } from "vitest";
import { REFUSAL_EXIT as CORE } from "../../../packages/core/src/local/refusal.ts";
import { lastRefusalLine, readRefusal, REFUSAL_EXIT, savedKeyCount } from "../src/main/refusals.ts";

describe("refusals (D10a)", () => {
  it("the table equals core's REFUSAL_EXIT", () => {
    expect(REFUSAL_EXIT).toEqual(CORE);
  });

  it.each(Object.entries(REFUSAL_EXIT))("%s ↔ %i", (code, exit) => {
    const logs = `agent-1  | booting\nagent-1  | [startup] refused code=${code} something went wrong\n`;
    expect(readRefusal(exit, logs)).toEqual({
      kind: "refused",
      code,
      line: `[startup] refused code=${code} something went wrong`,
      message: "something went wrong",
    });
  });

  it("takes the last refusal line, with or without the compose prefix and timestamps", () => {
    const logs = [
      "agent-1  | 2026-11-03T10:00:00.000000000Z [startup] refused code=config first",
      "agent-1  | 2026-11-03T10:00:05.000000000Z [startup] refused code=kek_missing second",
    ].join("\n");
    expect(lastRefusalLine(logs)).toMatchObject({ code: "kek_missing", message: "second" });
    expect(lastRefusalLine("[startup] refused code=listen raw")).toMatchObject({ code: "listen" });
  });

  it("mismatch, unknown code, crash and none", () => {
    expect(readRefusal(78, "agent-1 | [startup] refused code=kek_missing x")).toEqual({
      kind: "mismatch",
      exitCode: 78,
      line: "[startup] refused code=kek_missing x",
    });
    expect(readRefusal(82, "agent-1 | [startup] refused code=unknown_thing x")).toMatchObject({ kind: "mismatch", exitCode: 82 });
    expect(readRefusal(82, "agent-1 | no line")).toEqual({ kind: "mismatch", exitCode: 82 });
    expect(readRefusal(1, "agent-1 | boom")).toEqual({ kind: "crashed", exitCode: 1 });
    expect(readRefusal(137, "")).toEqual({ kind: "crashed", exitCode: 137 });
    expect(readRefusal(0, "")).toEqual({ kind: "none" });
    expect(readRefusal(undefined, "")).toEqual({ kind: "none" });
  });

  it("reads the saved key count from core's kek_missing message", () => {
    expect(savedKeyCount("the credential key /keys/kek is missing but the database holds 1 saved model key sealed with it.")).toBe(1);
    expect(savedKeyCount("… holds 3 saved model keys sealed with it")).toBe(3);
    expect(savedKeyCount("nothing")).toBeUndefined();
  });
});
