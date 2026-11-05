import assert from "node:assert/strict";
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
const COMPOSE = "-f cloud/deploy-config/compose.hosted.yml";
const SWITCH = "## Switch-over after M6 (owner only)";
const GATE6 = "## Vercel (Gate 6)";
const GATE7 = "## Move the live stack to `cloud/deploy-config` (Gate 7)";
const GATE8 = "## Apply the M7 migrations (Gate 8)";
const GATE9 = "## Open signups (Gate 9)";
const CLOSE = "### Emergency close";
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
const BACKEND = "--env-file cloud/deploy-config/env-files/backend/.env";
const BOTH = `${BACKEND} --env-file cloud/deploy-config/env-files/frontend/.env`;
const LIVE_UP = `docker compose -f cloud/deploy-config/compose.hosted.yml ${BOTH} --profile local up -d --build`;

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
      `\`docker compose ${COMPOSE} ${BOTH} --profile local up -d --build\``,
      `\`docker compose ${COMPOSE} ${BACKEND} cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt`,
      `\`CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose ${COMPOSE} ${BACKEND} up -d --build\``,
      `\`docker compose ${COMPOSE} ${BACKEND} --profile ollama up -d\``,
      `\`docker compose ${COMPOSE} ${BACKEND} exec agent node dist/scripts/rotateCredentials.js\``,
      "npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w @oab/cloud-e2e",
      "`cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5`",
      "`supabase --workdir cloud …`",
      "Root Directory `cloud/web`",
      "`cloud/deploy-config/env-files/backend/.env`",
      "`make web`",
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
    for (const l of linesOf(current).filter((x) => /(?<![\w./-])deploy-config\//.test(x)))
      assert.match(
        l,
        /env-files\.mjs --from <that checkout>\/cloud\/deploy --to cloud\/deploy-config\/env-files .*`--from <that checkout>\/deploy-config`/,
        l,
      );
    for (const l of linesOf(HOSTED.slice(HOSTED.indexOf(SWITCH))).filter((x) =>
      /(?<![\w./-])deploy-config|compose\.hosted\.yml`|-f compose\.hosted/.test(x),
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
    for (const h of [
      "## Run the hosted stack",
      "## Develop the hosted stack",
      "## End-to-end demo",
      "## Evals",
      "## Request limits",
      "## Signup modes",
      SWITCH,
      GATE6,
      GATE7,
      GATE8,
      GATE9,
      CLOSE,
    ]) {
      const i = HOSTED.indexOf(`\n${h}\n`);
      assert.ok(i > at, `${h} missing or out of order`);
      at = i;
    }
  });
  it("makes the combined sitting from c1c0f4e the primary path, agent first, and keeps the post-revamp precondition", () => {
    const sw = section(SWITCH, GATE6);
    for (const s of [
      "`c1c0f4e`",
      "the old checkout (`$OLD` below)",
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
    const g7 = section(GATE7, GATE8);
    const steps = [
      "**Never `git pull` the old checkout before the switch.**",
      'OLD="<path of the old checkout>"',
      'AGENT_HOST="<public agent host>"',
      'git clone https://github.com/Nit-1997/open-agent-bot "$NEW"',
      "git checkout <main commit after M6>",
      'git -C "$OLD" status --porcelain --ignored -- "$OLD/deploy-config"',
      'node cloud/deploy-config/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy-config/env-files --copy --dry-run',
      'node cloud/deploy-config/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy-config/env-files --copy',
      "node cloud/deploy-config/scripts/env-check.mjs",
      `docker compose -p oab-gate7 ${COMPOSE} ${BOTH} --profile local run --rm --no-deps --build agent node -e "import('./dist/config.js').then(m=>{try{m.loadHostedConfig(process.env);console.log('hosted config ok')}catch(e){console.log(e.name==='ConfigError'?e.message:e.name+' '+(e.code??''));process.exit(1)}})"`,
      ". scripts/preview-preflight.sh",
      `P="docker compose -p oab-gate7 ${BOTH} -f cloud/deploy-config/compose.hosted.yml -f cloud/deploy-config/compose.preview.yml --profile local"`,
      "preflight $P && $P up -d --build search renderer agent web",
      "http://localhost:18300",
      "$P down",
      "docker volume rm $(docker volume ls -q --filter label=com.docker.compose.project=oab-gate7)",
      `docker compose ${COMPOSE} ${BOTH} --profile local config --format json --no-env-resolution | jq '{name, volumes: [.volumes[].name]}'`,
      `test -f "$OLD/.env" && grep -oE '^(CADDYFILE|CADDY_BIND|COMPOSE_PROFILES)=' "$OLD/.env"`,
      'git -C "$OLD" rev-parse HEAD',
      "docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Names}} {{.Image}} {{.CreatedAt}}'",
      "docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Label \"com.docker.compose.service\"}} {{.Image}}'",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the documented shell command strips the image tag with ${img%:*}
      'docker tag "$img" "${img%:*}:rollback-$SHA"',
      'test "$(wc -l < "$HOME/open-agent-rollback.txt")" -eq "$want"',
      LIVE_UP,
      "curl -fsS http://127.0.0.1:8000/health",
      'curl -fsS "https://$AGENT_HOST/health"',
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
  it("names no personal path or live host, records the old .env names and profiles, allows two retag lines, checks the tunnel and documents the old web window", () => {
    assert.doesNotMatch(HOSTED, /\/Users\/|worksimulation/);
    const g6 = section(GATE6, GATE7);
    assert.ok(g6.includes("do steps 3 to 5 of the sitting back to back instead"));
    const g7 = section(GATE7, GATE8);
    for (const s of [
      "`CADDYFILE`, `CADDY_BIND` and `COMPOSE_PROFILES`",
      "the same `--profile` flags",
      "or two (agent, renderer) if the web app isn't part of the live project",
      "Confirm the tunnel (cloudflared) runs outside the compose project",
      "legacy `deploy-config/` lines",
      "### Old web app against the new agent",
      "the same 38 method and path pairs",
      "npm run compat -w @oab/cloud-e2e",
      "known `c1c0f4e` bug",
    ])
      assert.ok(g7.includes(s), `Gate 7 lacks ${s}`);
  });
  it("every shell line in cloud/README.md is in cloud/deploy-config/doc-commands.json as owner-only, with a reason", () => {
    const r = loadOwnerDocs(join(ROOT, "cloud/deploy-config/doc-commands.json"), ROOT);
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.manifest.files, ["cloud/README.md"]);
    assert.ok(r.extracted.some((c) => c.command === LIVE_UP));
  });
});

const inOrder = (text, steps, what) => {
  let at = -1;
  for (const s of steps) {
    const i = text.indexOf(s, at + 1);
    assert.ok(i > at, `${what} lacks (or misorders) ${s}`);
    at = i;
  }
};

describe("M7 runbooks (Gates 8 and 9)", () => {
  const LIVE = '"$LIVE_DB_URL"';
  const PLAN = "node cloud/supabase/scripts/check-push-plan.mjs";
  const BODIES = "node cloud/supabase/scripts/check-old-bodies.mjs";
  const ADMIN_ENV = "set -a; . cloud/deploy-config/env-files/ops/.env; set +a";

  it("documents the request limits, the single-process slots and the three signup modes", () => {
    const limits = section("## Request limits", "## Signup modes");
    for (const s of ["`LIMIT_RUNNING_PER_USER`", "`LIMIT_REQUESTS_PER_MONTH`", "`usage_unavailable`", "admins included", "database leases"])
      assert.ok(limits.includes(s), `Request limits lacks ${s}`);
    const modes = section("## Signup modes", SWITCH);
    for (const s of ["| `invite` |", "| `waitlist` |", "| `open` |", "`signups_per_ip_day`", "Turnstile", "two months"])
      assert.ok(modes.includes(s), `Signup modes lacks ${s}`);
    assert.match(HOSTED, /\| `TURNSTILE_SECRET_KEY` \| unset \|/);
  });

  it("Gate 8 runs D21 in order: check, URL, old bodies, dry run, history repair, push, check, agent, merge, smoke", () => {
    const g8 = section(GATE8, GATE9);
    inOrder(
      g8,
      [
        "`20261104092535_request_usage.sql`",
        "`20261104113650_signup_modes.sql`",
        "don't use `supabase link`",
        "needs no `config.toml`",
        "**session pooler**",
        "`?sslmode=require`",
        ADMIN_ENV,
        "node cloud/supabase/scripts/configure-auth.mjs --check",
        "read -s LIVE_DB_URL",
        "unset LIVE_DB_URL",
        `psql ${LIVE} -XAtc "select pg_get_functiondef('private.before_user_created(jsonb)'::regprocedure)`,
        `psql ${LIVE} -XAtc "$(${BODIES} --query)" | ${BODIES}`,
        "exit 3 means the history needs repair",
        `supabase --workdir cloud db push --db-url ${LIVE} --dry-run | ${PLAN}`,
        "History repair, only after exit 3",
        "may be empty",
        "`pre-M7 objects present`",
        `psql ${LIVE} -XAtc "$(${PLAN} --pre-m7-query)"`,
        `supabase --workdir cloud migration repair --status applied $(${PLAN} --pre-m7-versions) --db-url ${LIVE}`,
        `supabase --workdir cloud db push --db-url ${LIVE}\n`,
        `supabase --workdir cloud db push --db-url ${LIVE} --dry-run | ${PLAN} --applied`,
        "unset LIVE_DB_URL",
        "`signup mode: waitlist, no drift`",
        "`[limits]`",
        LIVE_UP,
        "Merge `revamp/m7` into `main`",
        "test-users.mjs --human-checked",
        "APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e",
        "**Rollback.**",
        "read -s LIVE_DB_URL",
        `psql ${LIVE} -v ON_ERROR_STOP=1 -f cloud/supabase/rollback/m7.sql`,
        `psql ${LIVE} -XAtc "$(${BODIES} --query)" | ${BODIES}`,
        "unset LIVE_DB_URL",
      ],
      "Gate 8",
    );
  });

  it("Gate 8 never exports the URL, writes it to a file or puts it on a command line literally, and unsets it after every read", () => {
    const g8 = section(GATE8, GATE9);
    assert.doesNotMatch(HOSTED, /export\s+LIVE_DB_URL|LIVE_DB_URL=/);
    assert.doesNotMatch(HOSTED, /postgres(?:ql)?:\/\/[^\s"`]*@/);
    const cmds = extractCommands(g8, "cloud/README.md").map((c) => c.command);
    const reads = cmds.filter((c) => c === "read -s LIVE_DB_URL").length;
    assert.equal(reads, 2);
    assert.ok(cmds.filter((c) => c === "unset LIVE_DB_URL").length >= reads);
    for (const c of cmds.filter((x) => x.includes("LIVE_DB_URL") && !/^(read -s|unset) LIVE_DB_URL$/.test(x)))
      assert.ok(c.includes(LIVE) || c.startsWith('case "$LIVE_DB_URL"'), `unquoted URL: ${c}`);
    for (const c of cmds.filter((x) => /\bdb push\b/.test(x))) assert.ok(c.includes(`--db-url ${LIVE}`), c);
    assert.ok(!cmds.some((c) => /supabase (link|config push)|--linked/.test(c)));
  });

  it("Gate 9 runs the owner steps in order and ends with the open command, then the emergency close", () => {
    const g9 = section(GATE9);
    inOrder(
      g9,
      [
        "`LIMIT_REQUESTS_PER_MONTH`",
        "`public.signup_settings`",
        "update public.signup_settings set signups_per_hour",
        "Turnstile → Add widget",
        "Vercel preview hostname",
        "`TURNSTILE_SECRET_KEY`",
        "`NEXT_PUBLIC_TURNSTILE_SITE_KEY`",
        "redeploy the web app on Vercel",
        "redeploy the agent",
        "grep -cE '^TURNSTILE_SECRET_KEY=[0-9]x0{30,}[A-Z]{2}$' cloud/deploy-config/env-files/backend/.env",
        "grep -cE '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=[0-9]x0{20}[A-Z]{2}$' cloud/deploy-config/env-files/frontend/.env",
        ADMIN_ENV,
        "node cloud/supabase/scripts/blocked-domains.mjs --apply",
        "node cloud/supabase/scripts/blocked-domains.mjs --check",
        "`<!-- DRAFT-NOT-REVIEWED -->`",
        "grep -c DRAFT-NOT-REVIEWED cloud/web/content/terms.md cloud/web/content/privacy.md",
        "Vercel → Firewall",
        "`/login`, `/auth/*` and `/api/human-check`",
        "client IP forwarding",
        "Resend",
        "`SMTP_SENDER_EMAIL`",
        "`cloud-supabase`",
        "browser tool from your egress IP",
        "fill the global signup caps",
        "SIGNUP_MODE=open node cloud/supabase/scripts/configure-auth.mjs --apply --i-confirm-open-signups",
        "SIGNUP_MODE=open node cloud/supabase/scripts/configure-auth.mjs --check",
        "admin Usage tab",
        CLOSE,
        "only `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`",
        "turns GoTrue's signups off first",
        "existing accounts keep working",
        ADMIN_ENV,
        "SIGNUP_MODE=waitlist node cloud/supabase/scripts/configure-auth.mjs --close",
      ],
      "Gate 9",
    );
  });

  it("names the agent host only through the placeholder", () => {
    const g9 = section(GATE9);
    assert.ok(g9.includes('AGENT_HOST="<public agent host>"'));
    assert.ok(g9.includes("`<APP_HOST>`"));
    assert.doesNotMatch(g9, /https:\/\/[a-z0-9-]+\.[a-z]/i);
  });
});

describe("cloud/SECURITY.md", () => {
  const SEC = read("cloud/SECURITY.md");
  const ROOT_SEC = read("SECURITY.md");
  const fixture = read("cloud/deploy-config/test/fixtures/security-pre-m6.md");
  it("holds the hosted threat model that left SECURITY.md, verbatim but for the moved test command and the M7 request-limit and admin-capability edits", () => {
    const old = fixture.slice(fixture.indexOf("### Threat model"));
    const want = old
      .replace("`npm run test:supabase -w @oab/core`", "`npm run test:supabase -w @oab/cloud-agent`")
      .replace(" The full design is `docs/superpowers/specs/2026-10-31-supabase-auth-design.md`.", "");
    assert.notEqual(want, old);
    const added = SEC.slice(SEC.indexOf("- **Request limits.**"), SEC.indexOf("- **Agent host.**"));
    assert.match(
      added,
      /^- \*\*Request limits\.\*\* [^\n]+\n- \*\*Admin capabilities\.\*\* [^\n]+\n- \*\*Signups\.\*\* [^\n]+\n- \*\*Human check\.\*\* [^\n]+\n- \*\*Account deletion\.\*\* [^\n]+\n$/,
    );
    const m7 = want
      .replace("- **Agent host.**", `${added}- **Agent host.**`)
      .replace(/\n### Known limitations\n\n- \*\*Stale admin capabilities\.\*\* [^\n]+\n/, "");
    assert.notEqual(m7, want);
    assert.ok(!m7.includes("### Known limitations"));
    assert.ok(SEC.includes(m7.trimEnd()), "cloud/SECURITY.md differs from the moved section plus the M7 edits");
    assert.match(
      added,
      /a demoted admin loses private-network models and the operator gateway within 30 s, including in existing chats; in-flight runs are aborted\./i,
    );
    assert.match(linesOf(SEC)[0], /^# /);
    assert.deepEqual(htmlProblems(SEC), []);
  });
  it("states the M7 signup, human-check and delete rules and ends with the accepted risks", () => {
    for (const s of [
      "only a Google sign-up",
      "throwaway list",
      "invited ones included",
      "the form only; see the accepted risk on direct email-link requests",
      "fails closed",
      "test keys are refused outside the local test stack",
      "peppered SHA-256 of the email",
      "up to two months",
    ])
      assert.ok(SEC.includes(s), `cloud/SECURITY.md lacks ${s}`);
    const risks = SEC.slice(SEC.indexOf("\n### Accepted risks\n"));
    assert.ok(SEC.indexOf("\n### Accepted risks\n") > SEC.indexOf("- **Agent host.**"));
    for (const s of [
      "drive the agent's browser tool, and its requests leave from the owner's network and IP address",
      "private-network guard stays on",
      "fill the hourly or daily signup cap",
      "Bots can drive Google's sign-in flow",
      "GoTrue's own `/auth/v1/otp` endpoint takes the publishable key and has no captcha",
      "in `open` the `before-user-created` hook refuses every email sign-up",
      "`rate_limit_email_sent`",
      "best effort",
      "Gate 9 in [README.md](README.md)",
    ])
      assert.ok(risks.includes(s), `Accepted risks lacks ${s}`);
  });

  it("SECURITY.md keeps only the pointer", () => {
    const hosted = ROOT_SEC.slice(ROOT_SEC.indexOf("## Hosted service"));
    assert.match(hosted, /Hosted service: see \[cloud\/SECURITY\.md\]\(cloud\/SECURITY\.md\)\./);
    for (const s of ["### Threat model", "- **Invite-only accounts.**", "- **Stale admin capabilities.**"])
      assert.ok(!ROOT_SEC.includes(s), s);
  });
});
