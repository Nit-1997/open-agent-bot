import { createHash } from "node:crypto";
import { LOCAL_USER_EMAIL, LOCAL_USER_ID } from "@oab/shared/local";
import { describe, expect, it } from "vitest";
import { SCHEMA } from "../../src/local/store/schema.js";

describe("frozen local values", () => {
  it("pins the local user", () => {
    expect(LOCAL_USER_ID).toBe("00000000-0000-4000-8000-000000000001");
    expect(LOCAL_USER_EMAIL).toBe("local@open-agent.invalid");
  });

  it("pins schema v1", () => {
    expect(SCHEMA.map((m) => m.version)).toEqual([1]);
    expect(createHash("sha256").update(SCHEMA[0]!.sql).digest("hex")).toBe(
      "92b588ed50294cd0d1b8218703f3c3dabb11fbb7887fe3167af0a6184dc75348",
    );
  });
});
