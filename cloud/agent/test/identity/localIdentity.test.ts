import { describe, expect, it } from "vitest";
import { hostedAgentDeps } from "../../../src/hosted/deps.js";
import type { Db } from "../../../src/hosted/store/client.js";
import { createLocalIdentity } from "../../../src/identity/localIdentity.js";
import { testConfig } from "../fixtures/config.js";

const SECRET = "0123456789abcdef".repeat(4);

describe("hosted entry (B6 runtime)", () => {
  it("refuses the local identity", () => {
    const stub = () => ({ auth: { admin: {} } }) as unknown as Db;
    expect(() =>
      hostedAgentDeps(testConfig(), { db: stub(), anon: stub() }, { identity: createLocalIdentity({ secret: SECRET }) }),
    ).toThrow('the hosted agent needs a hosted identity, got "local"');
  });
});
