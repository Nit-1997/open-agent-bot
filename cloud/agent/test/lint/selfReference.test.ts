import { describe, expect, it } from "vitest";

describe("@oab/core self-reference", () => {
  it("B5: @oab/core/x.js and src/x.ts are the same module instance in Vitest", async () => {
    const viaPath = await import("../../../src/lib/errors.ts");
    const { dbError } = await import("../../../src/hosted/store/errors.ts");
    expect(dbError("x", { code: "23505", status: 409 })).toBeInstanceOf(viaPath.UserError);
  });
});
