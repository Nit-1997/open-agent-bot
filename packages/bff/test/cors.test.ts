import { describe, expect, it } from "vitest";
import { createBff, localAuth } from "../src/index.ts";
import { ROUTES } from "../src/routes.ts";
import { CHAT, deps, fakeAgent, signedIn } from "./support.ts";

const ORIGIN = "http://127.0.0.1:18330";
const EVIL = "http://evil.example";
const SECRET = "0123456789abcdef".repeat(4);
const LOCAL = { appOrigin: [ORIGIN, "http://localhost:18330"], allowedHosts: ["127.0.0.1:18330", "localhost:18330"] };

const SAMPLES: Record<string, string> = {
  chats: "/api/chats",
  "chats/:id": `/api/chats/${CHAT}`,
  "chats/:id/messages": `/api/chats/${CHAT}/messages`,
  reports: "/api/reports",
  "reports/:id": "/api/reports/abcdefghijkl",
  search: "/api/search?q=hello",
  models: "/api/models",
  "onboarding/options": "/api/onboarding/options",
  places: "/api/places?q=paris",
  profile: "/api/profile",
  "providers/*": "/api/providers/openrouter/key",
  "settings/*": "/api/settings/brave-search/key",
  "artifacts/:id": "/api/artifacts/abcdefghijkl",
  "copilotkit/*": "/api/copilotkit/info",
};

const LEAKY = {
  "access-control-allow-origin": "*",
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, PUT, DELETE",
  "access-control-allow-headers": "*",
};

const leakyAgent = () =>
  fakeAgent(() => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", ...LEAKY } }));

const corsHeaders = (res: Response) => [...res.headers.keys()].filter((k) => k.startsWith("access-control-"));

const cases = ROUTES.flatMap((route) => {
  const path = SAMPLES[route.pattern.join("/")];
  return [...route.methods, "OPTIONS"].map((method) => [method, path] as const);
});

const configs = [
  ["hosted", () => deps({ auth: signedIn })],
  ["local", () => deps({ ...LOCAL, auth: localAuth({ secret: SECRET }) })],
] as const;

describe("no CORS", () => {
  it("has a sample path for every route", () => {
    for (const route of ROUTES) expect(SAMPLES[route.pattern.join("/")], route.pattern.join("/")).toBeDefined();
  });

  for (const [label, base] of configs) {
    describe(label, () => {
      it.each(cases)("%s %s carries no Access-Control-* header", async (method, path) => {
        const agent = leakyAgent();
        const bff = createBff({ ...base(), fetch: agent.fetch });
        for (const origin of [EVIL, ORIGIN]) {
          const headers: Record<string, string> = {
            host: "127.0.0.1:18330",
            origin,
            "access-control-request-method": "PUT",
            "access-control-request-headers": "content-type",
          };
          const body = ["GET", "HEAD", "OPTIONS"].includes(method) ? undefined : "{}";
          const res = await bff(new Request(`${ORIGIN}${path}`, { method, headers, body }));
          expect(corsHeaders(res), `${method} ${path} from ${origin} → ${res.status}`).toEqual([]);
          if (method === "OPTIONS") expect(res.status).toBe(405);
        }
      });

      it.each(["/api/x", "/api/chats/x/y/z", "/api"])("OPTIONS %s → 404 with no Access-Control-* header", async (path) => {
        const bff = createBff({ ...base(), fetch: leakyAgent().fetch });
        const res = await bff(
          new Request(`${ORIGIN}${path}`, {
            method: "OPTIONS",
            headers: { host: "127.0.0.1:18330", origin: EVIL, "access-control-request-method": "GET" },
          }),
        );
        expect(res.status).toBe(404);
        expect(corsHeaders(res)).toEqual([]);
      });
    });
  }
});
