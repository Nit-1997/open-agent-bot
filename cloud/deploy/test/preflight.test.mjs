import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PASS_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

function preflight(command, env, cwd) {
  const res = spawnSync("bash", ["-c", `. "$0"; preflight ${command} || exit 1; echo AFTER`, join(ROOT, "scripts/preview-preflight.sh")], {
    cwd,
    env: { ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), ...env },
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("preflight on the hosted stack", () => {
  const HOSTED = mkdtempSync(join(tmpdir(), "preflight-hosted-"));
  for (const f of ["compose.hosted.yml", "compose.preview.yml"]) copyFileSync(join(ROOT, "cloud/deploy", f), join(HOSTED, f));
  for (const f of [".env-agent", ".env-renderer", ".env-nextjs"]) writeFileSync(join(HOSTED, f), "", { mode: 0o600 });
  after(() => rmSync(HOSTED, { recursive: true, force: true }));

  it("aborts on the pinned live project name", () => {
    const r = preflight("docker compose --env-file /dev/null -f compose.hosted.yml", {}, HOSTED);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /ABORT/);
    assert.doesNotMatch(r.out, /AFTER/);
    assert.ok(r.out.includes("project 'open-agent-bot'"), r.out);
  });

  it("passes the hosted preview under an oab- project", () => {
    const r = preflight(
      "docker compose -p oab-factory-m3-5-hosted --env-file /dev/null -f compose.hosted.yml -f compose.preview.yml --profile local",
      {},
      HOSTED,
    );
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /preflight ok/);
    assert.match(r.out, /AFTER/);
  });
});
