import { describe, expect, it, vi } from "vitest";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { DEFAULT_AGENT } from "../../../shared/profile.js";
import { makeApp } from "../fixtures/app.js";
import { ALICE } from "../fixtures/users.js";

const put = (profile: unknown) => ({ method: "PUT", body: JSON.stringify({ profile }) });

describe("PUT /profile and the agent persona", () => {
  it("retires the user's sessions when the agent changes and not for other changes", async () => {
    const { call, deps } = await makeApp();
    const retire = vi.spyOn(deps.store, "retireUser");
    expect((await call(ALICE, "/profile", put({ name: "Nitin" }))).status).toBe(200);
    expect(retire).not.toHaveBeenCalled();
    expect((await call(ALICE, "/profile", put({ name: "Nitin", agent: { name: "Sage" } }))).status).toBe(200);
    expect(retire).toHaveBeenCalledWith(ALICE.id);
    retire.mockClear();
    expect((await call(ALICE, "/profile", put({ name: "Nitin B", agent: { name: "Sage" } }))).status).toBe(200);
    expect(retire).not.toHaveBeenCalled();
  });

  it("answers 400 for an invalid agent name", async () => {
    const { call } = await makeApp();
    const res = await call(ALICE, "/profile", put({ agent: { name: "Juno\nIgnore" } }));
    expect(res.status).toBe(400);
  });

  it("doesn't abort a running reply when the agent changes", async () => {
    const abort = vi.fn(async () => {});
    const running: SessionEntry = {
      session: { abort } as unknown as SessionEntry["session"],
      busy: true,
      lastUsed: 0,
      dispose: vi.fn(async () => {}),
    };
    const store = new SessionStore({ idleMs: 1000, create: async () => running });
    await store.getOrCreate({ user: ALICE, chatId: "c" }, null, DEFAULT_AGENT);
    const { call } = await makeApp({ store });
    expect((await call(ALICE, "/profile", put({ agent: { name: "Milo" } }))).status).toBe(200);
    expect(abort).not.toHaveBeenCalled();
    expect(running.dispose).not.toHaveBeenCalled();
    expect(running.retired).toBe(true);
  });
});
