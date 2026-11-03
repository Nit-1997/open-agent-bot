import { describe, expect, it } from "vitest";
import { classify } from "../src/main/classify.ts";
import type { ContainerInspect } from "../src/main/compose.ts";
import type { StackFile } from "../src/main/launchToken.ts";
import type { ServicePins } from "../src/main/services.ts";

const STAGED = "/Users/tester/Library/Application Support/Open Agent/stack/docker-compose.yml";
const TOKEN = "a".repeat(64);
const IDS = { agent: `sha256:${"1".repeat(64)}`, search: `sha256:${"2".repeat(64)}` };
const pins: ServicePins = {
  kind: "release",
  version: "1.4.0",
  composeSha256: "x",
  images: {
    agent: `ghcr.io/nit-1997/open-agent@sha256:${"a".repeat(64)}`,
    search: `ghcr.io/nit-1997/open-agent-search@sha256:${"b".repeat(64)}`,
  },
  pull: true,
};
const stored: StackFile = { schema: 1, project: "open-agent", port: 41100, launchToken: TOKEN, tokenCreatedAt: "t" };
const health = { ok: true, app: "open-agent", version: "1.4.0" };

const c = (service: string, o: Partial<ContainerInspect> = {}): ContainerInspect => ({
  id: service,
  service,
  image: service === "search" ? pins.images.search : pins.images.agent,
  imageId: service === "search" ? IDS.search : IDS.agent,
  configFiles: STAGED,
  workingDir: "/Users/tester/Library/Application Support/Open Agent/stack",
  status: "running",
  exitCode: 0,
  health: "healthy",
  restartCount: 0,
  ...(service === "agent" ? { token: TOKEN, port: 41100 } : {}),
  ...o,
});
const all = (o: Partial<Record<string, Partial<ContainerInspect>>> = {}) => ["agent", "search", "renderer"].map((s) => c(s, o[s]));
const run = (containers: ContainerInspect[], extra: Partial<Parameters<typeof classify>[0]> = {}) =>
  classify({ containers, stored, stagedComposePath: STAGED, pins, expectedImageIds: IDS, health, ...extra });

describe("classify (D10)", () => {
  it("no containers → none", () => expect(run([])).toEqual({ kind: "none", reasons: [] }));
  it("everything matches and is healthy → oursRunning", () => expect(run(all())).toEqual({ kind: "oursRunning", reasons: [] }));

  it("stopped by the shell (0, 137, 143, created) → oursStopped", () => {
    const stopped = all({
      agent: { status: "exited", exitCode: 0 },
      search: { status: "exited", exitCode: 143 },
      renderer: { status: "created", exitCode: 137 },
    });
    expect(run(stopped, { health: undefined })).toEqual({ kind: "oursStopped", reasons: [] });
  });

  it("a repo-file stack → foreign; a moved .app keeps the staged path → still ours", () => {
    expect(run(all({ agent: { configFiles: "/Users/tester/open-agent-bot/docker-compose.yml" } }))).toEqual({
      kind: "foreign",
      reasons: ["config_files"],
    });
    expect(run(all()).kind).toBe("oursRunning");
  });

  it("a different or missing token → oursStale(token_mismatch)", () => {
    expect(run(all({ agent: { token: "b".repeat(64) } }))).toEqual({ kind: "oursStale", reasons: ["token_mismatch"] });
    expect(run(all(), { stored: undefined })).toEqual({ kind: "oursStale", reasons: ["token_mismatch", "port_mismatch"] });
  });

  it("search and renderer up, the agent missing or exited → oursStale(partial)", () => {
    const missing = run([c("search"), c("renderer")]);
    expect(missing.kind).toBe("oursStale");
    expect(missing.reasons).toContain("partial(agent missing)");
    const exited = run(all({ agent: { status: "exited", exitCode: 1 } }), { health: undefined });
    expect(exited).toEqual({ kind: "oursStale", reasons: ["partial(agent exited 1)"] });
  });

  it("a retagged image (same tag, other .Image ID) → oursStale", () => {
    expect(run(all({ agent: { imageId: `sha256:${"9".repeat(64)}` } }))).toEqual({
      kind: "oursStale",
      reasons: ["image_id_mismatch(agent)"],
    });
    expect(run(all(), { expectedImageIds: { search: IDS.search } }).reasons).toEqual([
      "image_id_mismatch(agent)",
      "image_id_mismatch(renderer)",
    ]);
  });

  it("another image, port, version or an unhealthy agent → oursStale", () => {
    expect(run(all({ search: { image: "x" } })).reasons).toEqual(["image_mismatch(search)"]);
    expect(run(all({ agent: { port: 41101 } })).reasons).toEqual(["port_mismatch"]);
    expect(run(all(), { health: { ok: true, app: "open-agent", version: "1.3.0" } }).reasons).toEqual(["health_version"]);
    expect(run(all(), { health: undefined }).reasons).toEqual(["health"]);
    expect(run(all({ agent: { health: "unhealthy" } })).reasons).toEqual(["unhealthy(agent unhealthy)"]);
  });

  it("a refusal exit code present → oursStale", () => {
    const r = run(all({ agent: { status: "exited", exitCode: 82 } }), { health: undefined });
    expect(r).toEqual({ kind: "oursStale", reasons: ["refused(82)"] });
  });

  it("dev pins skip the version check", () => {
    expect(run(all(), { pins: { ...pins, version: "dev" }, health: { ok: true, app: "open-agent", version: "x" } }).kind).toBe(
      "oursRunning",
    );
  });
});
