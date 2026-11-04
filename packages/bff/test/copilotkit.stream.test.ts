import { afterEach, describe, expect, it, vi } from "vitest";
import { createBff } from "../src/index.ts";
import { APP, CHAT, deps, fakeAgent, type Seen } from "./support.ts";

const RUN = `${APP}/api/copilotkit/agent/openagent/run`;
const encoder = new TextEncoder();

function held() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return { stream, push: (text: string) => controller.enqueue(encoder.encode(text)), close: () => controller.close() };
}

const run = (signal?: AbortSignal) =>
  new Request(RUN, {
    method: "POST",
    headers: { origin: APP, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ threadId: CHAT }),
    signal,
  });

const sse = (body: ReadableStream<Uint8Array>) => new Response(body, { headers: { "content-type": "text/event-stream" } });

const neverAnswers = (seen: Seen) =>
  new Promise<Response>((_resolve, reject) => {
    seen.signal?.addEventListener("abort", () => reject(seen.signal?.reason));
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("copilot streaming proxy", () => {
  it("aborts the upstream fetch when the client aborts mid-stream", async () => {
    const upstream = held();
    const agent = fakeAgent(() => sse(upstream.stream));
    const client = new AbortController();
    const res = await createBff(deps({ fetch: agent.fetch }))(run(client.signal));
    expect(res.status).toBe(200);
    const signal = agent.seen[0].signal;
    expect(signal?.aborted).toBe(false);
    client.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("aborts the upstream fetch when the client aborts before headers", async () => {
    const agent = fakeAgent(neverAnswers);
    const client = new AbortController();
    const pending = createBff(deps({ fetch: agent.fetch }))(run(client.signal));
    await vi.waitFor(() => expect(agent.seen).toHaveLength(1));
    client.abort();
    const res = await pending;
    expect(agent.seen[0].signal?.aborted).toBe(true);
    expect(res.status).toBe(502);
  });

  it("the header timeout fires when no headers arrive", async () => {
    vi.useFakeTimers();
    const agent = fakeAgent(neverAnswers);
    const pending = createBff(deps({ fetch: agent.fetch, timeoutMs: 1000 }))(run());
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.seen).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(agent.seen[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "agent_unreachable" });
  });

  it("the header timeout never fires during a long stream", async () => {
    vi.useFakeTimers();
    const upstream = held();
    const agent = fakeAgent(() => sse(upstream.stream));
    const res = await createBff(deps({ fetch: agent.fetch, timeoutMs: 1000 }))(run());
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(agent.seen[0].signal?.aborted).toBe(false);
    upstream.push("data: late\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: late\n\n");
    upstream.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("is unbuffered: the first chunk is readable before the upstream closes", async () => {
    const upstream = held();
    const agent = fakeAgent(() => sse(upstream.stream));
    const res = await createBff(deps({ fetch: agent.fetch }))(run());
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    upstream.push('data: {"type":"RUN_STARTED"}\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"type":"RUN_STARTED"}\n\n');
    upstream.close();
  });

  it("passes the agent's : ping heartbeat through unchanged", async () => {
    const upstream = held();
    const agent = fakeAgent(() => sse(upstream.stream));
    const res = await createBff(deps({ fetch: agent.fetch }))(run());
    upstream.push("data: a\n\n");
    upstream.push(": ping\n\n");
    upstream.push("data: b\n\n");
    upstream.close();
    expect(await res.text()).toBe("data: a\n\n: ping\n\ndata: b\n\n");
  });

  it("streams the request body through to the agent", async () => {
    const agent = fakeAgent(() => sse(held().stream));
    await createBff(deps({ fetch: agent.fetch }))(run());
    expect(agent.seen[0].body).toBe(JSON.stringify({ threadId: CHAT }));
  });
});
