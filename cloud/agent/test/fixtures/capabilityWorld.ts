import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { type RunDeps, type RunHandle, startRun } from "@oab/core/agui/startRun.js";
import type { Identity, Principal } from "@oab/core/identity/types.js";
import { createSafeFetch } from "@oab/core/lib/safeFetch.js";
import { hubFactory } from "@oab/core/providers/hubFactory.js";
import { UserHubs } from "@oab/core/providers/hubs.js";
import { LoginFlows } from "@oab/core/providers/logins.js";
import { secretsFor } from "@oab/core/secrets/secretsFor.js";
import { type SessionEntry, SessionStore } from "@oab/core/session/sessionStore.js";
import { forgetter } from "@oab/core/startAgent.js";
import { WorkspaceStore } from "@oab/core/workspace/store.js";
import { fakeSession, type Script } from "../../../../packages/core/test/agui/fakeSession.js";
import { drain, RecordingPolicy, say } from "../../../../packages/core/test/agui/runWorld.js";
import { wrapper } from "../../../../packages/core/test/fixtures/app.js";
import { MemoryDb } from "../../../../packages/core/test/fixtures/memoryRepos.js";

export const PRIVATE_MODEL = "custom/stub-private";

const PRIVATE_SETTINGS = {
  custom: {
    custom: {
      kind: "custom",
      label: "Private stub",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [{ id: "stub-private", label: "stub-private" }],
    },
  },
  enabled: { custom: ["stub-private"] },
  hidden: [],
};

const noNetwork = (async () => {
  throw new Error("the capability world never opens a connection");
}) as typeof fetch;

export type RunOutcome = { model: "used" | "refused"; events: BaseEvent[]; error?: string };

function runInput(chatId: string, runId: string, model: string): RunAgentInput {
  return {
    threadId: chatId,
    runId,
    messages: [{ id: `m-${runId}`, role: "user", content: "hello" }],
    tools: [],
    context: [
      {
        description: "user_context",
        value: JSON.stringify({ timeZone: "UTC", locale: "en-US", localTime: "2026-11-04T10:00:00Z", model }),
      },
    ],
    state: {},
    forwardedProps: {},
  } as RunAgentInput;
}

export function capabilityWorld(identity: Identity) {
  const db = new MemoryDb();
  const hubs = new UserHubs(
    hubFactory({
      repos: (id) => db.forUser(id),
      credentials: secretsFor(db, wrapper),
      network: { fetch: noNetwork, userFetch: createSafeFetch(noNetwork), lookup: async () => ["93.184.216.34"] },
    }),
  );
  const sessions: Array<{ user: Principal; entry: SessionEntry; session: ReturnType<typeof fakeSession> }> = [];
  let script: Script = say;
  const store = new SessionStore({
    idleMs: 60_000,
    create: async (owner) => {
      const hub = await hubs.get(owner.user);
      const session = fakeSession(script);
      const entry: SessionEntry = {
        session,
        busy: false,
        lastUsed: 0,
        dispose: async () => {},
        workspace: new WorkspaceStore(),
        setModel: async (ref) => {
          if (!hub.resolve(ref)) throw new Error(`The model ${ref} isn't available any more. Pick another one from the model menu.`);
        },
      };
      sessions.push({ user: owner.user, entry, session });
      return entry;
    },
  });
  const forgetUser = forgetter({
    logins: new LoginFlows(async () => Promise.reject(new Error("no sign-ins here"))),
    hubs,
    sessions: store,
  });
  const deps: RunDeps = {
    store,
    policy: new RecordingPolicy(),
    context: (user) => {
      const r = db.forUser(user.id);
      return { user, chats: r.chats, messages: r.messages, timeLimitMs: 60_000 };
    },
  };

  return {
    sessions,
    forgetUser,
    useScript(next: Script) {
      script = next;
    },
    async allowPrivateModel(userId: string) {
      const repo = db.forUser(userId).providerSettings;
      await repo.put(PRIVATE_SETTINGS, (await repo.get()).stamp);
    },
    async authenticate(token: string): Promise<Principal> {
      const outcome = await identity.authenticate(new Request("http://agent/agui", { headers: { authorization: `Bearer ${token}` } }));
      if (!outcome.ok) throw outcome.error;
      return outcome.principal;
    },
    async start(user: Principal, chatId: string, runId: string): Promise<RunHandle> {
      const r = await startRun(deps, user, runInput(chatId, runId, PRIVATE_MODEL));
      if (!r.ok) throw r.error;
      return r.run;
    },
    async outcome(run: RunHandle): Promise<RunOutcome> {
      const events = await drain(run);
      const error = events.find((e) => e.type === EventType.RUN_ERROR) as (BaseEvent & { code?: string; message?: string }) | undefined;
      if (error?.code === "MODEL_ERROR" && error.message?.includes(`The model ${PRIVATE_MODEL} isn't available`))
        return { model: "refused", events, error: error.message };
      return { model: "used", events, ...(error && { error: `${error.code}: ${error.message}` }) };
    },
  };
}

export type CapabilityWorld = ReturnType<typeof capabilityWorld>;
