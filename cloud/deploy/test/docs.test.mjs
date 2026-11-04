import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractCommands, htmlProblems } from "../../../scripts/docs/doc-commands.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const linesOf = (text) => text.split("\n");
const README = read("README.md");
const HOSTED = read("cloud/README.md");
const COMPOSE = "-f cloud/deploy/compose.hosted.yml";

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
  it("targets the hosted project in every compose command", () => {
    const prose = linesOf(HOSTED)
      .filter((l) => !l.startsWith("> **Warning.**"))
      .join("\n");
    const spans = [
      ...[...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
      ...extractCommands(HOSTED, "cloud/README.md").map((c) => c.command),
    ];
    const compose = spans.filter((c) => /\bdocker compose\b/.test(c));
    assert.ok(compose.length >= 6);
    for (const c of compose)
      assert.ok(
        c.includes(COMPOSE) || /docker compose -p oab-/.test(c) || c === "docker compose config --format json | jq -r .name",
        `untargeted: ${c}`,
      );
  });
  it("names no pre-M6 hosted path", () => {
    for (const s of ["-f compose.hosted.yml", "-w e2e", "(docs/hosted.md)", "`supabase/", " supabase/scripts/"])
      assert.ok(!HOSTED.includes(s), `cloud/README.md still names ${s}`);
    for (const l of linesOf(HOSTED).filter((x) => x.includes("deploy-config/")))
      assert.match(l, /env-files\.mjs --from <that checkout>\/deploy-config --to cloud\/deploy/, l);
  });
  it("has no raw HTML outside code", () => {
    assert.deepEqual(htmlProblems(HOSTED), []);
  });
});
