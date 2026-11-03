import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../../../scripts/preview-preflight.sh");

async function fakeDocker(projectName: string): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), "preflight-"));
  const docker = join(bin, "docker");
  await writeFile(docker, `#!/bin/sh\nprintf '{"name":"%s"}\\n' "${projectName}"\n`);
  await chmod(docker, 0o755);
  return bin;
}

async function preflight(projectName: string, extraEnv: Record<string, string> = {}) {
  const bin = await fakeDocker(projectName);
  const res = spawnSync("bash", ["-c", `. "${SCRIPT}"; preflight docker compose -p x; echo AFTER`], {
    env: { PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("preview preflight", () => {
  it("passes an oab- project name", async () => {
    const r = await preflight("oab-factory-m0");
    expect(r.status).toBe(0);
    expect(r.out).toContain("AFTER");
  });

  it.each(["open-agent-bot", "open-agent-revamp", "", "xoab-preview"])("aborts on project name '%s'", async (name) => {
    const r = await preflight(name);
    expect(r.status).toBe(1);
    expect(r.out).toContain("ABORT");
    expect(r.out).not.toContain("AFTER");
  });

  it.each([
    ["PREVIEW_WEB_PORT", "abc"],
    ["PREVIEW_AGENT_PORT", "80"],
    ["PREVIEW_WEB_PORT", "183000"],
    ["PREVIEW_AGENT_PORT", "18800;rm"],
  ])("aborts when %s=%s", async (name, value) => {
    const r = await preflight("oab-factory-m0", { [name]: value });
    expect(r.status).toBe(1);
    expect(r.out).toContain("ABORT");
    expect(r.out).not.toContain("AFTER");
  });

  it("accepts numeric preview ports", async () => {
    const r = await preflight("oab-factory-m0", { PREVIEW_AGENT_PORT: "18801", PREVIEW_WEB_PORT: "18301" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("AFTER");
  });
});
