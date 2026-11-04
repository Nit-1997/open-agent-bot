import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE = "6986a4c";
const HOSTED_PROFILES = ["--profile", "local", "--profile", "litellm", "--profile", "ollama"];
const PASS_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  ...extra,
});

function config(args, env = {}, flags = []) {
  const res = spawnSync("docker", ["compose", "--env-file", "/dev/null", ...args, "config", "--format", "json", ...flags], {
    cwd: ROOT,
    env: cleanEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0)
    throw new Error(`docker compose ${args.join(" ")} config exited ${res.status}: ${(res.stderr ?? "").slice(0, 400)}`);
  return JSON.parse(res.stdout);
}

function diffPaths(a, b, path = "") {
  if (a === b) return [];
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object" || Array.isArray(a) !== Array.isArray(b))
    return [path || "."];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].sort().flatMap((k) => diffPaths(a[k], b[k], `${path}.${k}`));
}

const valueAt = (obj, path) =>
  path
    .split(".")
    .slice(1)
    .reduce((o, k) => o?.[k], obj);
const WEB_CACHE = ":size=256m,uid=1000,gid=1000,mode=0700";
const HOSTED_MOVES = {
  ".services.agent.build.dockerfile": ["packages/core/Dockerfile", "cloud/agent/Dockerfile"],
  ".services.web.build.dockerfile": ["web/Dockerfile", "cloud/web/Dockerfile"],
  ".services.web.tmpfs.1": [`/app/web/.next/cache${WEB_CACHE}`, `/app/cloud/web/.next/cache${WEB_CACHE}`],
};
const AGENT_DOCKERFILE = /^( {2}agent:\n {4}build:\n {6}context: \.\n {6}dockerfile: )packages\/core\/Dockerfile$/m;
const WEB_DOCKERFILE = /^( {2}web:\n {4}profiles: \["local"\]\n {4}build:\n {6}context: \.\n {6}dockerfile: )web\/Dockerfile$/m;
const WEB_TMPFS = /^( {6}- )\/app\/web\/\.next\/cache(:size=256m,uid=1000,gid=1000,mode=0700)$/m;

const localConfig = (env = {}) => config(["-f", "docker-compose.yml"], env);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const portsOf = (svc) => (svc.ports ?? []).map((p) => `${p.host_ip ?? ""}:${p.published}:${p.target}`);
const sourcesOf = (svc) => (svc.volumes ?? []).map((v) => `${v.source}:${v.target}${v.read_only ? ":ro" : ""}`).sort();

describe("hosted compose (compose.hosted.yml)", () => {
  const baseline = execFileSync("git", ["show", `${BASELINE}:docker-compose.yml`], { cwd: ROOT, encoding: "utf8" });

  it("is the old root docker-compose.yml byte for byte plus one name line, with only the agent's and web's build paths moved", () => {
    for (const re of [AGENT_DOCKERFILE, WEB_DOCKERFILE, WEB_TMPFS]) assert.match(baseline, re);
    const moved = baseline
      .replace(AGENT_DOCKERFILE, "$1cloud/agent/Dockerfile")
      .replace(WEB_DOCKERFILE, "$1cloud/web/Dockerfile")
      .replace(WEB_TMPFS, "$1/app/cloud/web/.next/cache$2");
    assert.equal(read("compose.hosted.yml"), `name: open-agent-bot\n${moved}`);
  });

  it(`resolves to the same config as the root file at ${BASELINE} under project open-agent-bot, apart from the moved rows`, () => {
    const tmp = join(ROOT, `.compose-baseline-${process.pid}.yml`);
    writeFileSync(tmp, baseline);
    let hosted;
    let before;
    try {
      hosted = config(["-f", "compose.hosted.yml", ...HOSTED_PROFILES], {}, ["--no-env-resolution"]);
      before = config(["-p", "open-agent-bot", "-f", tmp, ...HOSTED_PROFILES], {}, ["--no-env-resolution"]);
    } finally {
      rmSync(tmp, { force: true });
    }
    assert.deepEqual(diffPaths(hosted, before), Object.keys(HOSTED_MOVES), "differing config paths (values never printed)");
    for (const [path, [old, now]] of Object.entries(HOSTED_MOVES)) {
      assert.ok(valueAt(before, path) === old, `${path} at ${BASELINE} is not the expected old value`);
      assert.ok(valueAt(hosted, path) === now, `${path} is not the expected new value`);
    }
    assert.equal(hosted.name, "open-agent-bot");
    assert.deepEqual(Object.fromEntries(Object.entries(hosted.volumes).map(([k, v]) => [k, v.name])), {
      "searxng-data": "open-agent-bot_searxng-data",
      "caddy-data": "open-agent-bot_caddy-data",
      "caddy-config": "open-agent-bot_caddy-config",
      "ollama-data": "open-agent-bot_ollama-data",
    });
    assert.equal(hosted.services.agent.build.context, ROOT);
    assert.equal(hosted.services.web.build.context, ROOT);
  });
});

describe("local compose (docker-compose.yml)", () => {
  const cfg = localConfig();
  const { agent, search, renderer } = cfg.services;

  it("is project open-agent with exactly agent, search and renderer", () => {
    assert.equal(cfg.name, "open-agent");
    assert.deepEqual(Object.keys(cfg.services).sort(), ["agent", "renderer", "search"]);
  });

  it("publishes only the agent, on 127.0.0.1:3000", () => {
    assert.deepEqual(portsOf(agent), ["127.0.0.1:3000:3000"]);
    assert.deepEqual(portsOf(search), []);
    assert.deepEqual(portsOf(renderer), []);
  });

  it("follows OPEN_AGENT_PORT on 127.0.0.1 and hands it to the agent", () => {
    const c = localConfig({ OPEN_AGENT_PORT: "18330" });
    assert.deepEqual(portsOf(c.services.agent), ["127.0.0.1:18330:3000"]);
    assert.equal(c.services.agent.environment.OPEN_AGENT_PORT, "18330");
  });

  it("uses no env_file anywhere", () => {
    const raw = config(["-f", "docker-compose.yml"], {}, ["--no-env-resolution"]);
    for (const [name, svc] of Object.entries(raw.services)) assert.equal(svc.env_file, undefined, name);
  });

  it("hardens the agent and restarts it at most three times", () => {
    assert.equal(agent.read_only, true);
    assert.deepEqual(agent.cap_drop, ["ALL"]);
    assert.deepEqual(agent.security_opt, ["no-new-privileges:true"]);
    assert.equal(agent.restart, "on-failure:3");
    assert.deepEqual(agent.extra_hosts, ["host.docker.internal=host-gateway"]);
    assert.deepEqual(agent.command, ["node", "dist/local/main.js"]);
    assert.match(agent.healthcheck.test.join(" "), /http:\/\/127\.0\.0\.1:3000\/health/);
  });

  it("gives the agent exactly the four local variables", () => {
    assert.deepEqual(Object.keys(agent.environment ?? {}).sort(), [
      "COPILOTKIT_TELEMETRY_DISABLED",
      "OPEN_AGENT_LAUNCH_TOKEN",
      "OPEN_AGENT_PORT",
      "OPEN_AGENT_RESET_CREDENTIALS",
    ]);
    assert.deepEqual(agent.environment, {
      COPILOTKIT_TELEMETRY_DISABLED: "true",
      OPEN_AGENT_LAUNCH_TOKEN: "",
      OPEN_AGENT_PORT: "3000",
      OPEN_AGENT_RESET_CREDENTIALS: "",
    });
    const set = localConfig({ OPEN_AGENT_RESET_CREDENTIALS: "1", OPEN_AGENT_LAUNCH_TOKEN: "a".repeat(64) }).services.agent.environment;
    assert.equal(set.OPEN_AGENT_RESET_CREDENTIALS, "1");
    assert.equal(set.OPEN_AGENT_LAUNCH_TOKEN, "a".repeat(64));
  });

  it("names local images by default, builds them from this repo, and lets prebuilt images override them", () => {
    assert.equal(agent.image, "open-agent:local");
    assert.equal(renderer.image, "open-agent:local");
    assert.equal(renderer.build, undefined);
    assert.equal(renderer.pull_policy, "never");
    assert.equal(search.image, "open-agent-search:local");
    assert.equal(agent.build.context, ROOT);
    assert.equal(agent.build.dockerfile, "packages/core/Dockerfile");
    assert.equal(search.build.context, join(ROOT, "local/searxng"));
    const c = localConfig({
      OPEN_AGENT_IMAGE: "ghcr.io/x/open-agent@sha256:1",
      OPEN_AGENT_SEARCH_IMAGE: "ghcr.io/x/open-agent-search@sha256:2",
    });
    assert.equal(c.services.agent.image, "ghcr.io/x/open-agent@sha256:1");
    assert.equal(c.services.renderer.image, "ghcr.io/x/open-agent@sha256:1");
    assert.equal(c.services.search.image, "ghcr.io/x/open-agent-search@sha256:2");
  });

  it("mounts keys into the agent only and the renderer secret read-only into the renderer", () => {
    assert.deepEqual(sourcesOf(agent), ["data:/data", "keys:/keys", "renderer-key:/run/open-agent/renderer"]);
    assert.deepEqual(sourcesOf(renderer), ["renderer-key:/run/open-agent/renderer:ro"]);
    assert.deepEqual(sourcesOf(search), ["searxng-secret:/var/lib/searxng-secret"]);
  });

  it("starts the renderer after a healthy agent, from the secret file, with the inline seccomp profile", () => {
    assert.deepEqual(renderer.command, ["node", "dist/renderer/main.js"]);
    assert.deepEqual(Object.keys(renderer.environment ?? {}), ["RENDERER_SECRET_FILE"]);
    assert.equal(renderer.environment.RENDERER_SECRET_FILE, "/run/open-agent/renderer/secret");
    assert.equal(renderer.depends_on.agent.condition, "service_healthy");
    assert.equal(renderer.restart, "unless-stopped");
    assert.equal(renderer.read_only, true);
    assert.deepEqual(renderer.cap_drop, ["ALL"]);
    assert.deepEqual(renderer.cap_add, ["SYS_CHROOT"]);
    assert.deepEqual(renderer.security_opt, ["no-new-privileges:true", "seccomp=local/renderer/seccomp.json"]);
    assert.deepEqual(Object.keys(renderer.networks).sort(), ["render", "render-egress"]);
    assert.equal(cfg.networks.render.internal, true);
  });

  it("health-checks search on /healthz, keeps its image volumes in tmpfs, and makes the agent wait for it", () => {
    assert.match(search.healthcheck.test.join(" "), /http:\/\/127\.0\.0\.1:8080\/healthz/);
    assert.deepEqual((search.tmpfs ?? []).map((t) => t.split(":")[0]).sort(), ["/etc/searxng", "/var/cache/searxng"]);
    assert.equal(search.restart, "unless-stopped");
    assert.equal(agent.depends_on.search.condition, "service_healthy");
  });

  it("names the data and keys volumes open-agent-data and open-agent-keys unless the env says otherwise", () => {
    assert.equal(cfg.volumes.data.name, "open-agent-data");
    assert.equal(cfg.volumes.keys.name, "open-agent-keys");
    const c = localConfig({ OPEN_AGENT_DATA_VOLUME: "oab-factory-m3-data", OPEN_AGENT_KEYS_VOLUME: "oab-factory-m3-keys" });
    assert.equal(c.volumes.data.name, "oab-factory-m3-data");
    assert.equal(c.volumes.keys.name, "oab-factory-m3-keys");
  });

  it("has no bind mounts", () => {
    const binds = Object.values(cfg.services).flatMap((s) => (s.volumes ?? []).filter((v) => v.type === "bind"));
    assert.deepEqual(binds, []);
  });

  it("never references deploy-config", () => {
    assert.equal(read("docker-compose.yml").includes("deploy-config"), false);
    assert.equal(JSON.stringify(cfg).includes("deploy-config"), false);
    assert.equal(read("local/searxng/Dockerfile").includes("deploy-config"), false);
  });
});

describe("local SearXNG image (local/searxng/Dockerfile)", () => {
  const dockerfile = read("local/searxng/Dockerfile");
  const hosted = config(["-f", "compose.hosted.yml"], {}, ["--no-env-resolution"]).services.search;

  it("builds FROM the SearXNG digest the hosted stack pins", () => {
    assert.match(hosted.image, /@sha256:[0-9a-f]{64}$/);
    assert.match(dockerfile, new RegExp(`^FROM ${hosted.image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  });

  it("bakes the settings outside the image's /etc/searxng volume and the secret entrypoint in, with the hosted entrypoint override", () => {
    assert.match(dockerfile, /^COPY settings\.yml \/opt\/open-agent\/settings\.yml$/m);
    assert.match(dockerfile, /^ENV SEARXNG_SETTINGS_PATH=\/opt\/open-agent\/settings\.yml$/m);
    assert.doesNotMatch(dockerfile, /\/etc\/searxng/);
    assert.match(dockerfile, /^COPY entrypoint\.sh \/opt\/open-agent\/entrypoint\.sh$/m);
    assert.match(
      dockerfile,
      new RegExp(
        `^ENTRYPOINT ${JSON.stringify(hosted.entrypoint)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replaceAll(",", ", ")}$`,
        "m",
      ),
    );
  });
});
