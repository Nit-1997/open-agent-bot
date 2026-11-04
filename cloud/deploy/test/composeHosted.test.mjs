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
const PLACEHOLDER = "placeholder-not-a-secret";
const BACKEND_FIXTURE = join(WORK, "backend.env");
writeFileSync(BACKEND_FIXTURE, `RENDERER_SECRET=${PLACEHOLDER}\n`);

const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  ...extra,
});

function config(args, { cwd = ROOT, env = {}, envFile = ["--env-file", BACKEND_FIXTURE] } = {}) {
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
const AGENT_ENV = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "AGENT_SERVICE_SECRET",
  "CREDENTIAL_KEYS",
  "ACCESS_REQUEST_PEPPER",
  "APP_ORIGIN",
  "RUN_TIME_LIMIT_SECONDS",
  "LOG_LEVEL",
  "JEV_MODEL",
  "JEV_CONCURRENCY",
  "AGENT_MODEL_CAPS",
  "AGENT_MODELS",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "RENDERER_URL",
  "COPILOT_CONNECTS_PER_USER",
  "COPILOT_CONNECT_MAX_MS",
  "LIMIT_RUNNING_PER_USER",
  "LIMIT_REQUESTS_PER_HOUR",
  "LIMIT_REQUESTS_PER_MONTH",
  "LIMIT_RUNNING_SERVER",
  "TURNSTILE_SECRET_KEY",
  "RENDERER_SECRET",
];
const LLM_ENV = ["LITELLM_MASTER_KEY", "ANTHROPIC_API_KEY", "OLLAMA_OPENAI_BASE_URL", "OLLAMA_CHAT_MODEL"];
const CADDY_ENV = ["AGENT_HOST", "ACME_EMAIL"];
const RENDERER_GUARD =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the compose interpolation text, checked verbatim
  "${RENDERER_SECRET:?set RENDERER_SECRET in cloud/deploy-config/env-files/backend/.env and pass that file with --env-file}";
const OLD_ENV_FILES = { agent: "agent", renderer: "renderer", search: "search", caddy: "caddy", llm: "llm" };
const listBlock = (names) => `    environment:\n${names.map((n) => `      - ${n}\n`).join("")}`;
const envFileBlock = (name, required) => `    env_file:\n      - path: .env-${name}\n        required: ${required}\n`;
const ENV_REWIRES = [
  [envFileBlock("llm", false), listBlock(LLM_ENV)],
  [envFileBlock("search", false), ""],
  [
    `${envFileBlock("agent", true)}    environment:\n      PI_OAUTH_CALLBACK_HOST: 0.0.0.0\n`,
    listBlock(["PI_OAUTH_CALLBACK_HOST=0.0.0.0", "COPILOTKIT_TELEMETRY_DISABLED=true", ...AGENT_ENV]),
  ],
  [envFileBlock("renderer", true), `    environment:\n      RENDERER_SECRET: ${RENDERER_GUARD}\n`],
  [envFileBlock("caddy", false), listBlock(CADDY_ENV)],
  ["      - path: .env-nextjs\n", "      - path: ../deploy-config/env-files/frontend/.env\n"],
];
const REWIRED = {
  ...Object.fromEntries(Object.keys(OLD_ENV_FILES).map((svc) => [`.services.${svc}.env_file`, undefined])),
  ...Object.fromEntries(AGENT_ENV.map((k) => [`.services.agent.environment.${k}`, k === "RENDERER_SECRET" ? PLACEHOLDER : null])),
  ".services.agent.environment.COPILOTKIT_TELEMETRY_DISABLED": "true",
  ".services.renderer.environment": { RENDERER_SECRET: PLACEHOLDER },
  ".services.caddy.environment": Object.fromEntries(CADDY_ENV.map((k) => [k, null])),
  ".services.llm.environment": Object.fromEntries(LLM_ENV.map((k) => [k, null])),
};
const ALLOWED = {
  ".services.web.env_file.0.path": [at("deploy-config/.env-nextjs"), at("cloud/deploy-config/env-files/frontend/.env")],
  ".services.search.volumes.0.source": [at("deploy-config/searxng/settings.yml"), at("cloud/deploy/searxng/settings.yml")],
  ".services.search.volumes.1.source": [at("deploy-config/searxng/entrypoint.sh"), at("cloud/deploy/searxng/entrypoint.sh")],
  ".services.llm.volumes.0.source": [at("deploy-config/litellm/config.yaml"), at("cloud/deploy/litellm/config.yaml")],
  ".services.caddy.volumes.0.source": [at("deploy-config/caddy/Caddyfile.local"), at("cloud/deploy/caddy/Caddyfile.local")],
  ".services.renderer.security_opt.1": ["seccomp=deploy-config/renderer/seccomp.json", "seccomp=renderer/seccomp.json"],
  ".services.agent.build.dockerfile": ["packages/core/Dockerfile", "cloud/agent/Dockerfile"],
  ".services.web.build.dockerfile": ["web/Dockerfile", "cloud/web/Dockerfile"],
  ".services.web.tmpfs.1": [`/app/web/.next/cache${WEB_CACHE}`, `/app/cloud/web/.next/cache${WEB_CACHE}`],
  ".services.web.build.args.NEXT_PUBLIC_TURNSTILE_SITE_KEY": [undefined, ""],
};
const LINE_MOVES = [
  [/^( {6}- path: )deploy-config\/(\.env-\w+)$/gm, "$1$2"],
  [/^( {6}- \.\/)deploy-config\//gm, "$1"],
  [/"seccomp=deploy-config\/renderer\/seccomp\.json"/, '"seccomp=renderer/seccomp.json"'],
  [/^( {6}context: )\.$/gm, "$1../.."],
  [/^( {2}agent:\n {4}build:\n {6}context: \.\.\/\.\.\n {6}dockerfile: )packages\/core\/Dockerfile$/m, "$1cloud/agent/Dockerfile"],
  [/^( {6}dockerfile: )web\/Dockerfile$/m, "$1cloud/web/Dockerfile"],
  [/^( {6}- )\/app\/web\/\.next\/cache(:size=256m,uid=1000,gid=1000,mode=0700)$/m, "$1/app/cloud/web/.next/cache$2"],
  [
    /^( {8}NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: \$\{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-\}\n)/m,
    "$1        NEXT_PUBLIC_TURNSTILE_SITE_KEY: $${NEXT_PUBLIC_TURNSTILE_SITE_KEY:-}\n",
  ],
];
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const FIXTURE = join(ROOT, "cloud/deploy/test/fixtures/compose-hosted-baseline.yml");
const baselineText = () => readFileSync(FIXTURE, "utf8");

describe("hosted compose (cloud/deploy/compose.hosted.yml)", () => {
  it(`is the ${BASELINE} root docker-compose.yml (fixtures/compose-hosted-baseline.yml) plus one name line and the M7 Turnstile build arg, with only its paths moved to cloud/deploy and its env files rewired to explicit names`, () => {
    let moved = baselineText();
    for (const [re, to] of LINE_MOVES) {
      assert.match(moved, new RegExp(re.source, re.flags.replace("g", "")), String(re));
      moved = moved.replace(re, to);
    }
    for (const [from, to] of ENV_REWIRES) {
      assert.equal(moved.split(from).length, 2, `expected one ${from.trim().split("\n")[0]} block`);
      moved = moved.replace(from, to);
    }
    assert.equal(read(HOSTED), `name: open-agent-bot\n${moved}`);
  });

  it(`resolves to the same config as the root file at ${BASELINE} under project open-agent-bot, apart from exactly the moved paths, the Turnstile build arg and the rewired env`, () => {
    const base = join(WORK, "baseline.yml");
    writeFileSync(base, baselineText());
    const hosted = config(["-f", HOSTED, ...HOSTED_PROFILES]);
    const before = config(["-p", "open-agent-bot", "--project-directory", ROOT, "-f", base, ...HOSTED_PROFILES]);
    assert.deepEqual(
      diffPaths(hosted, before),
      [...Object.keys(ALLOWED), ...Object.keys(REWIRED)].sort(),
      "differing config paths (values never printed)",
    );
    for (const [path, [old, now]] of Object.entries(ALLOWED)) {
      assert.ok(valueAt(before, path) === old, `${path} at ${BASELINE} is not the expected old value`);
      assert.ok(valueAt(hosted, path) === now, `${path} is not the expected new value`);
    }
    for (const [svc, name] of Object.entries(OLD_ENV_FILES)) {
      const old = valueAt(before, `.services.${svc}.env_file`);
      assert.ok(old?.length === 1 && old[0].path === at("deploy-config", `.env-${name}`), `${svc} env_file at ${BASELINE}`);
    }
    for (const [path, now] of Object.entries(REWIRED)) {
      if (!path.endsWith(".env_file")) assert.equal(valueAt(before, path), undefined, `${path} at ${BASELINE}`);
      assert.deepEqual(valueAt(hosted, path), now, `${path} is not the expected new value`);
    }
  });

  it("hands each service only its own names: renderer, search and caddy get no Supabase or agent secret, the agent no gateway key", () => {
    const hosted = config(["-f", HOSTED, ...HOSTED_PROFILES]);
    const names = (svc) => Object.keys(hosted.services[svc].environment ?? {}).sort();
    for (const svc of ["agent", "renderer", "search", "caddy", "llm"]) assert.equal(hosted.services[svc].env_file, undefined, svc);
    assert.deepEqual(names("renderer"), ["RENDERER_SECRET"]);
    assert.deepEqual(names("search"), []);
    assert.deepEqual(names("caddy"), [...CADDY_ENV].sort());
    assert.deepEqual(names("llm"), [...LLM_ENV].sort());
    assert.deepEqual(names("agent"), ["PI_OAUTH_CALLBACK_HOST", "COPILOTKIT_TELEMETRY_DISABLED", ...AGENT_ENV].sort());
    assert.equal(hosted.services.agent.environment.COPILOTKIT_TELEMETRY_DISABLED, "true");
    const imageEnv = [...read("cloud/agent/Dockerfile").matchAll(/^ENV ([A-Z_]+)=/gm)].map((m) => m[1]);
    for (const k of imageEnv)
      assert.ok(!AGENT_ENV.includes(k), `${k} is set by the agent image; a bare name would unset it when the env file lacks it`);
    assert.deepEqual(
      hosted.services.web.env_file.map((f) => [f.path, f.required ?? true]),
      [[at("cloud/deploy-config/env-files/frontend/.env"), true]],
    );
    const example = (g) =>
      read(`cloud/deploy-config/env-files/${g}/.env.example`)
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.slice(0, l.indexOf("=")));
    const given = new Set(["agent", "renderer", "caddy", "llm"].flatMap(names));
    given.delete("PI_OAUTH_CALLBACK_HOST");
    assert.deepEqual([...given].sort(), example("backend").sort(), "every backend .env.example name goes to some service, and no other");
    for (const svc of ["renderer", "search", "caddy", "llm"])
      for (const k of names(svc))
        assert.ok(!/^SUPABASE_|^AGENT_SERVICE_SECRET$|^CREDENTIAL_KEYS$|^ACCESS_REQUEST_PEPPER$/.test(k), `${svc} gets ${k}`);
    for (const k of LLM_ENV) assert.ok(!names("agent").includes(k), `agent gets ${k}`);
  });

  it("refuses to resolve without the backend env file, naming the file to pass", () => {
    const res = spawnSync("docker", ["compose", "--env-file", "/dev/null", "-f", HOSTED, "config", "--format", "json"], {
      cwd: ROOT,
      env: cleanEnv(),
      encoding: "utf8",
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /RENDERER_SECRET in cloud\/deploy-config\/env-files\/backend\/\.env and pass that file with --env-file/);
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

  it("gives the preview agent high request limits so previews and the hosted e2e are never throttled", () => {
    const env = preview().services.agent.environment;
    assert.deepEqual(Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("LIMIT_"))), {
      LIMIT_RUNNING_PER_USER: "4",
      LIMIT_REQUESTS_PER_HOUR: "1000",
      LIMIT_REQUESTS_PER_MONTH: "100000",
      LIMIT_RUNNING_SERVER: "50",
    });
    const hosted = config(["--profile", "local", "-f", HOSTED]).services.agent.environment ?? {};
    assert.deepEqual(
      Object.entries(hosted).filter(([k, v]) => k.startsWith("LIMIT_") && v !== null),
      [],
      "the hosted file only passes LIMIT_* through from the backend env file",
    );
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
