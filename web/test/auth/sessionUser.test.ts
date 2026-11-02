import { describe, expect, it } from "vitest";
import { sessionUserFromClaims } from "@/lib/sessionUser";

const base = { sub: "u1", role: "authenticated", email: "a@example.test" };

describe("sessionUserFromClaims", () => {
  it("takes the display name from the sign-in metadata", () => {
    expect(sessionUserFromClaims({ ...base, user_metadata: { full_name: " Nitin Bhat " } })?.name).toBe("Nitin Bhat");
    expect(sessionUserFromClaims({ ...base, user_metadata: { name: "Shrishtika Bora" } })?.name).toBe("Shrishtika Bora");
  });

  it("falls back to an empty name when the metadata has none", () => {
    expect(sessionUserFromClaims(base)?.name).toBe("");
    expect(sessionUserFromClaims({ ...base, user_metadata: { full_name: 42 } })?.name).toBe("");
  });

  it("caps very long names", () => {
    expect(sessionUserFromClaims({ ...base, user_metadata: { full_name: "x".repeat(500) } })?.name).toHaveLength(80);
  });
});
