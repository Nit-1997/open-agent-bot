import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_LIMIT_BYTES, RUN_BODY_LIMIT_BYTES } from "../../src/app.js";
import { readThreadBody } from "../../src/copilot/threadBody.js";
import { TEST_SECRET } from "../fixtures/config.js";
import { tokenFor } from "../fixtures/app.js";
import { ALICE } from "../fixtures/users.js";
import { CONNECT, type CopilotHarness, copilotHarness, fakeRun, RUN, runBody, T1 } from "../copilot/harness.js";

vi.mock("../../src/copilot/threadBody.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/copilot/threadBody.js")>();
  return { ...actual, readThreadBody: vi.fn(actual.readThreadBody) };
});

function sized(bytes: number, threadId = T1): string {
  const empty = JSON.stringify(runBody(threadId, { forwardedProps: { pad: "" } }));
  const pad = bytes - empty.length;
  if (pad < 0) throw new Error("body too small for its envelope");
  const body = JSON.stringify(runBody(threadId, { forwardedProps: { pad: "x".repeat(pad) } }));
  if (body.length !== bytes) throw new Error(`sized body is ${body.length}, not ${bytes}`);
  return body;
}

function chunked(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, at + 64 * 1024));
      at += 64 * 1024;
    },
  });
}

const headers = {
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-agent-secret": TEST_SECRET,
  authorization: `Bearer ${tokenFor(ALICE)}`,
};

async function send(h: CopilotHarness, path: string, body: string, mode: "length" | "chunked") {
  const init =
    mode === "length"
      ? { method: "POST", headers: { ...headers, "content-length": String(body.length) }, body }
      : ({ method: "POST", headers, body: chunked(body), duplex: "half" } as RequestInit);
  const res = await h.app.request(path, init);
  const text = await res.text();
  return { status: res.status, text };
}

let quiet: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  vi.mocked(readThreadBody).mockClear();
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

describe("copilotkit body limits", () => {
  it.each([["length"], ["chunked"]] as const)("accepts a 4 MiB run body and refuses one byte more (%s)", async (mode) => {
    const h = await copilotHarness({ handle: fakeRun() });
    const ok = await send(h, RUN, sized(RUN_BODY_LIMIT_BYTES), mode);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("RUN_FINISHED");
    vi.mocked(readThreadBody).mockClear();
    const over = await send(h, RUN, sized(RUN_BODY_LIMIT_BYTES + 1), mode);
    expect(over.status).toBe(413);
    expect(JSON.parse(over.text)).toMatchObject({ error: "too_large" });
    expect(readThreadBody).not.toHaveBeenCalled();
  });

  it.each([["length"], ["chunked"]] as const)("accepts a 1 MiB connect body and refuses one byte more (%s)", async (mode) => {
    const h = await copilotHarness({ handle: fakeRun() });
    await h.db.forUser(ALICE.id).chats.claim(T1, {});
    const ok = await send(h, CONNECT, sized(BODY_LIMIT_BYTES), mode);
    expect(ok.status).toBe(200);
    vi.mocked(readThreadBody).mockClear();
    const over = await send(h, CONNECT, sized(BODY_LIMIT_BYTES + 1), mode);
    expect(over.status).toBe(413);
    expect(readThreadBody).not.toHaveBeenCalled();
    expect(h.slots.count(ALICE.id)).toBe(0);
  });

  it.each([[`${RUN}/extra`], ["/copilotkit/agent/other/run"], ["/copilotkit/agent/openagent/run/"]])(
    "gives %s only the 1 MiB limit",
    async (path) => {
      const h = await copilotHarness({ handle: fakeRun() });
      for (const mode of ["length", "chunked"] as const) {
        expect((await send(h, path, sized(BODY_LIMIT_BYTES + 1), mode)).status, mode).toBe(413);
        expect((await send(h, path, sized(BODY_LIMIT_BYTES), mode)).status, mode).toBe(404);
      }
      expect(readThreadBody).not.toHaveBeenCalled();
    },
  );
});
