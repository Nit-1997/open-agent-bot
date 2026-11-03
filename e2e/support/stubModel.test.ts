import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import {
  REPORT_MARKER,
  STUB_API_KEY,
  STUB_MODEL,
  STUB_REPORT_TITLE,
  type StubModel,
  startStubModel,
  stubPortProblem,
  stubReport,
} from "./stubModel.ts";

const AUTH = { authorization: `Bearer ${STUB_API_KEY}` };

const PORT = 18961;

type Chunk = {
  choices: Array<{
    delta?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
    finish_reason: string | null;
  }>;
  usage?: object;
};

async function stream(url: string, messages: object[]): Promise<{ chunks: Chunk[]; done: boolean }> {
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify({ model: STUB_MODEL, stream: true, stream_options: { include_usage: true }, messages }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  const lines = (await res.text()).split("\n").filter((l) => l.startsWith("data: "));
  const done = lines.at(-1) === "data: [DONE]";
  return { chunks: lines.filter((l) => l !== "data: [DONE]").map((l) => JSON.parse(l.slice(6)) as Chunk), done };
}

const contents = (chunks: Chunk[]) => chunks.map((c) => c.choices[0]?.delta?.content).filter((s): s is string => !!s);

describe("stub model port guard", () => {
  for (const port of [3000, 8000, 17999, 20000, 18341.5]) {
    it(`refuses port ${port}`, async () => {
      assert.match(stubPortProblem(port) ?? "", /18000-19999/);
      await assert.rejects(startStubModel({ port }), /18000-19999/);
    });
  }

  it("accepts 18341", () => assert.equal(stubPortProblem(18341), undefined));
});

describe("stub model", () => {
  let stub: StubModel;

  before(async () => {
    stub = await startStubModel({ port: PORT, tokenMs: 1, longTokens: 30 });
  });

  after(() => stub.close());

  it("binds 127.0.0.1 by default", () => {
    assert.equal((stub.server.address() as AddressInfo).address, "127.0.0.1");
    assert.equal(stub.url, `http://127.0.0.1:${PORT}/v1`);
  });

  it("lists stub-1 at /v1/models", async () => {
    const res = await fetch(`${stub.url}/models`, { headers: AUTH });
    assert.equal(res.status, 200);
    assert.deepEqual(
      ((await res.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id),
      [STUB_MODEL],
    );
  });

  it("streams a deterministic reply in several chunks, then stop, usage and [DONE]", async () => {
    const first = await stream(stub.url, [{ role: "user", content: "hello" }]);
    const second = await stream(stub.url, [{ role: "user", content: "hello" }]);
    assert.ok(contents(first.chunks).length >= 5);
    assert.equal(contents(first.chunks).join(""), contents(second.chunks).join(""));
    assert.ok(first.chunks.some((c) => c.choices[0]?.finish_reason === "stop"));
    assert.ok(first.chunks.some((c) => c.usage));
    assert.equal(first.done, true);
  });

  it("streams a long reply for [e2e:long]", async () => {
    const { chunks } = await stream(stub.url, [{ role: "user", content: [{ type: "text", text: "write a lot [e2e:long]" }] }]);
    assert.equal(contents(chunks).length, 30);
  });

  it("scripts a create_artifact tool call when the prompt has the report marker", async () => {
    const { chunks, done } = await stream(stub.url, [{ role: "user", content: `Field notes lh42 ${REPORT_MARKER}` }]);
    const call = chunks.flatMap((c) => c.choices[0]?.delta?.tool_calls ?? [])[0];
    assert.equal(call?.function.name, "create_artifact");
    const args = JSON.parse(call?.function.arguments ?? "{}") as { title: string; html: string };
    assert.equal(args.title, "Field notes lh42");
    assert.match(args.html, /^<!doctype html>.*<h1>Field notes lh42<\/h1>/);
    assert.ok(chunks.some((c) => c.choices[0]?.finish_reason === "tool_calls"));
    assert.equal(done, true);
  });

  it("answers with text after the tool result", async () => {
    const { chunks } = await stream(stub.url, [
      { role: "user", content: `make a report ${REPORT_MARKER}` },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "create_artifact", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "artifact a1 created" },
    ]);
    assert.match(contents(chunks).join(""), /report is ready/);
  });

  it("answers non-streaming requests", async () => {
    const res = await fetch(`${stub.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ model: STUB_MODEL, messages: [{ role: "user", content: "title this" }] }),
    });
    const body = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    assert.ok(body.choices[0].message.content.length > 0);
  });

  it("answers 404 elsewhere", async () => assert.equal((await fetch(`http://127.0.0.1:${PORT}/admin`)).status, 404));

  it("lists models without a key, so reachability checks need none", async () =>
    assert.equal((await fetch(`${stub.url}/models`)).status, 200));

  it("refuses completions without its API key", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`${stub.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ authorization: "Bearer wrong" })).status, 401);
  });
});

describe("stub report", () => {
  it("titles the report from the prompt without the marker, escaped", () => {
    const report = stubReport(`  <b>Notes</b>   ${REPORT_MARKER} `);
    assert.equal(report.title, "<b>Notes</b>");
    assert.match(report.html, /<h1>&#60;b&#62;Notes&#60;\/b&#62;<\/h1>/);
  });

  it("falls back to a fixed title", () => assert.equal(stubReport(REPORT_MARKER).title, STUB_REPORT_TITLE));
});

describe("stub model bind address", () => {
  it("binds the address it is given", async () => {
    const stub = await startStubModel({ port: PORT + 1, bind: "0.0.0.0" });
    try {
      assert.equal((stub.server.address() as AddressInfo).address, "0.0.0.0");
    } finally {
      await stub.close();
    }
  });
});
