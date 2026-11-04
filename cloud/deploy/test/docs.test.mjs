import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractCommands, htmlProblems, loadOwnerDocs } from "../../../scripts/docs/doc-commands.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const linesOf = (text) => text.split("\n");
const README = read("README.md");
const HOSTED = read("cloud/README.md");
const COMPOSE = "-f cloud/deploy/compose.hosted.yml";
const SWITCH = "## Switch-over after M6 (owner only)";
const GATE6 = "## Vercel (Gate 6)";
const GATE7 = "## Move the live stack to `cloud/deploy` (Gate 7)";
const before = (text, heading) => (text.includes(heading) ? text.slice(0, text.indexOf(heading)) : text);
const section = (from, to) => {
  const a = HOSTED.indexOf(from);
  assert.ok(a >= 0, `cloud/README.md lacks ${from}`);
  const b = to ? HOSTED.indexOf(to, a + from.length) : -1;
  return HOSTED.slice(a, b < 0 ? HOSTED.length : b);
};
const OLD_COMMANDS = [
  "docker compose --env-file deploy-config/.env-nextjs --profile local up -d --build",
  'docker compose --project-directory "$OLD" -f "$OLD/docker-compose.yml" --env-file "$OLD/deploy-config/.env-nextjs" --profile local up -d',
  'docker compose -f "$OLD/compose.hosted.yml" --env-file "$OLD/deploy-config/.env-nextjs" --profile local up -d',
];
const LIVE_UP = "docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local up -d --build";

describe("hosted docs moved out of the README", () => {
  const moved = [
    "Run the hosted stack",
    "Deploy",
    "Optional: Ollama in Docker",
    "Optional: LiteLLM gateway",
    "Settings reference",
    "End-to-end demo",
    "Evals",
  ];
  it("says what it is and that the open-source app runs without cloud/", () => {
    assert.equal(linesOf(HOSTED)[0].startsWith("# "), true);
    assert.ok(
      HOSTED.includes(
        "The invite-only hosted deployment. Everything in `cloud/` is hosted-only; the open-source app builds and runs without this folder.",
      ),
    );
  });
  it("holds every hosted heading that left the README", () => {
    for (const h of moved) {
      assert.match(HOSTED, new RegExp(`^#{2,3} ${h}$`, "m"), `cloud/README.md lacks ${h}`);
      assert.doesNotMatch(README, new RegExp(`^#{2,3} ${h}$`, "m"), `README still has ${h}`);
    }
  });
  it("keeps the hosted text verbatim, with the cloud/ paths", () => {
    for (const s of [
      `Every hosted command needs \`${COMPOSE}\``,
      `\`docker compose ${COMPOSE} --env-file cloud/deploy/.env-nextjs --profile local up -d --build\``,
      `\`docker compose ${COMPOSE} cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt`,
      `\`CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose ${COMPOSE} up -d --build\``,
      `\`docker compose ${COMPOSE} --profile ollama up -d\``,
      `\`docker compose ${COMPOSE} exec agent node dist/scripts/rotateCredentials.js\``,
      "npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w @oab/cloud-e2e",
      "`cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5`",
      "`supabase --workdir cloud …`",
      "Root Directory `cloud/web`",
      "`cloud/deploy/.env-agent`",
      "`APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e`",
    ])
      assert.ok(HOSTED.includes(s), `cloud/README.md lacks ${s}`);
  });
  it("targets the hosted project in every compose command, the old checkout only in the switch-over", () => {
    const prose = linesOf(HOSTED)
      .filter((l) => !l.startsWith("> **Warning.**"))
      .join("\n");
    const switchover = HOSTED.slice(HOSTED.indexOf(SWITCH));
    const spans = [
      ...[...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
      ...extractCommands(HOSTED, "cloud/README.md").map((c) => c.command),
    ];
    const compose = spans.filter((c) => /\bdocker compose\b/.test(c));
    assert.ok(compose.length >= 6);
    for (const c of compose)
      assert.ok(
        c.includes(COMPOSE) ||
          /docker compose -p oab-/.test(c) ||
          c === "docker compose config --format json | jq -r .name" ||
          (OLD_COMMANDS.includes(c) && switchover.includes(c)),
        `untargeted: ${c}`,
      );
  });
  it("names no pre-M6 hosted path before the switch-over, and there only the old checkout's", () => {
    const current = before(HOSTED, SWITCH);
    for (const s of ["-f compose.hosted.yml", "-w e2e", "(docs/hosted.md)", "`supabase/", " supabase/scripts/"])
      assert.ok(!current.includes(s), `cloud/README.md still names ${s}`);
    for (const l of linesOf(current).filter((x) => x.includes("deploy-config/")))
      assert.match(l, /env-files\.mjs --from <that checkout>\/deploy-config --to cloud\/deploy/, l);
    for (const l of linesOf(HOSTED.slice(HOSTED.indexOf(SWITCH))).filter((x) =>
      /deploy-config|compose\.hosted\.yml`|-f compose\.hosted/.test(x),
    ))
      assert.match(l, /\$OLD|old checkout/, l);
  });
  it("names only paths that exist (settings files, build output and placeholders aside)", () => {
    const spans = [...HOSTED.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    const words = [...spans, ...extractCommands(HOSTED, "cloud/README.md").map((c) => c.command)].flatMap((t) => t.split(/[\s"'(),=]+/));
    const paths = [...new Set(words.filter((w) => /^(cloud|packages|scripts|docs|e2e|local|apps)\/[\w./-]*$/.test(w)))].filter(
      (p) => !/\.env|env-files|\.auth|\/dist\/|\/results\/|\.next\//.test(p),
    );
    assert.ok(paths.length >= 15, `only ${paths.length} paths found`);
    for (const p of paths) assert.ok(existsSync(join(ROOT, p.replace(/[.:]$/, ""))), `cloud/README.md names a missing path: ${p}`);
  });
  it("has no raw HTML outside code", () => {
    assert.deepEqual(htmlProblems(HOSTED), []);
  });
});

describe("switch-over runbook (Gates 6 and 7)", () => {
  it("orders the sections: run, develop, e2e, evals, then the switch-over and both gates", () => {
    let at = -1;
    for (const h of ["## Run the hosted stack", "## Develop the hosted stack", "## End-to-end demo", "## Evals", SWITCH, GATE6, GATE7]) {
      const i = HOSTED.indexOf(`\n${h}\n`);
      assert.ok(i > at, `${h} missing or out of order`);
      at = i;
    }
  });
  it("makes the combined sitting from c1c0f4e the primary path, agent first, and keeps the post-revamp precondition", () => {
    const sw = section(SWITCH, GATE6);
    for (const s of [
      "`c1c0f4e`",
      "<old checkout>",
      "**one sitting**",
      "`/copilotkit`",
      "`/agui`",
      "**Before the first merge**",
      "**Merge**",
      "**Prepare** Gate 7 steps 1 to 5",
      "**Root Directory** `cloud/web`",
      "**Switch the agent** (Gate 7 step 6)",
      "**Web live** (Gate 6 step 5)",
      "**Verify** (Gate 7 step 7)",
      "**Burn-in**",
      "already redeployed from the post-revamp layout",
    ])
      assert.ok(sw.includes(s), `switch-over lacks ${s}`);
    assert.ok(sw.indexOf("**Switch the agent**") < sw.indexOf("**Web live**"));
  });
  it("Gate 6 has the fork-protection, preview-scope and required-check steps and the Root Directory change", () => {
    const g6 = section(GATE6, GATE7);
    for (const s of [
      '"Git Fork Protection" is on',
      "scoped to Preview or Development",
      "`AGENT_SERVICE_SECRET`",
      "Supabase GitHub integration",
      "its directory is `cloud`",
      '"Auto-assign Custom Production Domains"',
      "add `standalone` and `cloud` and remove the old web job",
      "Root Directory: `cloud/web`",
      '"Include files outside the root directory in the Build Step" on',
      "Change nothing else.",
      "Instant Rollback",
      "expected red",
    ])
      assert.ok(g6.includes(s), `Gate 6 lacks ${s}`);
  });
  it("Gate 7 holds the D18 commands, in order, with the retag rollback", () => {
    const g7 = section(GATE7);
    const steps = [
      "**Never `git pull` the old checkout before the switch.**",
      "OLD=<old checkout>",
      'git clone https://github.com/Nit-1997/open-agent-bot "$NEW"',
      "git checkout <main commit after M6>",
      'node cloud/deploy/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy --copy --dry-run',
      'node cloud/deploy/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy --copy',
      `docker compose -p oab-gate7 ${COMPOSE} --env-file cloud/deploy/.env-nextjs --profile local run --rm --no-deps --build agent node -e "import('./dist/config.js').then(m=>{try{m.loadHostedConfig(process.env);console.log('hosted config ok')}catch(e){console.log(e.name==='ConfigError'?e.message:e.name+' '+(e.code??''));process.exit(1)}})"`,
      ". scripts/preview-preflight.sh",
      'P="docker compose -p oab-gate7 --env-file cloud/deploy/.env-nextjs -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --profile local"',
      "preflight $P && $P up -d --build search renderer agent web",
      "http://localhost:18300",
      "$P down",
      "docker volume rm $(docker volume ls -q --filter label=com.docker.compose.project=oab-gate7)",
      `docker compose ${COMPOSE} --env-file cloud/deploy/.env-nextjs --profile local config --format json | jq '{name, volumes: [.volumes[].name]}'`,
      'git -C "$OLD" rev-parse HEAD',
      "docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Names}} {{.Image}} {{.CreatedAt}}'",
      "docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Label \"com.docker.compose.service\"}} {{.Image}}'",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the documented shell command strips the image tag with ${img%:*}
      'docker tag "$img" "${img%:*}:rollback-$SHA"',
      LIVE_UP,
      "curl -fsS http://127.0.0.1:8000/health",
      "curl -fsS https://<public agent host>/health",
      "**without `--build`**",
      'while read -r svc img tag; do docker tag "$tag" "$img"; done < "$HOME/open-agent-rollback.txt"',
      OLD_COMMANDS[1],
      OLD_COMMANDS[2],
      'while read -r svc img tag; do docker image rm "$tag"; done < "$HOME/open-agent-rollback.txt"',
    ];
    let at = -1;
    for (const s of steps) {
      const i = g7.indexOf(s, at + 1);
      assert.ok(i > at, `Gate 7 lacks (or misorders) ${s}`);
      at = i;
    }
    for (const n of ["searxng-data", "caddy-data", "caddy-config", "ollama-data"]) assert.ok(g7.includes(`\`open-agent-bot_${n}\``), n);
  });
  it("every shell line in cloud/README.md is in cloud/deploy/doc-commands.json as owner-only, with a reason", () => {
    const r = loadOwnerDocs(join(ROOT, "cloud/deploy/doc-commands.json"), ROOT);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.manifest.files, ["cloud/README.md"]);
    assert.ok(r.extracted.some((c) => c.command === LIVE_UP));
  });
});

describe("cloud/SECURITY.md", () => {
  const SEC = read("cloud/SECURITY.md");
  const ROOT_SEC = read("SECURITY.md");
  const baseline = spawnSync("git", ["-C", ROOT, "show", "4124272:SECURITY.md"], { encoding: "utf8" });
  it("holds the hosted threat model that left SECURITY.md, verbatim but for the moved test command", () => {
    assert.equal(baseline.status, 0, baseline.stderr);
    const old = baseline.stdout.slice(baseline.stdout.indexOf("### Threat model"));
    const want = old.replace("`npm run test:supabase -w @oab/core`", "`npm run test:supabase -w @oab/cloud-agent`");
    assert.notEqual(want, old);
    assert.ok(SEC.includes(want.trimEnd()), "cloud/SECURITY.md differs from the moved section");
    assert.match(linesOf(SEC)[0], /^# /);
    assert.deepEqual(htmlProblems(SEC), []);
  });
  it("SECURITY.md keeps only the pointer", () => {
    const hosted = ROOT_SEC.slice(ROOT_SEC.indexOf("## Hosted service"));
    assert.match(hosted, /Hosted service: see \[cloud\/SECURITY\.md\]\(cloud\/SECURITY\.md\)\./);
    for (const s of ["### Threat model", "- **Invite-only accounts.**", "- **Stale admin capabilities.**"])
      assert.ok(!ROOT_SEC.includes(s), s);
  });
});
