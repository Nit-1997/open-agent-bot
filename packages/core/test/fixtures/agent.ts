import type { Identity } from "../../src/identity/types.js";
import { parseCredentialKeys } from "../../src/secrets/keys.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import type { AgentDeps } from "../../src/startAgent.js";
import { TEST_KEY_B64, testConfig } from "./config.js";
import { MemoryDb } from "./memoryRepos.js";
import { ALICE } from "./users.js";

export const localIdentity: Identity = {
  kind: "local",
  admitCaller: () => undefined,
  authenticate: async () => ({ ok: true, principal: ALICE }),
};

export function coreDeps(over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    config: testConfig({ LOG_LEVEL: "error" }),
    store: new MemoryDb(),
    identity: localIdentity,
    keyWrapper: new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`)),
    port: 0,
    ...over,
  };
}
