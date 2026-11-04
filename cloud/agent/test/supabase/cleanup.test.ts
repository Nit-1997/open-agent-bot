import { afterEach, describe, expect, it, vi } from "vitest";
import { UserError } from "../../../src/lib/errors.js";
import { deleteCreatedUsers, track } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("deleteCreatedUsers", () => {
  it("deletes every tracked user, retries failures, and reports the ones that keep failing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    track("id-ok", "oab-test+ok@example.test");
    track("id-flaky", "oab-test+flaky@example.test");
    track("id-broken", "oab-test+broken@example.test");
    const attempts = new Map<string, number>();
    const remove = async (id: string) => {
      const n = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, n);
      if (id === "id-flaky" && n < 3) throw new UserError("The data service isn't reachable.", "unavailable");
      if (id === "id-broken") throw new Error("auth delete failed for token eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl");
    };

    const report = await deleteCreatedUsers({ remove, backoffMs: 0 });

    expect(report.deleted.sort()).toEqual(["oab-test+flaky@example.test", "oab-test+ok@example.test"]);
    expect(report.failed).toEqual([{ email: "oab-test+broken@example.test", error: { code: "unknown", message: expect.any(String) } }]);
    expect(report.failed[0]?.error.message).not.toMatch(/eyJ/);
    expect(attempts).toEqual(
      new Map([
        ["id-ok", 1],
        ["id-flaky", 3],
        ["id-broken", 4],
      ]),
    );
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn.mock.calls.flat().join("\n")).not.toMatch(/eyJ/);
    expect((await deleteCreatedUsers({ remove, backoffMs: 0 })).deleted).toEqual([]);
  });

  it("waits the backoff between attempts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      track("id-slow", "oab-test+slow@example.test");
      let calls = 0;
      const pending = deleteCreatedUsers({
        remove: async () => {
          calls++;
          if (calls === 1) throw new UserError("busy", "unavailable");
        },
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ deleted: ["oab-test+slow@example.test"], failed: [] });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
