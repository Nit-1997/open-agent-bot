import { describe, expect, it } from "vitest";
import probes from "./fixtures/encoded-probes.json" with { type: "json" };
import { createBff } from "../src/index.ts";
import { segmentsOf } from "../src/params.ts";
import { AGENT, deps, fakeAgent, request } from "./support.ts";

const CHAT = "d78e1a64-ea58-4699-bc7f-9e0afae086d7";
const REPORT = "e2eReport001";
const fill = (s: string) => s.replaceAll("<CHAT>", CHAT.toUpperCase()).replaceAll("<chat>", CHAT).replaceAll("<report>", REPORT);

const NEXT_SERVED_A_PAGE = 200;

describe("segmentsOf", () => {
  it.each([
    ["/api", { kind: "segments", segments: [] }],
    ["/api/chats", { kind: "segments", segments: ["chats"] }],
    ["/api/providers/openai%2Fkey", { kind: "segments", segments: ["providers", "openai/key"] }],
    ["/api/chats/%41bc", { kind: "segments", segments: ["chats", "Abc"] }],
    ["/api/settings/brave-se%252Frch", { kind: "segments", segments: ["settings", "brave-se%2Frch"] }],
    ["/apifoo", { kind: "outside" }],
    ["/apifoo/chats", { kind: "outside" }],
    ["/", { kind: "outside" }],
    ["/other/api/chats", { kind: "outside" }],
    ["/api/", { kind: "redirect", location: "/api" }],
    ["/api/chats/", { kind: "redirect", location: "/api/chats" }],
    ["/api//chats", { kind: "redirect", location: "/api/chats" }],
    ["/api/chats//x//", { kind: "redirect", location: "/api/chats/x" }],
    ["/api/chats/x%E0%A4%A", { kind: "malformed" }],
    ["/api/chats/%", { kind: "malformed" }],
  ] as const)("%s", (pathname, expected) => {
    expect(segmentsOf(pathname, "/api")).toEqual(expected);
  });

  it("honours another basePath exactly", () => {
    expect(segmentsOf("/v1/api/x", "/v1/api")).toEqual({ kind: "segments", segments: ["x"] });
    expect(segmentsOf("/v1/apix", "/v1/api")).toEqual({ kind: "outside" });
  });
});

describe("baseline 8: encoded paths probed against real Next", () => {
  it.each(probes.rows.map((r) => [r.name, r] as const))("%s", async (_name, row) => {
    const agent = fakeAgent(() => Response.json({ error: row.error }, { status: row.status }));
    const res = await createBff(deps({ fetch: agent.fetch }))(request(fill(row.path)));
    expect(agent.seen.map((s) => `${s.method} ${s.url.slice(AGENT.length)}`)).toEqual(row.upstream.map(fill));
    if (row.status === NEXT_SERVED_A_PAGE && row.upstream.length === 0) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
      return;
    }
    expect(res.status).toBe(row.status);
    if (row.status === 308) expect(res.headers.get("location")?.startsWith(fill(row.error ?? "?"))).toBe(true);
    else if (row.status === 500) expect(await res.text()).toBe(row.error);
    else expect((await res.json()).error).toBe(row.error);
  });
});
