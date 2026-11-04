import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeArgs, createCompose, parseInspect, parsePs } from "../src/main/compose.ts";
import type { DockerCli } from "../src/main/dockerCli.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures/docker");
const STACK = "/Users/tester/Library/Application Support/Open Agent/stack";
const PREFIX = [
  "compose",
  "-p",
  "open-agent",
  "-f",
  `${STACK}/docker-compose.yml`,
  "--project-directory",
  STACK,
  "--env-file",
  "/dev/null",
  "--ansi",
  "never",
];
const vars = {
  port: 41100,
  token: "a".repeat(64),
  agentImage: "img-a",
  searchImage: "img-s",
  dataVolume: "open-agent-data",
  keysVolume: "open-agent-keys",
};

function recorder(stdout = "") {
  const calls: { args: string[]; env: Record<string, string> }[] = [];
  const cli: DockerCli = {
    path: "/usr/local/bin/docker",
    run: async (args, o) => {
      calls.push({ args: [...args], env: o.env });
      return { code: 0, stdout, stderr: "", ms: 1 };
    },
  };
  return { cli, calls };
}

describe("compose argv (D11)", () => {
  it("has the fixed prefix", () => {
    expect(composeArgs({ project: "open-agent", stackDir: STACK }, ["ps"])).toEqual([...PREFIX, "ps"]);
  });

  it("every method's exact argv; build never appears; every up has --no-build --pull never", async () => {
    const { cli, calls } = recorder("[]");
    const c = createCompose(
      cli,
      { project: "open-agent", stackDir: STACK, vars },
      (v): Record<string, string> => (v ? { OPEN_AGENT_PORT: String(v.port) } : {}),
    );
    await c.ps();
    await c.up({ forceRecreate: false });
    await c.up({ forceRecreate: true });
    await c.start();
    await c.stop();
    await c.stop("agent");
    await c.down({ volumes: false });
    await c.down({ volumes: true });
    await c.logs({ services: ["agent"], tail: 200, timestamps: false });
    await c.logs({ services: ["agent", "search", "renderer"], tail: 500, timestamps: true });
    await c.port();
    await c.inspect(["abc", "def"]);
    expect(calls.map((x) => x.args)).toEqual([
      [...PREFIX, "ps", "-a", "--format", "json"],
      [...PREFIX, "up", "-d", "--no-build", "--pull", "never", "--remove-orphans"],
      [...PREFIX, "up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--remove-orphans"],
      [...PREFIX, "start"],
      [...PREFIX, "stop"],
      [...PREFIX, "stop", "agent"],
      [...PREFIX, "down", "--remove-orphans"],
      [...PREFIX, "down", "-v", "--remove-orphans"],
      [...PREFIX, "logs", "--no-color", "--tail", "200", "agent"],
      [...PREFIX, "logs", "--no-color", "--timestamps", "--tail", "500", "agent", "search", "renderer"],
      [...PREFIX, "port", "agent", "3000"],
      ["inspect", "abc", "def"],
    ]);
    for (const x of calls) expect(x.args).not.toContain("build");
    for (const x of calls.filter((y) => y.args.includes("up"))) expect(x.args.join(" ")).toContain("--no-build --pull never");
    expect(calls[0]?.env).toEqual({ OPEN_AGENT_PORT: "41100" });
    expect(calls[11]?.env).toEqual({});
  });
});

describe("parsing recorded outputs (Compose 5.1.1)", () => {
  it("ps NDJSON and the JSON-array fallback", () => {
    const nd = parsePs(readFileSync(join(FIX, "ps.ndjson"), "utf8"));
    expect(nd?.map((r) => [r.service, r.state, r.health])).toEqual([
      ["agent", "running", "healthy"],
      ["renderer", "running", "healthy"],
      ["search", "running", "healthy"],
    ]);
    const arr = parsePs(
      JSON.stringify(
        readFileSync(join(FIX, "ps.ndjson"), "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l)),
      ),
    );
    expect(arr).toEqual(nd);
    expect(parsePs("")).toEqual([]);
    expect(parsePs("{not json")).toBeUndefined();
    const stopped = parsePs(readFileSync(join(FIX, "ps-stopped.ndjson"), "utf8"));
    expect(stopped?.every((r) => r.state === "exited" && r.exitCode === 0)).toBe(true);
  });

  it("inspect: labels, image id, env values the shell needs, volumes", () => {
    const [agent] = parseInspect(readFileSync(join(FIX, "inspect-agent.json"), "utf8"));
    expect(agent).toMatchObject({
      service: "agent",
      image: "oab-m4-2-agent:a",
      imageId: "sha256:909976625c22b0f309218e876f5b974723fdec33f9bf13d28df29a6961430ac9",
      configFiles: "/Users/tester/PycharmProjects/open-agent-revamp/docker-compose.yml",
      workingDir: "/Users/tester/PycharmProjects/open-agent-revamp",
      status: "running",
      exitCode: 0,
      health: "healthy",
      port: 18451,
      token: "0".repeat(64),
      version: "0.0.0-m42a",
      dataVolume: "oab-factory-m4-2-data",
      keysVolume: "oab-factory-m4-2-keys",
    });
    expect(parseInspect("garbage")).toEqual([]);
  });
});
