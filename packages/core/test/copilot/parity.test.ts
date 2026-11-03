import type { AddressInfo } from "node:net";
import type { RunAgentInput } from "@ag-ui/core";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RunContext } from "../../src/agui/runHandler.js";
import { rateLimitError } from "../../src/lib/rateLimit.js";
import { tokenFor } from "../fixtures/app.js";
import { TEST_SECRET } from "../fixtures/config.js";
import { ALICE, BOB } from "../fixtures/users.js";
import {
  busyError,
  CONNECT,
  type CopilotHarness,
  copilotHarness,
  Deferred,
  finished,
  type Handle,
  type Mode,
  parseSse,
  RUN,
  runBody,
  runError,
  STOP,
  type SseEvent,
  started,
  text,
  textEnd,
  textStart,
  until,
  waitFor,
} from "./harness.js";
import { classifyRunError, errorCodeIn } from "./webClient.js";

const holds = new Map<string, Deferred>();
const busy = new Set<string>();

const sessionRun: Handle = async function* (input: RunAgentInput, ctx: RunContext, _store: unknown, signal: AbortSignal) {
  yield started(input);
  try {
    await ctx.chats.claim(input.threadId, {});
  } catch {
    yield runError("NOT_FOUND", "This chat doesn't exist.");
    return;
  }
  if (busy.has(input.threadId)) {
    yield runError("THREAD_BUSY", "Still working on the last message.");
    return;
  }
  busy.add(input.threadId);
  try {
    const id = `msg-${input.runId}`;
    yield textStart(id);
    yield text(id, "Hello");
    const hold = holds.get(input.threadId);
    if (hold) await Promise.race([hold.promise, until(signal, 60_000)]);
    if (signal.aborted) return;
    yield text(id, " world");
    yield textEnd(id);
    yield finished(input);
  } finally {
    busy.delete(input.threadId);
  }
} as Handle;

type Server = { h: CopilotHarness; url: string; close(): Promise<void> };

async function serverFor(mode: Mode): Promise<Server> {
  let url = "";
  const h = await copilotHarness({ handle: sessionRun, mode, agentUrl: () => url });
  const server = serve({ fetch: h.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    h,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        if ("closeAllConnections" in server) server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const headers = (user = ALICE) => ({
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-agent-secret": TEST_SECRET,
  authorization: `Bearer ${tokenFor(user)}`,
});

const send = (s: Server, path: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${s.url}${path}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });

type Visible = { code?: string; message?: string; kind: string; auth?: string };
type Outcome = { status: number; types: string[]; errors: Visible[] };

const visible = (events: SseEvent[]): Visible[] =>
  events
    .filter((e) => e.type === "RUN_ERROR")
    .map((e) => {
      const message = `${e.code ?? ""} ${e.message ?? ""}`.trim();
      return {
        code: e.code,
        message: e.message,
        kind: classifyRunError({ error: new Error(message) }),
        auth: errorCodeIn(e.message ?? ""),
      };
    });

async function outcome(res: Response): Promise<Outcome> {
  const events = parseSse(await res.text());
  return { status: res.status, types: events.map((e) => e.type), errors: visible(events) };
}

async function readUntilText(res: Response, needle: string) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(needle)) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  return { reader, seen };
}

async function rest(reader: ReadableStreamDefaultReader<Uint8Array>, seen: string): Promise<SseEvent[]> {
  const decoder = new TextDecoder();
  let all = seen;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    all += decoder.decode(value, { stream: true });
  }
  return parseSse(all);
}

const thread = (mode: Mode, n: number) => `${mode === "loopback" ? "1" : "2"}${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`;

type Scenario = (s: Server, mode: Mode) => Promise<unknown>;

const SCENARIOS: Record<string, Scenario> = {
  "normal run": async (s, mode) => outcome(await send(s, RUN, runBody(thread(mode, 1)))),

  "stop mid-stream, then a new run": async (s, mode) => {
    const t = thread(mode, 2);
    holds.set(t, new Deferred());
    const { reader, seen } = await readUntilText(await send(s, RUN, runBody(t)), "Hello");
    const stop = await (await send(s, STOP(t), {})).json();
    const stopped = await rest(reader, seen);
    holds.delete(t);
    const next = await outcome(await send(s, RUN, runBody(t)));
    return { stop, stopped: { types: stopped.map((e) => e.type), errors: visible(stopped) }, next };
  },

  "429 busy": async (s, mode) => {
    s.h.policy.refuse = busyError();
    try {
      return await outcome(await send(s, RUN, runBody(thread(mode, 3))));
    } finally {
      s.h.policy.refuse = undefined;
    }
  },

  "429 rate with retryAfter": async (s, mode) => {
    s.h.policy.refuse = rateLimitError(7);
    try {
      return await outcome(await send(s, RUN, runBody(thread(mode, 4))));
    } finally {
      s.h.policy.refuse = undefined;
    }
  },

  "400 invalid input": async (s, mode) => outcome(await send(s, RUN, runBody(thread(mode, 5), { runId: "not a valid run id" }))),

  "claim refused": async (s, mode) => {
    const t = thread(mode, 6);
    await s.h.db.forUser(BOB.id).chats.claim(t, {});
    return outcome(await send(s, RUN, runBody(t)));
  },

  "client disconnect, then connect rejoins": async (s, mode) => {
    const t = thread(mode, 7);
    holds.set(t, new Deferred());
    const client = new AbortController();
    const { reader } = await readUntilText(await send(s, RUN, runBody(t), client.signal), "Hello");
    client.abort();
    await reader.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    const stillRunning = s.h.gate.active;
    const joined = await send(s, CONNECT, runBody(t));
    const { reader: joinReader, seen } = await readUntilText(joined, "Hello");
    holds.get(t)!.resolve();
    const events = await rest(joinReader, seen);
    await waitFor(() => s.h.gate.active === 0);
    return {
      stillRunning,
      connectStatus: joined.status,
      types: events.map((e) => e.type),
      deltas: events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta),
      errors: visible(events),
    };
  },
};

describe("CoreRunAgent parity with the loopback HttpAgent", () => {
  const servers: Partial<Record<Mode, Server>> = {};
  const results: Record<string, Partial<Record<Mode, unknown>>> = {};
  const quiet: Array<{ mockRestore(): void }> = [];

  beforeAll(async () => {
    quiet.push(
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    );
    for (const mode of ["loopback", "in-process"] as const) {
      servers[mode] = await serverFor(mode);
      for (const [name, scenario] of Object.entries(SCENARIOS)) {
        results[name] ??= {};
        results[name][mode] = await scenario(servers[mode]!, mode);
      }
      await servers[mode]!.close();
    }
  }, 60_000);

  afterAll(() => {
    for (const d of holds.values()) d.resolve();
    for (const q of quiet) q.mockRestore();
    if (process.env.PARITY_OUT) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  });

  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: same events and the same client-visible error`, () => {
      expect(results[name]!["in-process"]).toEqual(results[name]!.loopback);
    });
  }

  it("stop ends the run with RUN_ERROR abort and frees the thread", () => {
    const r = results["stop mid-stream, then a new run"]!["in-process"] as {
      stop: unknown;
      stopped: { types: string[]; errors: Visible[] };
      next: Outcome;
    };
    expect(r.stop).toMatchObject({ stopped: true });
    expect(r.stopped.types.at(-1)).toBe("RUN_ERROR");
    expect(r.stopped.errors.at(-1)).toMatchObject({ code: "abort", message: "This operation was aborted" });
    expect(r.next.types).not.toContain("RUN_ERROR");
    expect(r.next.types.at(-1)).toBe("RUN_FINISHED");
  });

  it("a client disconnect does not abort the run and connect receives the remaining events", () => {
    const r = results["client disconnect, then connect rejoins"]!["in-process"] as {
      stillRunning: number;
      types: string[];
      deltas: string[];
    };
    expect(r.stillRunning).toBe(1);
    expect(r.deltas.at(-1)).toBe(" world");
    expect(r.types.at(-1)).toBe("RUN_FINISHED");
  });

  it("refusals reach the client as the same HTTP error text", () => {
    const rate = results["429 rate with retryAfter"]!["in-process"] as Outcome;
    expect(rate.errors[0]?.message).toContain("HTTP 429");
    expect(rate.errors[0]?.auth).toBe("rate_limited");
    const invalid = results["400 invalid input"]!["in-process"] as Outcome;
    expect(invalid.errors[0]?.message).toContain("HTTP 400");
  });
});
