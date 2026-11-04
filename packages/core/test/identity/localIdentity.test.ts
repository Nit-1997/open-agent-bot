import { LOCAL_USER_EMAIL, LOCAL_USER_ID } from "@oab/shared/local";
import { describe, expect, it } from "vitest";
import { createLocalIdentity, LOCAL_CAPABILITIES, localPrincipal } from "../../src/identity/localIdentity.js";
import { secretMatches } from "../../src/lib/secretMatch.js";

const SECRET = "0123456789abcdef".repeat(4);
const WRONG = "fedcba9876543210".repeat(4);

const withSecret = (value?: string) =>
  new Request("http://agent/chats", value === undefined ? {} : { headers: { "x-agent-secret": value } });

describe("createLocalIdentity", () => {
  it("is a local identity", () => {
    expect(createLocalIdentity({ secret: SECRET }).kind).toBe("local");
  });

  it.each(["", "abc", SECRET.slice(1), `${SECRET}0`, SECRET.toUpperCase(), `${SECRET.slice(0, 63)}g`, ` ${SECRET.slice(1)}`])(
    "refuses the secret %j",
    (secret) => {
      expect(() => createLocalIdentity({ secret })).toThrow("64");
    },
  );

  describe("admitCaller", () => {
    const identity = createLocalIdentity({ secret: SECRET });

    it.each([
      ["no header", undefined],
      ["an empty header", ""],
      ["a wrong secret of the same length", WRONG],
      ["the secret in another case", SECRET.toUpperCase()],
      ["a prefix of the secret", SECRET.slice(0, 32)],
    ])("refuses %s", (_label, value) => {
      expect(identity.admitCaller(withSecret(value))).toMatchObject({ kind: "unauthorized" });
    });

    it("admits the right secret", () => {
      expect(identity.admitCaller(withSecret(SECRET))).toBeUndefined();
    });
  });

  describe("authenticate", () => {
    const identity = createLocalIdentity({ secret: SECRET });

    it.each([undefined, "", WRONG, SECRET.toUpperCase()])("refuses %j", async (value) => {
      const outcome = await identity.authenticate(withSecret(value));
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.error).toMatchObject({ kind: "unauthorized" });
    });

    it("returns the frozen local principal for the right secret", async () => {
      const outcome = await identity.authenticate(withSecret(SECRET));
      expect(outcome).toEqual({
        ok: true,
        principal: {
          id: LOCAL_USER_ID,
          email: LOCAL_USER_EMAIL,
          capabilities: { admin: false, privateNetworkModels: true, operatorGateway: false },
        },
      });
      const principal = outcome.ok ? outcome.principal : undefined;
      expect(Object.isFrozen(principal)).toBe(true);
      expect(Object.isFrozen(principal?.capabilities)).toBe(true);
    });

    it("ignores a bearer token", async () => {
      const req = new Request("http://agent/chats", { headers: { authorization: `Bearer ${SECRET}` } });
      expect((await identity.authenticate(req)).ok).toBe(false);
    });
  });
});

describe("local principal", () => {
  it("is the fixed local user with frozen capabilities", () => {
    expect(LOCAL_USER_ID).toBe("00000000-0000-4000-8000-000000000001");
    expect(LOCAL_USER_EMAIL).toBe("local@open-agent.invalid");
    expect(LOCAL_CAPABILITIES).toEqual({ admin: false, privateNetworkModels: true, operatorGateway: false });
    expect(Object.isFrozen(LOCAL_CAPABILITIES)).toBe(true);
    expect(localPrincipal()).toEqual({ id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, capabilities: LOCAL_CAPABILITIES });
    expect(Object.isFrozen(localPrincipal())).toBe(true);
  });
});

describe("secretMatches", () => {
  it("accepts only the exact value", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(undefined, SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(WRONG, SECRET)).toBe(false);
    expect(secretMatches(SECRET.slice(1), SECRET)).toBe(false);
  });
});
