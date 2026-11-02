import { describe, expect, it } from "vitest";
import { checkFormTs, signFormTs } from "@/lib/formToken";

const SECRET = "b".repeat(64);
const T0 = 1_800_000_000_000;

describe("form token", () => {
  it("accepts a token between 3 seconds and 1 hour old", () => {
    const token = signFormTs(T0, SECRET);
    expect(checkFormTs(token, T0 + 3_000, SECRET)).toBe(true);
    expect(checkFormTs(token, T0 + 60 * 60 * 1000, SECRET)).toBe(true);
  });

  it("rejects a form submitted in under 3 seconds", () => {
    expect(checkFormTs(signFormTs(T0, SECRET), T0 + 2_999, SECRET)).toBe(false);
  });

  it("rejects a form older than an hour", () => {
    expect(checkFormTs(signFormTs(T0, SECRET), T0 + 60 * 60 * 1000 + 1, SECRET)).toBe(false);
  });

  it("rejects forged and malformed tokens", () => {
    const token = signFormTs(T0, SECRET);
    const [, sig] = token.split(".");
    expect(checkFormTs(`${T0 - 10_000}.${sig}`, T0 + 5_000, SECRET)).toBe(false);
    expect(checkFormTs(signFormTs(T0, "c".repeat(64)), T0 + 5_000, SECRET)).toBe(false);
    expect(checkFormTs(`${T0}.${"A".repeat(43)}`, T0 + 5_000, SECRET)).toBe(false);
    expect(checkFormTs("not-a-token", T0 + 5_000, SECRET)).toBe(false);
    expect(checkFormTs(null, T0 + 5_000, SECRET)).toBe(false);
  });
});
