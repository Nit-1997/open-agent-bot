import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT,
  type CopilotHarness,
  copilotHarness,
  fakeRun,
  RUN,
  runBody,
  STOP,
  T1,
} from "../../../../packages/core/test/copilot/harness.js";
import { CALLERS, type Caller, EXTRA_ACCOUNTS, matrixSeams } from "../fixtures/callers.js";
import { type HostedHarness, makeHostedApp } from "../fixtures/hostedApp.js";

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

async function cellFor(h: CopilotHarness | HostedHarness, caller: Caller, probe: Probe, thread: string): Promise<Cell> {
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
    const h = await copilotHarness({ handle: fakeRun() }, (over) => makeHostedApp({ ...over, seams: matrixSeams() }));
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
    const h = await copilotHarness({ handle: fakeRun() }, (over) => makeHostedApp({ ...over, seams: matrixSeams() }));
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
