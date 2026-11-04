import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOSTED = "cloud/deploy/compose.hosted.yml";
const PREVIEW = "cloud/deploy/compose.preview.yml";
const BASELINE = "the pre-M6 baseline";
const HOSTED_PROFILES = ["--profile", "local", "--profile", "litellm", "--profile", "ollama"];
const PASS_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];
const WORK = mkdtempSync(join(tmpdir(), "compose-hosted-"));
after(() => rmSync(WORK, { recursive: true, force: true }));

const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  ...extra,
});

function config(args, { cwd = ROOT, env = {}, envFile = ["--env-file", "/dev/null"] } = {}) {
  const res = spawnSync("docker", ["compose", ...envFile, ...args, "config", "--format", "json", "--no-env-resolution"], {
    cwd,
    env: cleanEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`docker compose ${args.join(" ")} config exited ${res.status} (output not shown)`);
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
const at = (...parts) => join(ROOT, ...parts);
const WEB_CACHE = ":size=256m,uid=1000,gid=1000,mode=0700";
const ENV_FILE_SERVICES = { agent: "agent", renderer: "renderer", search: "search", web: "nextjs", caddy: "caddy", llm: "llm" };
const ALLOWED = {
  ...Object.fromEntries(
    Object.entries(ENV_FILE_SERVICES).map(([svc, name]) => [
      `.services.${svc}.env_file.0.path`,
      [at("deploy-config", `.env-${name}`), at("cloud/deploy", `.env-${name}`)],
    ]),
  ),
  ".services.search.volumes.0.source": [at("deploy-config/searxng/settings.yml"), at("cloud/deploy/searxng/settings.yml")],
  ".services.search.volumes.1.source": [at("deploy-config/searxng/entrypoint.sh"), at("cloud/deploy/searxng/entrypoint.sh")],
  ".services.llm.volumes.0.source": [at("deploy-config/litellm/config.yaml"), at("cloud/deploy/litellm/config.yaml")],
  ".services.caddy.volumes.0.source": [at("deploy-config/caddy/Caddyfile.local"), at("cloud/deploy/caddy/Caddyfile.local")],
  ".services.renderer.security_opt.1": ["seccomp=deploy-config/renderer/seccomp.json", "seccomp=renderer/seccomp.json"],
  ".services.agent.build.dockerfile": ["packages/core/Dockerfile", "cloud/agent/Dockerfile"],
  ".services.web.build.dockerfile": ["web/Dockerfile", "cloud/web/Dockerfile"],
  ".services.web.tmpfs.1": [`/app/web/.next/cache${WEB_CACHE}`, `/app/cloud/web/.next/cache${WEB_CACHE}`],
};
const LINE_MOVES = [
  [/^( {6}- path: )deploy-config\/(\.env-\w+)$/gm, "$1$2"],
  [/^( {6}- \.\/)deploy-config\//gm, "$1"],
  [/"seccomp=deploy-config\/renderer\/seccomp\.json"/, '"seccomp=renderer/seccomp.json"'],
  [/^( {6}context: )\.$/gm, "$1../.."],
  [/^( {2}agent:\n {4}build:\n {6}context: \.\.\/\.\.\n {6}dockerfile: )packages\/core\/Dockerfile$/m, "$1cloud/agent/Dockerfile"],
  [/^( {6}dockerfile: )web\/Dockerfile$/m, "$1cloud/web/Dockerfile"],
  [/^( {6}- )\/app\/web\/\.next\/cache(:size=256m,uid=1000,gid=1000,mode=0700)$/m, "$1/app/cloud/web/.next/cache$2"],
];
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const FIXTURE = join(ROOT, "cloud/deploy/test/fixtures/compose-hosted-baseline.yml");
const baselineText = () => readFileSync(FIXTURE, "utf8");

describe("hosted compose (cloud/deploy/compose.hosted.yml)", () => {
  it(`is the ${BASELINE} root docker-compose.yml (fixtures/compose-hosted-baseline.yml) plus one name line, with only its paths moved to cloud/deploy`, () => {
    let moved = baselineText();
    for (const [re, to] of LINE_MOVES) {
      assert.match(moved, new RegExp(re.source, re.flags.replace("g", "")), String(re));
      moved = moved.replace(re, to);
    }
    assert.equal(read(HOSTED), `name: open-agent-bot\n${moved}`);
  });

  it(`resolves to the same config as the root file at ${BASELINE} under project open-agent-bot, apart from exactly the moved paths`, () => {
    const base = join(WORK, "baseline.yml");
    writeFileSync(base, baselineText());
    const hosted = config(["-f", HOSTED, ...HOSTED_PROFILES]);
    const before = config(["-p", "open-agent-bot", "--project-directory", ROOT, "-f", base, ...HOSTED_PROFILES]);
    assert.deepEqual(diffPaths(hosted, before), Object.keys(ALLOWED).sort(), "differing config paths (values never printed)");
    for (const [path, [old, now]] of Object.entries(ALLOWED)) {
      assert.ok(valueAt(before, path) === old, `${path} at ${BASELINE} is not the expected old value`);
      assert.ok(valueAt(hosted, path) === now, `${path} is not the expected new value`);
    }
  });

  it("keeps the project name, the four volume names, every published port and the repo root as every build context", () => {
    const hosted = config(["-f", HOSTED, ...HOSTED_PROFILES]);
    assert.equal(hosted.name, "open-agent-bot");
    assert.deepEqual(Object.fromEntries(Object.entries(hosted.volumes).map(([k, v]) => [k, v.name])), {
      "searxng-data": "open-agent-bot_searxng-data",
      "caddy-data": "open-agent-bot_caddy-data",
      "caddy-config": "open-agent-bot_caddy-config",
      "ollama-data": "open-agent-bot_ollama-data",
    });
    const ports = Object.entries(hosted.services)
      .flatMap(([svc, s]) => (s.ports ?? []).map((p) => `${svc} ${p.host_ip}:${p.published}:${p.target}`))
      .sort();
    assert.deepEqual(ports, [
      "agent 127.0.0.1:8000:8000",
      "caddy 127.0.0.1:443:443",
      "caddy 127.0.0.1:80:80",
      "llm 127.0.0.1:4000:4000",
      "ollama 127.0.0.1:11434:11434",
    ]);
    const contexts = Object.entries(hosted.services).filter(([, s]) => s.build);
    assert.deepEqual(contexts.map(([svc]) => svc).sort(), ["agent", "renderer", "web"]);
    for (const [svc, s] of contexts) assert.ok(s.build.context === ROOT, `${svc} build context is not the repo root`);
  });
});

describe("hosted preview override (cloud/deploy/compose.preview.yml)", () => {
  const preview = () => config(["--profile", "local", "-f", HOSTED, "-f", PREVIEW]);

  it("is named oab-preview and publishes only web 18300 and agent 18800 on 127.0.0.1", () => {
    const c = preview();
    assert.equal(c.name, "oab-preview");
    const ports = Object.entries(c.services).flatMap(([svc, s]) => (s.ports ?? []).map((p) => `${svc} ${p.host_ip}:${p.published}`));
    assert.deepEqual(ports.sort(), ["agent 127.0.0.1:18800", "web 127.0.0.1:18300"]);
  });
});

describe("Compose .env lookup (D9 guard)", () => {
  const probe = mkdtempSync(join(WORK, "env-lookup-"));
  mkdirSync(join(probe, "sub"));
  writeFileSync(join(probe, "sub/compose.yml"), "name: pinned\nservices:\n  x:\n    image: busybox\n");
  const name = (files, args = []) => {
    rmSync(join(probe, ".env"), { force: true });
    rmSync(join(probe, "sub/.env"), { force: true });
    for (const [file, project] of Object.entries(files)) writeFileSync(join(probe, file), `COMPOSE_PROJECT_NAME=${project}\n`);
    return config([...args, "-f", "sub/compose.yml"], { cwd: probe, envFile: [] }).name;
  };

  it("reads .env from the compose file's folder, not the working directory, so the guard must sit in cloud/deploy/", () => {
    assert.equal(name({ "sub/.env": "oab-guard" }), "oab-guard");
    assert.equal(name({ ".env": "oab-guard" }), "pinned");
    assert.equal(name({ ".env": "oab-cwd", "sub/.env": "oab-guard" }), "oab-guard");
  });

  it("is overridden by -p and skipped with --env-file /dev/null", () => {
    assert.equal(name({ "sub/.env": "oab-guard" }, ["-p", "oab-explicit"]), "oab-explicit");
    assert.equal(name({ "sub/.env": "oab-guard" }, ["--env-file", "/dev/null"]), "pinned");
  });
});

describe("local SearXNG image (local/searxng/Dockerfile)", () => {
  const dockerfile = read("local/searxng/Dockerfile");
  const hosted = config(["-f", HOSTED]).services.search;

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
