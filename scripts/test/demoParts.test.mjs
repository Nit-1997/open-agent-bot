import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { functionsOf, LIB, libOf, libProblems, MILESTONES, PARTS, PARTS_DIR, partProblems, partsOf } from "../demo/partChecks.mjs";
import { addIds, DOCS, idProblems, renderAll, renderDoc } from "../docs/render-docs.mjs";

const read = (f) => readFileSync(f, "utf8");
const good = (body) => `#!/usr/bin/env bash\nset -u\n. "$(dirname "$0")/lib.sh"\n${body}\n`;

describe("demo part scripts", () => {
  it("has parts 0 to 9 and the shared lib", () => {
    assert.deepEqual(
      PARTS,
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `part-${n}.sh`),
    );
    for (const p of PARTS) assert.ok(existsSync(join(PARTS_DIR, p)), p);
    assert.ok(existsSync(LIB));
    assert.deepEqual(
      readdirSync(PARTS_DIR)
        .filter((f) => f.endsWith(".sh"))
        .sort(),
      ["lib.sh", ...PARTS].sort(),
    );
  });

  it("every committed part passes the static checks", () => {
    for (const p of PARTS) assert.deepEqual(partProblems(read(join(PARTS_DIR, p)), p), [], p);
  });

  it("the lib sources the preview preflight, refuses non-oab names and records exit codes with reasons", () => {
    assert.deepEqual(libProblems(read(LIB)), []);
  });

  it("every part and the lib parse with bash -n", () => {
    for (const f of [LIB, ...PARTS.map((p) => join(PARTS_DIR, p))]) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
  });

  it("requires set -u and the lib in every part", () => {
    assert.match(partProblems("#!/usr/bin/env bash\necho hi\n", "x.sh").join("\n"), /set -u/);
    assert.match(partProblems("#!/usr/bin/env bash\nset -u\necho hi\n", "x.sh").join("\n"), /lib\.sh/);
    assert.deepEqual(partProblems(good("echo hi"), "x.sh"), []);
  });

  it("refuses docker compose without an oab- project", () => {
    for (const bad of [
      "docker compose up -d",
      "docker compose -p open-agent down -v",
      'docker compose -p "$P" down',
      "COMPOSE_PROJECT_NAME=open-agent docker compose up -d",
      "docker compose --project-name open-agent-bot ps",
    ])
      assert.match(partProblems(good(bad), "x.sh").join("\n"), /docker compose/, bad);
    for (const ok of [
      "docker compose -p oab-factory-m5-pkg -f docker-compose.yml --env-file /dev/null down -v",
      "docker compose ls --format json",
      "docker compose version",
      "COMPOSE_PROJECT_NAME=oab-factory-m5-clone docker compose config",
    ])
      assert.deepEqual(partProblems(good(ok), "x.sh"), [], ok);
  });

  it("refuses ports outside 18500-18549", () => {
    for (const bad of [
      "curl http://127.0.0.1:3000/health",
      "docker run -d -p 127.0.0.1:18467:5000 registry:2",
      "STUB_PORT=18465 npx tsx e2e/support/stubModel.ts",
      "x --range 18450-18454",
      "DEMO_RANGE=18515-18560 y",
      "z --port 18550",
      "open http://localhost:8000",
    ])
      assert.match(partProblems(good(bad), "x.sh").join("\n"), /port/, bad);
    for (const ok of [
      "docker run -d --name oab-factory-m5-registry -p 127.0.0.1:18501:5000 registry",
      "x --range 18510-18514 --port 18502",
      "DEMO_RANGE=18515-18519 STUB_PORT=18503 y",
    ])
      assert.deepEqual(partProblems(good(ok), "x.sh"), [], ok);
  });

  it("refuses writes to the real ~/Library", () => {
    for (const bad of [
      'rm -rf "$HOME/Library/Application Support/Open Agent"',
      "mkdir -p ~/Library/Logs/Open\\ Agent",
      'echo x > "$HOME/Library/Logs/Open Agent/x"',
      `cp a "\${HOME}/Library/Application Support/Open Agent/"`,
    ])
      assert.match(partProblems(good(bad), "x.sh").join("\n"), /Library/, bad);
    assert.deepEqual(
      partProblems(
        good(
          `for d in "Application Support/Open Agent" "Logs/Open Agent"; do stat -f '%m %N' "$HOME/Library/$d" 2>/dev/null || echo "absent $d"; done > "$DEMO_DIR/realstate-before.txt"`,
        ),
        "x.sh",
      ),
      [],
    );
  });

  it("every removal names an oab- resource", () => {
    for (const bad of [
      "docker rm -f registry",
      "docker rmi open-agent:local",
      "docker volume rm open-agent-data",
      "docker image rm $(docker image ls -q)",
      "docker buildx rm desktop-linux",
      "docker system prune -af",
      "docker container remove x",
    ])
      assert.match(partProblems(good(bad), "x.sh").join("\n"), /remov|prune/, bad);
    for (const ok of [
      "docker rm -f -v oab-factory-m5-registry",
      "docker buildx rm oab-factory-m5-builder",
      "docker image rm $(docker image ls -a --digests --format '{{.Repository}}@{{.Digest}}' | grep oab-m5-)",
      "docker image rm $(m5_images)",
    ])
      assert.deepEqual(partProblems(good(ok), "x.sh"), [], ok);
    assert.match(partProblems(good("docker image rm $(m5_imagez)"), "x.sh").join("\n"), /oab-/);
  });

  it("never touches the live open-agent-bot containers", () => {
    for (const bad of [
      "docker logs open-agent-bot-agent-1",
      "docker inspect open-agent-bot-web-1",
      "docker exec open-agent-bot-agent-1 ls",
    ])
      assert.match(partProblems(good(bad), "x.sh").join("\n"), /open-agent-bot/, bad);
    assert.deepEqual(
      partProblems(
        good(`docker ps --format '{{.Names}} {{.Status}}' | grep -E '^open-agent-bot' > "$DEMO_DIR/live-before.txt" || true`),
        "x.sh",
      ),
      [],
    );
  });

  it("parts 6 and 9 remove M5 images only through lib.sh's anchored m5_images helper", () => {
    assert.match(
      read(LIB),
      /^m5_images\(\) \{ docker image ls -a --digests --format '\{\{\.Repository\}\}@\{\{\.Digest\}\}' \| grep -E '\(\^\|\/\)oab-m5-' \| grep -v '@<none>\$'; \}$/m,
    );
    for (const p of ["part-6.sh", "part-9.sh"]) {
      const text = read(join(PARTS_DIR, p));
      assert.match(text, /docker image rm \\\$\(m5_images\)/, p);
      assert.doesNotMatch(text, /grep oab-m5-/, p);
    }
  });

  it("starts the registry from lib.sh's digest-pinned REGISTRY_IMAGE", () => {
    assert.match(read(LIB), /^REGISTRY_IMAGE="registry:2@sha256:[0-9a-f]{64}"$/m);
    const p2 = read(join(PARTS_DIR, "part-2.sh"));
    assert.match(p2, /-p 127\.0\.0\.1:18501:5000 \$REGISTRY_IMAGE"/);
    assert.doesNotMatch(p2, /registry:2/);
  });

  it("recall only returns an existing folder under $TMPDIR or the demo dir, never one with ..", () => {
    const demo = `.factory/m5/test-recall-${process.pid}`;
    const repo = join(PARTS_DIR, "../../..");
    const base = realpathSync(mkdtempSync("/var/tmp/oab-recall-tmpdir-"));
    const tmp = mkdtempSync(join(base, "tmp."));
    const outside = mkdtempSync("/var/tmp/oab-recall-outside-");
    const recall = (path) =>
      spawnSync("bash", ["-c", `. scripts/demo/m5/lib.sh; printf '%s\\n' "$1" > "$DEMO_DIR/x.path"; recall x`, "part-test", path], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: demo, TMPDIR: base },
      });
    try {
      const ok = recall(tmp);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout, realpathSync(tmp));
      for (const [path, why] of [
        [`${tmp}/../${tmp.split("/").pop()}`, /contains \.\./],
        [join(tmp, "missing"), /not a directory/],
        [outside, /outside/],
        ["/", /outside/],
        [base, /outside/],
      ]) {
        const r = recall(path);
        assert.equal(r.status, 1, path);
        assert.match(r.stderr, why, path);
      }
      symlinkSync(outside, join(tmp, "link"));
      assert.match(recall(join(tmp, "link")).stderr, /outside/);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(repo, demo), { recursive: true, force: true });
    }
  });

  it("need and exits record the real reason, not a generic UNEXPECTED", () => {
    const demo = `.factory/m5/test-need-${process.pid}`;
    const repo = join(PARTS_DIR, "../../..");
    const sh = (body) =>
      spawnSync("bash", ["-c", `. scripts/demo/m5/lib.sh; ${body}`, "part-test"], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: demo },
      });
    const codes = () => read(join(repo, demo, "exit-codes.txt"));
    try {
      assert.equal(sh(`need fresh "DEMO_STATE is not fresh" "true"`).status, 0);
      const refused = sh(`need fresh "DEMO_STATE is not fresh" "false"; echo after`);
      assert.equal(refused.status, 1);
      assert.doesNotMatch(refused.stdout, /after/);
      assert.match(codes(), /\tfresh\t1\tREFUSED: DEMO_STATE is not fresh; part-test stopped\n/);
      assert.equal(sh(`exits tamper 1 "tampered copy FAILED (expected)" "false"`).status, 0);
      assert.match(codes(), /\ttamper\t1\ttampered copy FAILED \(expected\)\n/);
      assert.equal(sh(`exits tamper 1 "tampered copy FAILED (expected)" "true"`).status, 1);
      assert.match(codes(), /\ttamper\t0\tUNEXPECTED: tamper exited 0, expected 1; part-test stopped\n/);
      assert.doesNotMatch(codes(), /\tfresh\t1\tUNEXPECTED/);
    } finally {
      rmSync(join(repo, demo), { recursive: true, force: true });
    }
  });

  it("part 7 refuses a used state folder, present images or demo volumes before the app test, and starts a fresh mock.log", () => {
    const p7 = read(join(PARTS_DIR, "part-7.sh"));
    const at = (re) => p7.search(re);
    for (const re of [
      /^need state-fresh /m,
      /^need images-absent /m,
      /^need demo-volumes-absent /m,
      /^run mock-log-reset ": > \\"\$DEMO_DIR\/mock\.log\\""/m,
    ])
      assert.ok(at(re) >= 0 && at(re) < at(/^run playwright-app /m), String(re));
    assert.ok(at(/^run mock-log-reset /m) < at(/mockReleasesCli\.mts/));
  });

  it("part 3 shows one tamper refusal on screen and the notes change lines", () => {
    const p3 = read(join(PARTS_DIR, "part-3.sh"));
    assert.match(p3, /^exits tamper-shasum 1 "[^"]*FAILED[^"]*" "\(cd \\"\$TD\\" && shasum -a 256 -c SHA256SUMS\)"$/m);
    assert.match(p3, /^run tamper-clean "rm -rf \\"\$TD\\""$/m);
    assert.match(p3, /^run notes-changes .*## Changes.*\$A\/release\/notes\.md"$/m);
  });

  it("parts 0 and 9 check networks and the open-agent project", () => {
    const p0 = read(join(PARTS_DIR, "part-0.sh"));
    const p9 = read(join(PARTS_DIR, "part-9.sh"));
    for (const t of [p0, p9]) assert.match(t, /^no_open_agent_project$/m);
    assert.match(p0, /docker network ls --format '\{\{\.Name\}\}';.*grep -E '\^oab-\(factory-\)\?m5'/);
    assert.match(p9, /^absent no-m5-networks "[^"]+" "docker network ls --format '\{\{\.Name\}\}' \| grep -E 'oab-\(factory-\)\?m5'"$/m);
    assert.ok(p9.search(/^no_open_agent_project$/m) > p9.search(/^absent no-m5-images /m));
  });

  it("ignores comments", () => {
    assert.deepEqual(partProblems(good("# docker compose up -d on port 3000"), "x.sh"), []);
  });

  it("the lib check fails without the preflight, the oab guard or the exit-code record", () => {
    assert.match(libProblems("set -u\n").join("\n"), /preview-preflight/);
    assert.match(libProblems(". scripts/preview-preflight.sh\n").join("\n"), /oab/);
  });
});

describe("m6 demo part scripts", () => {
  const M6 = MILESTONES.m6.dir;
  const M6_LIB = libOf("m6");
  const m6 = (body) => partProblems(good(body), "x.sh", "m6");
  const refuses = (body, re) => assert.match(m6(body).join("\n"), re, body);
  const passes = (body) => assert.deepEqual(m6(body), [], body);

  it("has parts 0 to 8 and the shared lib", () => {
    assert.deepEqual(
      partsOf("m6"),
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `part-${n}.sh`),
    );
    assert.deepEqual(
      readdirSync(M6)
        .filter((f) => f.endsWith(".sh"))
        .sort(),
      ["lib.sh", ...partsOf("m6")].sort(),
    );
  });

  it("every committed m6 part and the lib pass the static checks and parse with bash -n", () => {
    for (const p of partsOf("m6")) assert.deepEqual(partProblems(read(join(M6, p)), p, "m6"), [], p);
    assert.deepEqual(libProblems(read(M6_LIB), "m6"), []);
    for (const f of [M6_LIB, ...partsOf("m6").map((p) => join(M6, p))]) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
  });

  it("keeps the M6 port map: 18600-18649 plus the preview's 18300 and 18800", () => {
    for (const bad of [
      "curl -fsS http://127.0.0.1:8000/health",
      "OPEN_AGENT_PORT=18520 x",
      "open http://localhost:18301",
      "y --port 18650",
    ])
      refuses(bad, /port/);
    for (const ok of ["OPEN_AGENT_PORT=18610 x", "APP_ORIGIN=http://localhost:18300 y", "AGENT_ORIGIN=http://127.0.0.1:18800 z"])
      passes(ok);
  });

  it("never names the open-agent or open-agent-bot project without -p oab-", () => {
    for (const bad of [
      "docker compose -f cloud/deploy/compose.hosted.yml up -d",
      "docker compose -p open-agent-bot ps",
      "docker compose --project-name open-agent down",
      "docker compose up -d --build",
    ])
      refuses(bad, /docker compose|open-agent/);
    passes("docker compose -p oab-factory-m6-hosted -f cloud/deploy/compose.hosted.yml ps");
  });

  it("refuses a bare down -v in a part", () => {
    for (const bad of [
      "docker compose -p oab-factory-m6-hosted down -v",
      "docker compose -p oab-factory-m6-oss -f docker-compose.yml down --volumes --remove-orphans",
    ])
      refuses(bad, /down -v/);
    passes("down_hosted");
  });

  it("refuses docker exec and logs, and docker inspect without --format or on a non-oab object", () => {
    for (const bad of [
      "docker exec oab-factory-m6-hosted-agent-1 ls",
      "docker logs oab-factory-m6-hosted-agent-1",
      "docker compose -p oab-factory-m6-hosted logs agent",
      "docker compose -p oab-factory-m6-hosted exec agent ls",
    ])
      refuses(bad, /exec or logs/);
    for (const bad of [
      "docker inspect oab-factory-m6-hosted-agent-1",
      "docker image inspect oab-factory-m6-hosted-agent",
      "docker inspect --format '{{.Mounts}}' searxng",
      "docker image inspect --format '{{.Id}}' open-agent-bot-agent",
      `docker inspect --format '{{json .Config.Env}}' "$c"`,
    ])
      refuses(bad, /docker inspect/);
    for (const ok of [
      "docker image inspect --format '{{json .Config.Cmd}} {{.Config.WorkingDir}}' oab-factory-m6-hosted-agent",
      `run mounts "docker inspect --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} {{end}}' oab-factory-m6-hosted-search-1"`,
      "inspect_oab '{{.Name}}' \"$c\"",
    ])
      passes(ok);
  });

  it("lets the lib inspect a variable only inside a helper that calls require_oab_ref first", () => {
    const lib = (body) => `. "$REPO/scripts/preview-preflight.sh"\nrequire_oab oab-x\nEXITS=exit-codes.txt\n${body}\n`;
    assert.deepEqual(
      libProblems(lib(`inspect_oab() {\n  require_oab_ref "$2" || return 1\n  docker inspect --format "$1" "$2"\n}`), "m6"),
      [],
    );
    assert.match(libProblems(lib(`inspect_oab() {\n  docker inspect --format "$1" "$2"\n}`), "m6").join("\n"), /require_oab_ref/);
    assert.match(libProblems(lib(`docker inspect --format "$1" "$2"`), "m6").join("\n"), /guarded helper/);
  });

  it("lets the lib run down -v only in a down_* helper after preflight … || return 1", () => {
    const lib = (body) => `. "$REPO/scripts/preview-preflight.sh"\nrequire_oab oab-x\nEXITS=exit-codes.txt\n${body}\n`;
    const P = "docker compose -p oab-factory-m6-hosted -f x.yml";
    assert.deepEqual(libProblems(lib(`down_hosted() {\n  preflight ${P} || return 1\n  ${P} down -v --remove-orphans\n}`), "m6"), []);
    assert.match(libProblems(lib(`down_hosted() {\n  ${P} down -v\n}`), "m6").join("\n"), /without a preflight/);
    assert.match(libProblems(lib(`wipe() {\n  preflight ${P} || return 1\n  ${P} down -v\n}`), "m6").join("\n"), /down_\* helper/);
    assert.match(libProblems(lib(`${P} down -v`), "m6").join("\n"), /guarded helper/);
  });

  it("pipes compose config only into a names-only jq filter", () => {
    for (const bad of [
      "docker compose -p oab-factory-m6-hosted -f cloud/deploy/compose.hosted.yml config",
      "docker compose -f cloud/deploy/compose.hosted.yml config --format json | jq .",
      "docker compose -f cloud/deploy/compose.hosted.yml config --format json > x.json",
      "docker compose --env-file /dev/null -f cloud/deploy/compose.hosted.yml config --format json --no-env-resolution | jq .services",
    ])
      refuses(bad, /names-only jq/);
    for (const ok of [
      "docker compose config --format json | jq -r .name",
      "docker compose -f cloud/deploy/compose.hosted.yml config --format json | jq -r .name",
      "docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local config --format json | jq_names",
      "docker compose --env-file /dev/null -f cloud/deploy/compose.hosted.yml --profile local config --format json --no-env-resolution | jq_names_ports",
      "preflight docker compose -p oab-factory-m6-hosted -f x/deploy-config/compose.preview.yml",
    ])
      passes(ok);
  });

  it("refuses set -x, env, printenv, export -p and declare -p", () => {
    for (const bad of [
      "set -x",
      "set -eux",
      "set -o xtrace",
      "env",
      "env | sort",
      "printenv OPENAI_API_KEY",
      "x; printenv",
      "export -p",
      "declare -p",
    ])
      refuses(bad, /set -x|env/);
    for (const ok of [
      "set -euo pipefail",
      "node cloud/deploy/scripts/env-files.mjs --from a/deploy-config --to b/cloud/deploy --copy",
      'docker compose -p oab-factory-m6-hosted --env-file "$M6/cloud/deploy/.env-nextjs" ps',
    ])
      passes(ok);
  });

  it("never sets GITHUB_ACTIONS, RUNNER_TEMP or GITHUB_WORKSPACE", () => {
    for (const bad of [
      "GITHUB_ACTIONS=true bash scripts/ci/standalone.sh",
      "export RUNNER_TEMP=/tmp/x",
      "docker run --rm -e GITHUB_WORKSPACE=/src img",
      "docker run --rm -e GITHUB_ACTIONS img",
    ])
      refuses(bad, /GITHUB_ACTIONS/);
    passes("unset GITHUB_ACTIONS RUNNER_TEMP GITHUB_WORKSPACE");
  });

  it("feeds env-file values only to grep -F -c -f <(…), never to the screen or argv", () => {
    for (const bad of [
      "cat cloud/deploy/.env-agent",
      "grep SECRET cloud/deploy/.env-agent",
      "sed -n 1p cloud/deploy/env-files/.env-e2e",
      'grep -F -c -e "$(cut -d= -f2 cloud/deploy/.env-agent)" x.log',
      "diff a/deploy-config/.env-agent b/cloud/deploy/.env-agent",
    ])
      refuses(bad, /env-file contents/);
    for (const ok of [
      'grep -F -c -f <(secret_patterns cloud/deploy/.env-* cloud/deploy/env-files/.env-*) "$f"',
      "ls -l cloud/deploy/.env-agent",
      "git check-ignore -v cloud/deploy/.env-agent",
      'install -m 600 cloud/deploy/.env-agent "$OLD/deploy-config/.env-agent"',
      "(set -a && . cloud/deploy/.env-nextjs && set +a && npm run build)",
    ])
      passes(ok);
  });

  it("the m6 lib pins busybox by digest, scopes names and holds the guarded helpers", () => {
    const lib = read(M6_LIB);
    assert.match(lib, /^BUSYBOX="busybox:[\d.]+@sha256:[0-9a-f]{64}"$/m);
    for (const f of [
      "down_hosted",
      "down_oss",
      "down_gate7",
      "inspect_oab",
      "image_inspect_oab",
      "m6_images",
      "secret_patterns",
      "jq_names",
      "jq_names_ports",
    ])
      assert.ok(
        functionsOf(lib).some((x) => x.name === f),
        f,
      );
    assert.match(lib, /^DEMO_DIR="\$\{DEMO_DIR:-\.factory\/m6\/demo\}"$/m);
    assert.match(
      lib,
      /^m6_images\(\) \{ docker image ls --format '\{\{\.Repository\}\}:\{\{\.Tag\}\}' \| grep -E '\^oab-factory-m6-'; \}$/m,
    );
  });

  it("part 8 scans for env-file values through grep -F -c -f <(…) and prints counts only", () => {
    const p8 = read(join(M6, "part-8.sh"));
    assert.match(p8, /grep -F -c -f <\(secret_patterns /);
    assert.match(p8, /unzip -p/);
    assert.match(p8, /^no_open_agent_project$/m);
  });

  it("part 4 rehearses c1c0f4e, tears it down, then 4879d41 with the rollback exercised", () => {
    const p4 = read(join(M6, "part-4.sh"));
    const a = p4.search(/^rehearse c1c0f4e docker-compose\.yml teardown$/m);
    const b = p4.search(/^rehearse 4879d41 compose\.hosted\.yml keep$/m);
    assert.ok(a >= 0 && b > a, "rehearsal order");
    for (const s of ["retag_rollback", "retag_back", "compare_facts", "gate7_config_check", "env-files.mjs"]) assert.ok(p4.includes(s), s);
  });

  it("part 7 lists the build context of a dummy-secret clone with --no-cache and removes the image", () => {
    const p7 = read(join(M6, "part-7.sh"));
    assert.match(p7, /docker build --no-cache/);
    assert.match(p7, /-t oab-factory-m6-ctx:dev/);
    assert.match(p7, /docker image rm oab-factory-m6-ctx:dev/);
  });

  it("the m6 recall only returns folders under $TMPDIR or the demo dir", () => {
    const demo = `.factory/m6/test-recall-${process.pid}`;
    const repo = join(M6, "../../..");
    const outside = mkdtempSync("/var/tmp/oab-m6-recall-outside-");
    const r = spawnSync(
      "bash",
      ["-c", `. scripts/demo/m6/lib.sh; printf '%s\\n' "$1" > "$DEMO_DIR/x.path"; recall x`, "part-test", outside],
      {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: demo },
      },
    );
    try {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /outside/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(repo, demo), { recursive: true, force: true });
    }
  });
});

describe("render-docs", () => {
  const FIXTURE = [
    "# Title",
    "",
    'Some *text* with a [link](https://example.com) and `<div id="x">` inline.',
    "",
    "## Steps",
    "",
    "1. one",
    "2. two",
    "",
    "- [ ] a box",
    "- [x] done",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "```bash",
    'echo "<span id=\\"dup\\">" && docker compose up -d',
    "```",
    "",
    "---",
    "",
    "> quote",
  ].join("\n");

  it("gives every element a unique doc-<file>-<tag>-<n> id, head and body included", () => {
    const html = renderDoc(FIXTURE, { file: "fixture", title: "Fixture" });
    assert.deepEqual(idProblems(html), []);
    const tags = [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*?)?\/?>/g)];
    assert.ok(tags.length > 20);
    for (const t of tags) assert.match(t[0], /\sid="doc-fixture-[a-z0-9]+-\d+"/, t[0]);
    for (const tag of [
      "html",
      "head",
      "meta",
      "title",
      "style",
      "body",
      "main",
      "h1",
      "h2",
      "ol",
      "li",
      "input",
      "table",
      "pre",
      "code",
      "hr",
      "blockquote",
      "a",
    ])
      assert.match(html, new RegExp(`<${tag} [^>]*id="doc-fixture-${tag}-1"`), tag);
    assert.match(html, /&lt;span id=\\&quot;dup\\&quot;&gt;/);
  });

  it("replaces ids already present so they stay unique", () => {
    const html = addIds('<p id="a">x</p><p id="a">y</p><br>', "f");
    assert.equal(html, '<p id="doc-f-p-1">x</p><p id="doc-f-p-2">y</p><br id="doc-f-br-1">');
  });

  it("idProblems reports duplicates and elements without an id", () => {
    assert.deepEqual(idProblems('<html id="a"><body id="a"><p>x</p></body></html>'), ["duplicate id a (2)", "<p> has no id"]);
  });

  it("renders the four repo docs without id problems", () => {
    assert.deepEqual(
      DOCS.map((d) => d.source),
      ["README.md", "docs/INSTALL.md", "docs/RELEASING.md", "SECURITY.md"],
    );
    for (const d of DOCS) assert.deepEqual(idProblems(renderDoc(read(d.path), { file: d.key, title: d.source })), [], d.source);
  });

  it("writes one page per doc plus an index into --out, and refuses a page with an id problem", () => {
    const out = mkdtempSync(join(tmpdir(), "render-docs-"));
    try {
      const written = renderAll({ out });
      assert.deepEqual(written.map((w) => w.split("/").pop()).sort(), [
        "index.html",
        "install.html",
        "readme.html",
        "releasing.html",
        "security.html",
      ]);
      for (const w of written) assert.deepEqual(idProblems(read(w)), [], w);
      assert.match(read(join(out, "index.html")), /href="readme\.html"/);
      assert.throws(() => renderAll({ out, render: () => '<html id="x"><body id="x"></body></html>' }), /duplicate id x/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("the CLI needs --out", () => {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "../docs/render-docs.mjs")], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--out/);
  });
});
