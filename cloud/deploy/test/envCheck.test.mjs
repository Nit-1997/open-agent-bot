import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { composeNames, REQUIRED } from "../scripts/env-check.mjs";
import { composeConfig, ROOT, standIn } from "./support/composeConfig.mjs";

const HOSTED = join(ROOT, "cloud/deploy/compose.hosted.yml");
const WORK = mkdtempSync(join(tmpdir(), "env-check-"));
const STAND_IN = standIn();
after(() => {
  rmSync(WORK, { recursive: true, force: true });
  STAND_IN.remove();
});

describe("env-check.mjs", () => {
  it("reads the same environment names from the hosted compose file as Compose does", () => {
    const env = join(WORK, "backend.env");
    writeFileSync(env, "RENDERER_SECRET=placeholder-not-a-secret\n");
    const { services } = composeConfig(["-f", HOSTED, "--profile", "local", "--profile", "litellm", "--profile", "ollama"], {
      envFile: ["--env-file", env],
      standInDir: STAND_IN.dir,
      projectDir: "cloud/deploy",
    });
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
