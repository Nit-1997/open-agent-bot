import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Compose, type ComposeVars, type ContainerInspect, createCompose, type ServiceState } from "../src/main/compose.ts";
import { createDockerCli, type DockerCli, dockerEnv, dockerPath, locateDocker, probeDocker } from "../src/main/dockerCli.ts";
import { resolveEndpoint } from "../src/main/endpoint.ts";
import { currentUid } from "../src/main/fsProbe.ts";
import { silentLog } from "../src/main/logger.ts";
import { stageStack } from "../src/main/stackFiles.ts";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const REAL = process.env.DESKTOP_REAL_DOCKER === "1";

type Target = { name: string; cli: DockerCli; compose: Compose; env: Record<string, string>; cleanup: () => Promise<void> };

const shapeOf = (o: object) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, typeof v])
      .sort(),
  );

function stagedDir(root: string): string {
  const bundled = join(root, "bundled");
  mkdirSync(join(bundled, "local/renderer"), { recursive: true });
  for (const f of ["docker-compose.yml", "local/renderer/seccomp.json"]) writeFileSync(join(bundled, f), readRepo(f));
  const staged = join(root, "stack");
  stageStack({ bundledDir: bundled, stagedDir: staged });
  return staged;
}
const readRepo = (f: string) => readFileSync(join(REPO, f));

function makeTarget(
  name: string,
  cliPath: string,
  vars: ComposeVars,
  project: string,
  stackDir: string,
  cleanup: () => Promise<void>,
): Target {
  const cli = createDockerCli(cliPath, { log: silentLog, tokens: () => [vars.token] });
  const path = dockerPath(cliPath);
  const envFor = (v?: ComposeVars) => dockerEnv(path, process.env, v);
  return { name, cli, env: envFor(), compose: createCompose(cli, { project, stackDir, vars }, envFor), cleanup };
}

async function fakeTarget(): Promise<Target> {
  const root = mkdtempSync(join(tmpdir(), "oab-contract-fake-"));
  const home = join(root, "home");
  mkdirSync(join(home, "bin"), { recursive: true });
  const bin = join(home, "bin/docker");
  writeFileSync(
    bin,
    `#!${process.execPath}\nimport(${JSON.stringify(join(APP, "test/fake-docker/docker.mjs"))}).then((m) => m.main(${JSON.stringify(home)}, process.argv.slice(2)));\n`,
    {
      mode: 0o755,
    },
  );
  writeFileSync(join(home, "scenario.json"), JSON.stringify({ endpoint: "missing" }));
  const vars: ComposeVars = {
    port: 18456,
    token: randomBytes(32).toString("hex"),
    agentImage: "oab-contract-agent:x",
    searchImage: "oab-contract-search:x",
    dataVolume: "oab-contract-fake-data",
    keysVolume: "oab-contract-fake-keys",
  };
  const t = makeTarget("fake", bin, vars, "oab-contract-fake", stagedDir(root), async () => {
    await t.compose.down({ volumes: true });
    rmSync(root, { recursive: true, force: true });
  });
  const up = await t.compose.up({ forceRecreate: false });
  expect(up.code, up.stderr).toBe(0);
  return t;
}

async function realTarget(): Promise<Target> {
  const loc = locateDocker({ test: false });
  if (loc.kind !== "found") throw new Error("no trusted docker CLI");
  const agentImage = process.env.DESKTOP_REAL_AGENT_IMAGE ?? "";
  const searchImage = process.env.DESKTOP_REAL_SEARCH_IMAGE ?? "";
  if (!agentImage || !searchImage)
    throw new Error(
      "DESKTOP_REAL_AGENT_IMAGE and DESKTOP_REAL_SEARCH_IMAGE must name locally built agent and search images (for example oab-dev-agent:dev and oab-dev-search:dev)",
    );
  const root = mkdtempSync(join(tmpdir(), "oab-contract-real-"));
  const project = process.env.DESKTOP_REAL_PROJECT ?? "oab-factory-m4-2-contract";
  if (!/^oab-[a-z0-9-]+$/.test(project)) throw new Error("the real contract project must be oab-*");
  const vars: ComposeVars = {
    port: Number(process.env.DESKTOP_REAL_PORT ?? 18452),
    token: randomBytes(32).toString("hex"),
    agentImage,
    searchImage,
    dataVolume: `${project}-data`,
    keysVolume: `${project}-keys`,
  };
  const t = makeTarget("real", loc.path, vars, project, stagedDir(root), async () => {
    await t.compose.down({ volumes: true });
    await t.cli.run(["volume", "rm", vars.dataVolume, vars.keysVolume], { env: t.env });
    rmSync(root, { recursive: true, force: true });
  });
  const up = await t.compose.up({ forceRecreate: false });
  expect(up.code, up.stderr).toBe(0);
  return t;
}

const targets: Target[] = [];
beforeAll(async () => {
  targets.push(await fakeTarget());
  if (REAL) targets.push(await realTarget());
}, 300_000);
afterAll(async () => {
  for (const t of targets) await t.cleanup();
}, 180_000);

const byName = (name: string) => targets.find((t) => t.name === name);
const ps = async (t: Target) => (await t.compose.ps()) ?? [];
const inspectAgent = async (t: Target): Promise<ContainerInspect | undefined> => {
  const rows = await ps(t);
  const agent = rows.find((r: ServiceState) => r.service === "agent");
  return agent ? (await t.compose.inspect([agent.id]))[0] : undefined;
};

describe.each(["fake", ...(REAL ? ["real"] : [])])("compose contract (%s)", (name) => {
  it("ps rows have the parsed shape for all three services", async () => {
    const t = byName(name)!;
    const rows = await ps(t);
    expect(rows.map((r) => r.service).sort()).toEqual(["agent", "renderer", "search"]);
    for (const r of rows)
      expect(shapeOf(r)).toEqual({
        exitCode: "number",
        health: "string",
        id: "string",
        image: "string",
        name: "string",
        service: "string",
        state: "string",
      });
  });

  it("inspect of the agent has every field classify needs", async () => {
    const t = byName(name)!;
    const agent = await inspectAgent(t);
    expect(agent).toBeDefined();
    expect(agent?.configFiles).toBe(join(t.compose.spec.stackDir, "docker-compose.yml"));
    expect(agent?.token).toBe(t.compose.spec.vars.token);
    expect(agent?.port).toBe(t.compose.spec.vars.port);
    expect(agent?.dataVolume).toBe(t.compose.spec.vars.dataVolume);
    expect(agent?.keysVolume).toBe(t.compose.spec.vars.keysVolume);
    expect(agent?.imageId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(agent?.image).toBe(t.compose.spec.vars.agentImage);
    expect(shapeOf(agent ?? {})).toMatchObject({
      configFiles: "string",
      imageId: "string",
      status: "string",
      exitCode: "number",
      restartCount: "number",
      token: "string",
      port: "number",
    });
  });

  it("port prints 127.0.0.1:<port>", async () => {
    const t = byName(name)!;
    expect(await t.compose.port()).toBe(`127.0.0.1:${t.compose.spec.vars.port}`);
  });

  it("logs lines carry the <service>-1 | prefix", async () => {
    const t = byName(name)!;
    const text = await t.compose.logs({ services: ["agent"], tail: 20, timestamps: true });
    const lines = text.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^agent-1\s+\| \d{4}-\d{2}-\d{2}T/);
  });

  it("version and compose version parse", async () => {
    const t = byName(name)!;
    const probe = await probeDocker(t.cli, t.env);
    expect(probe.kind).toBe("ok");
    if (name === "real") {
      expect(probe).toMatchObject({ compose: expect.stringMatching(/^\d+\.\d+\.\d+/), engine: "docker-desktop", context: "desktop-linux" });
      expect(await resolveEndpoint(t.cli, t.env, currentUid(), { allowSystemSocket: false })).toMatchObject({ ok: true });
    }
  });
});
