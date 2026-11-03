import { describe, expect, it } from "vitest";
import { EnvelopeCredentialStore } from "../../src/secrets/credentialStore.js";
import { secretsFor } from "../../src/secrets/secretsFor.js";
import { wrapper } from "../fixtures/app.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, BOB } from "../fixtures/users.js";

const key = { type: "api_key" as const, key: "sk-test-secrets-for" };

describe("secretsFor", () => {
  it("builds an envelope credential store per user that round-trips a credential", async () => {
    const credentialsFor = secretsFor(new MemoryDb(), wrapper);
    const alice = credentialsFor(ALICE.id);
    expect(alice).toBeInstanceOf(EnvelopeCredentialStore);
    await alice.modify("openrouter", async () => key);
    expect(await alice.read("openrouter")).toEqual(key);
    expect(await credentialsFor(ALICE.id).read("openrouter")).toEqual(key);
    expect(await alice.listings()).toEqual([{ provider: "openrouter", kind: "api_key", hint: expect.any(String) }]);
  });

  it("never lets another user's instance read the credential", async () => {
    const credentialsFor = secretsFor(new MemoryDb(), wrapper);
    await credentialsFor(ALICE.id).modify("openrouter", async () => key);
    const bob = credentialsFor(BOB.id);
    expect(await bob.read("openrouter")).toBeUndefined();
    expect(await bob.list()).toEqual([]);
  });
});
