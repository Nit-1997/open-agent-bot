import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadOwners } from "../../src/copilot/owners.js";
import type { Principal } from "../../src/identity/types.js";
import { CALLERS, type Caller, EXTRA_ACCOUNTS, matrixSeams } from "../fixtures/callers.js";
import { ALICE, BOB } from "../fixtures/users.js";
import {
  CONNECT,
  type CopilotHarness,
  copilotHarness,
  Deferred,
  fakeRun,
  parseSse,
  post,
  RUN,
  readUntil,
  runBody,
  STOP,
  T1,
  T2,
  T3,
  waitFor,
} from "../copilot/harness.js";

type Cell = { status: number; error: string | null };
const MATRIX = JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/route-matrix.json"), "utf8")) as {
  cells: Record<string, Record<string, Cell>>;
};
const AGUI = MATRIX.cells["POST /agui"]!;
const REFUSAL_CALLERS = [
  "NO_SECRET",
  "SECRET_NO_BEARER",
  "WRONG_SECRET",
  "DEACTIVATED",
  "STATUS_THROWS",
  "JWKS_DOWN",
  "EXPIRED",
  "INVALID",
];
const SIGNED_IN = CALLERS.filter((c) => !REFUSAL_CALLERS.includes(c.name));

const threadFor = (n: number) => `${String(n).repeat(8)}-0000-4000-8000-${String(n).repeat(12)}`.slice(0, 36);

type Probe = { name: string; method: string; path: string; body?: (thread: string) => unknown; allowed?: number };
const probes = (thread: string): Probe[] => [
  { name: "info", method: "GET", path: "/copilotkit/info", allowed: 200 },
  { name: "run", method: "POST", path: RUN, body: (t) => runBody(t), allowed: 200 },
  { name: "connect", method: "POST", path: CONNECT, body: (t) => runBody(t), allowed: 200 },
  { name: "stop", method: "POST", path: STOP(thread), body: () => ({}), allowed: 200 },
  { name: "threads", method: "GET", path: "/copilotkit/threads" },
  { name: "base", method: "POST", path: "/copilotkit" },
  { name: "nested info", method: "GET", path: "/copilotkit/a/b/info" },
  { name: "other agent", method: "POST", path: "/copilotkit/agent/other/run", body: (t) => runBody(t) },
];

async function cellFor(h: CopilotHarness, caller: Caller, probe: Probe, thread: string): Promise<Cell> {
  const res = await h.app.request(probe.path, {
    method: probe.method,
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(caller.secret !== null && { "x-agent-secret": caller.secret }),
      ...(caller.bearer && { authorization: `Bearer ${caller.bearer}` }),
    },
    ...(probe.body && { body: JSON.stringify(probe.body(thread)) }),
  });
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const json = (await res.json()) as { error?: unknown };
    return { status: res.status, error: typeof json.error === "string" ? json.error : null };
  }
  await res.text();
  return { status: res.status, error: null };
}

let quiet: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

describe("copilotkit guards for every matrix caller", () => {
  it("answers each refusal caller exactly as POST /agui does, on every copilotkit path", async () => {
    const h = await copilotHarness({ handle: fakeRun(), seams: matrixSeams() });
    for (const u of EXTRA_ACCOUNTS) h.accounts.add(u);
    for (const name of REFUSAL_CALLERS) {
      const caller = CALLERS.find((c) => c.name === name)!;
      for (const probe of probes(T1)) {
        const cell = await cellFor(h, caller, probe, T1);
        expect(cell, `${probe.name} ${name}`).toEqual({ status: AGUI[name]!.status, error: AGUI[name]!.error });
      }
    }
  });

  it("serves only the allowlist to signed-in callers and answers 404 everywhere else", async () => {
    const h = await copilotHarness({ handle: fakeRun(), seams: matrixSeams() });
    for (const u of EXTRA_ACCOUNTS) h.accounts.add(u);
    for (const [i, caller] of SIGNED_IN.entries()) {
      const thread = threadFor(i + 1);
      for (const probe of probes(thread)) {
        const cell = await cellFor(h, caller, probe, thread);
        const expected = probe.allowed !== undefined ? { status: probe.allowed, error: null } : { status: 404, error: "not_found" };
        expect(cell, `${probe.name} ${caller.name}`).toEqual(expected);
      }
    }
  });
});

describe("copilotkit thread owners", () => {
  let holds: Map<string, Deferred>;
  beforeEach(() => {
    holds = new Map();
  });
  afterEach(() => {
    for (const d of holds.values()) d.resolve();
  });

  async function liveRun(h: CopilotHarness, user: Principal, threadId: string) {
    holds.set(threadId.toLowerCase(), new Deferred());
    const res = await post(h, user, RUN, runBody(threadId));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    return reader;
  }

  it("refuses Bob's stop, connect and run on Alice's live thread", async () => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    const alice = await liveRun(h, ALICE, T1);
    await waitFor(() => h.owners.ownerOf(T1) === ALICE.id);
    for (const [path, body] of [
      [STOP(T1), {}],
      [CONNECT, runBody(T1)],
      [RUN, runBody(T1)],
    ] as const) {
      const res = await post(h, BOB, path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden", message: "That chat belongs to someone else." });
    }
    holds.get(T1)!.resolve();
    expect(parseSse(await readUntil(alice, () => false)).at(-1)?.type).toBe("RUN_FINISHED");
  });

  it("refuses Bob's stop and connect on Alice's stored chat after a restart, and allows Alice's", async () => {
    const h = await copilotHarness({ handle: fakeRun(), owners: new ThreadOwners() });
    await h.db.forUser(ALICE.id).chats.claim(T2, {});
    expect((await post(h, BOB, STOP(T2), {})).status).toBe(403);
    expect((await post(h, BOB, CONNECT, runBody(T2))).status).toBe(403);
    const stop = await post(h, ALICE, STOP(T2), {});
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ stopped: false });
    const connect = await post(h, ALICE, CONNECT, runBody(T2));
    expect(connect.status).toBe(200);
    await connect.text();
  });

  it("does not let a refused Bob run block Alice's run, connect or stop", async () => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    await h.db.forUser(ALICE.id).chats.claim(T3, {});
    const bob = await post(h, BOB, RUN, runBody(T3));
    expect(bob.status).toBe(200);
    const bobEvents = parseSse(await bob.text());
    expect(bobEvents.find((e) => e.type === "RUN_ERROR")).toMatchObject({ code: "NOT_FOUND" });
    expect(h.owners.ownerOf(T3)).toBeUndefined();

    const alice = await liveRun(h, ALICE, T3);
    expect(h.owners.ownerOf(T3)).toBe(ALICE.id);
    const connect = await post(h, ALICE, CONNECT, runBody(T3));
    expect(connect.status).toBe(200);
    const stop = await post(h, ALICE, STOP(T3), {});
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ stopped: true });
    expect(parseSse(await readUntil(alice, () => false)).at(-1)).toMatchObject({ type: "RUN_ERROR", code: "abort" });
    await connect.text();
    expect(h.owners.ownerOf(T3)).toBe(ALICE.id);
  });

  it.each([
    ["an uppercase run and a lowercase stop", T1.toUpperCase(), T1],
    ["a lowercase run and an uppercase stop", T2, T2.toUpperCase()],
  ])("reaches the same run with %s, and refuses Bob's uppercase variant", async (_, runId, stopId) => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    const alice = await liveRun(h, ALICE, runId);
    expect(h.owners.ownerOf(runId.toLowerCase())).toBe(ALICE.id);
    expect((await post(h, BOB, STOP(runId.toUpperCase()), {})).status).toBe(403);
    expect((await post(h, BOB, CONNECT, runBody(runId.toUpperCase()))).status).toBe(403);
    const stop = await post(h, ALICE, STOP(stopId), {});
    expect(await stop.json()).toMatchObject({ stopped: true });
    expect(parseSse(await readUntil(alice, () => false)).at(-1)).toMatchObject({ type: "RUN_ERROR", code: "abort" });
  });
});

describe("copilotkit request checks", () => {
  it.each([[RUN], [CONNECT]])("answers 400 invalid on %s without a usable threadId", async (path) => {
    const h = await copilotHarness({ handle: fakeRun() });
    const { threadId: _, ...noThread } = runBody(T1);
    for (const body of [noThread, runBody(123), runBody(null), runBody("not-a-uuid"), "[]", "not json"]) {
      const res = await post(h, ALICE, path, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid" });
    }
    expect(h.slots.count(ALICE.id)).toBe(0);
  });

  it("answers 404 not_found for a stop on a thread that is not a chat id", async () => {
    const h = await copilotHarness({ handle: fakeRun() });
    const res = await post(h, ALICE, STOP("not-a-uuid"), {});
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("answers 405 for other methods on allowlisted paths and 404 for other agents", async () => {
    const h = await copilotHarness({ handle: fakeRun() });
    const cases: Array<[string, string, number]> = [
      ["POST", "/copilotkit/info", 405],
      ["PUT", "/copilotkit/info", 405],
      ["PATCH", "/copilotkit/info", 405],
      ["DELETE", "/copilotkit/info", 405],
      ["GET", RUN, 405],
      ["PUT", RUN, 405],
      ["DELETE", RUN, 405],
      ["GET", CONNECT, 405],
      ["PATCH", CONNECT, 405],
      ["GET", STOP(T1), 405],
      ["DELETE", STOP(T1), 405],
      ["POST", "/copilotkit/agent/other/connect", 404],
      ["POST", `/copilotkit/agent/other/stop/${T1}`, 404],
      ["GET", "/copilotkit/agent/other/run", 404],
      ["POST", `${RUN}/extra`, 404],
      ["POST", `${STOP(T1)}/extra`, 404],
      ["POST", "/copilotkit/agent/openagent/threads", 404],
    ];
    for (const [method, path, status] of cases) {
      const res = await h.call(ALICE, path, { method, ...(method !== "GET" && { body: JSON.stringify(runBody(T1)) }) });
      expect(res.status, `${method} ${path}`).toBe(status);
      expect(await res.json()).toMatchObject({ error: status === 405 ? "method_not_allowed" : "not_found" });
    }
  });

  it("answers 429 too_many_connections over the per-user connect cap", async () => {
    const holds = new Map([[T1, new Deferred()]]);
    const h = await copilotHarness({ handle: fakeRun({ holds }), connectsPerUser: 2 });
    const run = await post(h, ALICE, RUN, runBody(T1));
    const reader = run.body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    const open = [await post(h, ALICE, CONNECT, runBody(T1)), await post(h, ALICE, CONNECT, runBody(T1))];
    expect(open.map((r) => r.status)).toEqual([200, 200]);
    const third = await post(h, ALICE, CONNECT, runBody(T1));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ error: "too_many_connections" });
    expect((await post(h, BOB, CONNECT, runBody(T2))).status).toBe(403);
    holds.get(T1)!.resolve();
    await Promise.all([readUntil(reader, () => false), ...open.map((r) => r.text())]);
    await waitFor(() => h.slots.count(ALICE.id) === 0);
  });
});
