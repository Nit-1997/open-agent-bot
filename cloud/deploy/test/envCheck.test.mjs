import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { composeNames, REQUIRED } from "../scripts/env-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOSTED = join(ROOT, "cloud/deploy/compose.hosted.yml");
const WORK = mkdtempSync(join(tmpdir(), "env-check-"));
after(() => rmSync(WORK, { recursive: true, force: true }));

describe("env-check.mjs", () => {
  it("reads the same environment names from the hosted compose file as Compose does", () => {
    const env = join(WORK, "backend.env");
    writeFileSync(env, "RENDERER_SECRET=placeholder-not-a-secret\n");
    const res = spawnSync(
      "docker",
      [
        "compose",
        "--env-file",
        env,
        "-f",
        HOSTED,
        "--profile",
        "local",
        "--profile",
        "litellm",
        "--profile",
        "ollama",
        "config",
        "--format",
        "json",
        "--no-env-resolution",
      ],
      { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    assert.equal(res.status, 0, "docker compose config failed (output not shown)");
    const services = JSON.parse(res.stdout).services;
    const want = new Set(Object.values(services).flatMap((s) => Object.keys(s.environment ?? {})));
    assert.deepEqual([...composeNames(readFileSync(HOSTED, "utf8"))].sort(), [...want].sort());
  });

  it("requires only names the backend and frontend examples list", () => {
    for (const [group, names] of Object.entries(REQUIRED)) {
      const example = readFileSync(join(ROOT, `cloud/deploy-config/env-files/${group}/.env.example`), "utf8");
      for (const n of names) assert.match(example, new RegExp(`^${n}=`, "m"), `${group} ${n}`);
    }
  });
});
