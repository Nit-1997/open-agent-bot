import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PASS_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];
const LOCAL = "docker compose -p oab-factory-m3-5 --env-file /dev/null -f docker-compose.yml";
const TEST_VOLUMES = { OPEN_AGENT_DATA_VOLUME: "oab-factory-m3-data", OPEN_AGENT_KEYS_VOLUME: "oab-factory-m3-keys" };

function preflight(command, env, cwd = ROOT) {
  const res = spawnSync("bash", ["-c", `. "$0"; preflight ${command} || exit 1; echo AFTER`, join(ROOT, "scripts/preview-preflight.sh")], {
    cwd,
    env: { ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])), ...env },
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

const expectAbort = (r, text) => {
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /ABORT/);
  assert.doesNotMatch(r.out, /AFTER/);
  if (text) assert.ok(r.out.includes(text), r.out);
};

const expectOk = (r) => {
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /preflight ok/);
  assert.match(r.out, /AFTER/);
};

describe("preflight on the local stack", () => {
  it("passes test volumes on port 18330", () => {
    expectOk(preflight(LOCAL, { ...TEST_VOLUMES, OPEN_AGENT_PORT: "18330" }));
  });

  it("aborts on OPEN_AGENT_PORT=3000", () => {
    expectAbort(
      preflight(LOCAL, { ...TEST_VOLUMES, OPEN_AGENT_PORT: "3000" }),
      "OPEN_AGENT_PORT must be a port in 18000-19999, got '3000'",
    );
  });

  for (const port of ["17999", "20000", "abc", "18330;rm"]) {
    it(`aborts on OPEN_AGENT_PORT=${port}`, () => {
      expectAbort(preflight(LOCAL, { ...TEST_VOLUMES, OPEN_AGENT_PORT: port }), "OPEN_AGENT_PORT must be a port in 18000-19999");
    });
  }

  it("aborts on the real data volume name", () => {
    expectAbort(
      preflight(LOCAL, { ...TEST_VOLUMES, OPEN_AGENT_PORT: "18330", OPEN_AGENT_DATA_VOLUME: "open-agent-data" }),
      "volume 'open-agent-data' must start with oab-",
    );
  });

  it("aborts when the keys volume is left at its default", () => {
    expectAbort(
      preflight(LOCAL, { OPEN_AGENT_DATA_VOLUME: "oab-factory-m3-data", OPEN_AGENT_PORT: "18330" }),
      "volume 'open-agent-keys' must start with oab-",
    );
  });

  it("aborts on the default port even with test volumes", () => {
    expectAbort(preflight(LOCAL, TEST_VOLUMES), "publishes a port below 18000");
  });

  it("aborts on the local project name", () => {
    expectAbort(
      preflight("docker compose --env-file /dev/null -f docker-compose.yml", { ...TEST_VOLUMES, OPEN_AGENT_PORT: "18330" }),
      "project 'open-agent'",
    );
  });
});
