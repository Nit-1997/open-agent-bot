import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALICE } from "../fixtures/users.js";
import { copilotHarness, fakeRun } from "./harness.js";

type Info = Record<string, unknown> & { agents: Record<string, Record<string, unknown>> };

const WEB_INFO = JSON.parse(readFileSync(join(import.meta.dirname, "../fixtures/info-web.json"), "utf8")) as Info;

function comparable(info: Info): Info {
  const { basePath: _, ...rest } = info;
  const agents = Object.fromEntries(Object.entries(info.agents).map(([id, { className: __, basePath: ___, ...agent }]) => [id, agent]));
  return { ...rest, agents };
}

describe("copilotkit info", () => {
  it("equals the web runtime's info modulo basePath and the server-side class name", async () => {
    const h = await copilotHarness({ handle: fakeRun() });
    const res = await h.call(ALICE, "/copilotkit/info");
    expect(res.status).toBe(200);
    const info = (await res.json()) as Info;
    expect(comparable(info)).toEqual(comparable(WEB_INFO));
    expect(JSON.stringify(info)).not.toContain("/copilotkit");
    expect(JSON.stringify(WEB_INFO)).not.toContain("/api/copilotkit");
    expect(Object.keys(info.agents)).toEqual(["openagent"]);
  });
});
