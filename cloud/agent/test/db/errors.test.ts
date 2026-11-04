import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbError, must, read } from "../../../src/hosted/store/errors.js";

const ok = <T>(data: T) => ({ data, error: null, status: 200, count: null });
const fail = (code: string | null, status: number) => ({ data: null, error: { code, message: "boom" }, status, count: null });

describe("db errors", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("maps Postgres codes and transport failures to user errors", () => {
    expect(dbError("x", { code: "", status: 0 })).toMatchObject({ kind: "unavailable" });
    expect(dbError("x", { code: null })).toMatchObject({ kind: "unavailable" });
    expect(dbError("x", { code: "23505", status: 409 })).toMatchObject({ kind: "conflict" });
    expect(dbError("x", { code: "23503", status: 409 })).toMatchObject({ kind: "not_found" });
    expect(dbError("x", { code: "23514", status: 400 })).toMatchObject({ kind: "invalid" });
    expect(dbError("x", { code: "22P02", status: 400 })).toMatchObject({ kind: "invalid" });
    expect(dbError("x", { code: "42501", status: 403 })).toMatchObject({ kind: "upstream" });
    expect(dbError("x", { code: "23505", status: 0 })).toMatchObject({ kind: "unavailable" });
  });

  it("must returns data and count or throws the mapped error", async () => {
    expect(await must("x", Promise.resolve({ data: [1], error: null, status: 200, count: 3 }))).toEqual({ data: [1], count: 3 });
    expect(await must("x", Promise.resolve(ok("a")))).toEqual({ data: "a", count: null });
    await expect(must("x", Promise.resolve(fail("23505", 409)))).rejects.toMatchObject({ kind: "conflict" });
  });

  it("read retries exactly once after a transport failure", async () => {
    const q = vi.fn().mockResolvedValueOnce(fail(null, 0)).mockResolvedValueOnce(ok("second"));
    expect(await read("x", q)).toEqual({ data: "second", count: null });
    expect(q).toHaveBeenCalledTimes(2);

    const down = vi.fn().mockResolvedValue(fail(null, 0));
    await expect(read("x", down)).rejects.toMatchObject({ kind: "unavailable" });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("read does not retry a coded error or a success", async () => {
    const coded = vi.fn().mockResolvedValue(fail("22P02", 400));
    await expect(read("x", coded)).rejects.toMatchObject({ kind: "invalid" });
    expect(coded).toHaveBeenCalledTimes(1);

    const fine = vi.fn().mockResolvedValue(ok(1));
    await read("x", fine);
    expect(fine).toHaveBeenCalledTimes(1);
  });
});
