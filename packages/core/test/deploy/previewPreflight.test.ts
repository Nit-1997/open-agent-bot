import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../../../scripts/preview-preflight.sh");

type Port = { host_ip?: string; published: string };

const SAFE_PORTS: Record<string, Port[]> = {
  agent: [{ host_ip: "127.0.0.1", published: "18800" }],
  web: [{ host_ip: "127.0.0.1", published: "18300" }],
};

async function fakeDocker(name: string, ports: Record<string, Port[]>): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), "preflight-"));
  const config = JSON.stringify({ name, services: Object.fromEntries(Object.entries(ports).map(([s, p]) => [s, { ports: p }])) });
  await writeFile(join(bin, "config.json"), config);
  const docker = join(bin, "docker");
  await writeFile(docker, `#!/bin/sh\ncat "${join(bin, "config.json")}"\n`);
  await chmod(docker, 0o755);
  return bin;
}

async function shell(script: string, name: string, ports: Record<string, Port[]>, extraEnv: Record<string, string>) {
  const bin = await fakeDocker(name, ports);
  const res = spawnSync("bash", ["-c", `. "${SCRIPT}"; ${script}`], {
    env: { PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const preflight = (name: string, extraEnv: Record<string, string> = {}, ports = SAFE_PORTS) =>
  shell("preflight docker compose -p x || exit 1; echo AFTER", name, ports, extraEnv);

const expectAbort = (r: { status: number | null; out: string }) => {
  expect(r.status).toBe(1);
  expect(r.out).toContain("ABORT");
  expect(r.out).not.toContain("AFTER");
};

describe("preview preflight", () => {
  it("passes an oab- project with loopback ports from 18000", async () => {
    const r = await preflight("oab-factory-m0");
    expect(r.status).toBe(0);
    expect(r.out).toContain("preflight ok");
    expect(r.out).toContain("AFTER");
  });

  it("returns 1 instead of exiting, so sourcing it in an interactive shell keeps the shell open", async () => {
    const r = await shell('preflight docker compose -p x; echo "rc=$?"', "open-agent-bot", SAFE_PORTS, {});
    expect(r.status).toBe(0);
    expect(r.out).toContain("ABORT");
    expect(r.out).toContain("rc=1");
  });

  it.each(["open-agent-bot", "open-agent-revamp", "", "xoab-preview"])("aborts on project name '%s'", async (name) => {
    expectAbort(await preflight(name));
  });

  it.each<[string, Record<string, Port[]>]>([
    ["a port on every interface", { web: [{ host_ip: "0.0.0.0", published: "18300" }] }],
    ["a port without a host ip", { web: [{ published: "18300" }] }],
    ["the live HTTP port", { caddy: [{ host_ip: "127.0.0.1", published: "80" }] }],
    ["the live agent port", { ...SAFE_PORTS, agent: [{ host_ip: "127.0.0.1", published: "8000" }] }],
    ["a port just below 18000", { web: [{ host_ip: "127.0.0.1", published: "17999" }] }],
  ])("aborts on %s", async (_label, ports) => {
    expectAbort(await preflight("oab-factory-m0", {}, ports));
  });

  it.each([
    ["PREVIEW_WEB_PORT", "abc"],
    ["PREVIEW_AGENT_PORT", "80"],
    ["PREVIEW_AGENT_PORT", "8000"],
    ["PREVIEW_WEB_PORT", "17999"],
    ["PREVIEW_WEB_PORT", "20000"],
    ["PREVIEW_WEB_PORT", "183000"],
    ["PREVIEW_AGENT_PORT", "18800;rm"],
  ])("aborts when %s=%s", async (name, value) => {
    expectAbort(await preflight("oab-factory-m0", { [name]: value }));
  });

  it("accepts preview ports in 18000-19999", async () => {
    const r = await preflight("oab-factory-m0", { PREVIEW_AGENT_PORT: "18000", PREVIEW_WEB_PORT: "19999" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("AFTER");
  });
});
