import { afterEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "../src/identity/types.js";
import type { ProviderHub } from "../src/providers/hub.js";
import { UserHubs } from "../src/providers/hubs.js";
import { LoginFlows } from "../src/providers/logins.js";
import { type SessionEntry, SessionStore } from "../src/session/sessionStore.js";
import { forgetter, startAgent } from "../src/startAgent.js";
import { parseCredentialKeys } from "../src/secrets/keys.js";
import { LocalKeyWrapper } from "../src/secrets/keyWrapper.js";
import { WorkspaceStore } from "../src/workspace/store.js";
import { TEST_KEY_B64, testConfig } from "./fixtures/config.js";
import { MemoryDb } from "./fixtures/memoryRepos.js";
import { ALICE, BOB, CHAT_1, CHAT_2 } from "./fixtures/users.js";

afterEach(() => vi.restoreAllMocks());

function parts() {
  const builds: string[] = [];
  const hubs = new UserHubs(async (user: Principal) => {
    builds.push(user.id);
    return { id: user.id } as unknown as ProviderHub;
  });
  const logins = new LoginFlows(
    (_user, _provider, ui) => new Promise((_resolve, reject) => ui.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  );
  const disposed: string[] = [];
  const sessions = new SessionStore({
    idleMs: 60_000,
    create: async (owner): Promise<SessionEntry> => ({
      session: {} as SessionEntry["session"],
      busy: false,
      lastUsed: 0,
      dispose: async () => void disposed.push(`${owner.user.id}:${owner.chatId}`),
      workspace: new WorkspaceStore(),
    }),
  });
  return { hubs, logins, sessions, builds, disposed };
}

describe("forgetUser", () => {
  it("cancels the user's logins, invalidates their hubs and disposes their sessions, leaving others alone", async () => {
    const p = parts();
    const aliceFlow = p.logins.start(ALICE, "openai-codex");
    const bobFlow = p.logins.start(BOB, "openai-codex");
    await p.hubs.get(ALICE);
    await p.hubs.get(BOB);
    const persona = {} as Parameters<SessionStore["getOrCreate"]>[2];
    await p.sessions.getOrCreate({ user: ALICE, chatId: CHAT_1 }, null, persona);
    await p.sessions.getOrCreate({ user: BOB, chatId: CHAT_2 }, null, persona);

    await forgetter(p)(ALICE.id);

    expect(p.logins.get(ALICE.id, aliceFlow)).toBeUndefined();
    expect(p.logins.get(BOB.id, bobFlow)).toMatchObject({ status: "running" });
    expect(p.disposed).toEqual([`${ALICE.id}:${CHAT_1}`]);
    expect(p.sessions.get({ user: ALICE, chatId: CHAT_1 })).toBeUndefined();
    expect(p.sessions.get({ user: BOB, chatId: CHAT_2 })).toBeDefined();
    await p.hubs.get(ALICE);
    await p.hubs.get(BOB);
    expect(p.builds).toEqual([ALICE.id, BOB.id, ALICE.id]);
  });

  it("is what startAgent hands to the routes factory", async () => {
    const cancelAll = vi.spyOn(LoginFlows.prototype, "cancelAll");
    const invalidate = vi.spyOn(UserHubs.prototype, "invalidate");
    const disposeUser = vi.spyOn(SessionStore.prototype, "disposeUser");
    let forget: ((id: string) => Promise<void>) | undefined;
    const agent = await startAgent({
      config: testConfig({ LOG_LEVEL: "error" }),
      store: new MemoryDb(),
      identity: { kind: "local", admitCaller: () => undefined, authenticate: async () => ({ ok: true, principal: ALICE }) },
      keyWrapper: new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`)),
      port: 0,
      routes: (core) => {
        forget = core.forgetUser;
        return [];
      },
    });
    try {
      expect(agent.handles.forgetUser).toBe(forget);
      await agent.handles.forgetUser(ALICE.id);
      expect(cancelAll).toHaveBeenCalledWith(ALICE.id);
      expect(invalidate).toHaveBeenCalledWith(ALICE.id);
      expect(disposeUser).toHaveBeenCalledWith(ALICE.id);
    } finally {
      await agent.close();
    }
  });
});
