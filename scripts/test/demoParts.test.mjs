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
      "docker compose config --format json --no-env-resolution | jq -r .name",
      "docker compose -f cloud/deploy/compose.hosted.yml config --format json --no-env-resolution | jq -r .name",
      "docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local config --format json --no-env-resolution | jq_names",
      "docker compose --env-file /dev/null -f cloud/deploy/compose.hosted.yml --profile local config --format json --no-env-resolution | jq_names_ports",
      "preflight docker compose -p oab-factory-m6-hosted -f x/deploy-config/compose.preview.yml",
    ])
      passes(ok);
  });

  it("runs compose config only with --no-env-resolution", () => {
    refuses("docker compose config --format json | jq -r .name", /--no-env-resolution/);
    refuses("docker compose -f cloud/deploy/compose.hosted.yml --profile local config --format json | jq_names", /--no-env-resolution/);
  });

  it("saves compose up --build output only through redact_build", () => {
    refuses('new_compose "$m6" up -d --build --wait search > "$DEMO_DIR/switch.log" 2>&1', /redact_build/);
    passes('new_compose "$m6" up -d --build --wait search 2>&1 | redact_build > "$DEMO_DIR/switch.log"');
    passes('old_compose "$old" x "$m6" up -d --wait search > "$DEMO_DIR/rollback.log" 2>&1');
  });

  it("redact_build drops the command text of BuildKit RUN lines", () => {
    const r = spawnSync(
      "bash",
      [
        "-c",
        `. scripts/demo/m6/lib.sh\nprintf '%s\\n' '#29 [web build 7/8] RUN test -n "value"' '#30 DONE 0.1s' | redact_build`,
        "part-test",
      ],
      {
        cwd: join(M6, "../../.."),
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: `.factory/m6/test-redact-${process.pid}` },
      },
    );
    rmSync(join(M6, "../../..", `.factory/m6/test-redact-${process.pid}`), { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "#29 [web build 7/8] RUN (command line not saved)\n#30 DONE 0.1s\n");
  });

  it("names no revamp-only commit hash; commit_of resolves each role in commits.json to exactly one commit", () => {
    for (const f of readdirSync(M6).filter((x) => x.endsWith(".sh")))
      for (const h of read(join(M6, f)).match(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g) ?? [])
        assert.ok(["c1c0f4e"].includes(h) || /^0+$/.test(h), `${f} pins ${h}`);
    const roles = Object.keys(JSON.parse(read(join(M6, "commits.json"))));
    const demo = `.factory/m6/test-commits-${process.pid}`;
    const repo = join(M6, "../../..");
    const sh = (body) =>
      spawnSync("bash", ["-c", `. scripts/demo/m6/lib.sh\n${body}`, "part-test"], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: demo },
      });
    try {
      const r = sh(roles.map((x) => `commit_of ${x} || exit 1`).join("\n"));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout
          .trim()
          .split("\n")
          .filter((l) => /^[0-9a-f]{7,}$/.test(l)).length,
        roles.length,
      );
      const bad = sh("commit_of no-such-role");
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /no-such-role/);
    } finally {
      rmSync(join(repo, demo), { recursive: true, force: true });
    }
  });

  it("stops when a scratch dir cannot be made", () => {
    refuses('base="$(scratch "rehearsal-$sha")"', /scratch .*\|\| exit 1/);
    passes('base="$(scratch "rehearsal-$sha")" || exit 1');
    passes('INJ="$(scratch inject)" || exit 1');
  });

  it("compare_facts returns non-zero when the container names differ", () => {
    const demo = `.factory/m6/test-compare-${process.pid}`;
    const repo = join(M6, "../../..");
    const body = [
      'mkdir -p "$DEMO_DIR"',
      'printf "a\\n" > "$DEMO_DIR/x-names.txt"; printf "b\\n" > "$DEMO_DIR/y-names.txt"',
      'for t in x y; do for k in volumes secret containers mounts images; do : > "$DEMO_DIR/$t-$k.txt"; done; done',
      "compare_facts x y /cloud/deploy/ same",
    ].join("\n");
    const r = spawnSync("bash", ["-c", `. scripts/demo/m6/lib.sh\n${body}`, "part-test"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DEMO_DIR: demo },
    });
    try {
      assert.notEqual(r.status, 0, r.stdout);
      assert.doesNotMatch(r.stdout, /same containers|same volumes/);
    } finally {
      rmSync(join(repo, demo), { recursive: true, force: true });
    }
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

  it("part 4 rehearses c1c0f4e, tears it down, then the pre-M6 layout with the rollback exercised", () => {
    const p4 = read(join(M6, "part-4.sh"));
    const a = p4.search(/^rehearse c1c0f4e docker-compose\.yml teardown$/m);
    const b = p4.search(/^rehearse "\$PRE_M6" compose\.hosted\.yml keep$/m);
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

describe("m7 demo part scripts", () => {
  const M7 = MILESTONES.m7.dir;
  const M7_LIB = libOf("m7");
  const m7 = (body) => partProblems(good(body), "x.sh", "m7");
  const refuses = (body, re) => assert.match(m7(body).join("\n"), re, body);
  const passes = (body) => assert.deepEqual(m7(body), [], body);
  const HELPERS = ["browser.mjs", "users.mjs"];
  const repo = join(M7, "../../..");
  const sh = (body, env = {}) =>
    spawnSync("bash", ["-c", `. scripts/demo/m7/lib.sh\n${body}`, "part-test"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DEMO_DIR: `.factory/m7/test-${process.pid}`, ...env },
    });
  const cleanup = () => rmSync(join(repo, `.factory/m7/test-${process.pid}`), { recursive: true, force: true });

  it("has parts 0 to 8, the shared lib and the node helpers, and nothing else", () => {
    assert.deepEqual(
      partsOf("m7"),
      [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `part-${n}.sh`),
    );
    assert.deepEqual(readdirSync(M7).sort(), ["lib.sh", ...partsOf("m7"), ...HELPERS].sort());
  });

  it("every committed m7 part and the lib pass the static checks and parse with bash -n", () => {
    for (const p of partsOf("m7")) assert.deepEqual(partProblems(read(join(M7, p)), p, "m7"), [], p);
    assert.deepEqual(libProblems(read(M7_LIB), "m7"), []);
    for (const f of [M7_LIB, ...partsOf("m7").map((p) => join(M7, p))]) {
      const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
      assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    }
  });

  it("keeps the M7 port map: 18700-18749 only", () => {
    for (const bad of [
      "curl -fsS http://127.0.0.1:8000/health",
      "APP_ORIGIN=http://localhost:18300 x",
      "y --port 18750",
      "z --ports 18600",
    ])
      refuses(bad, /port/);
    for (const ok of ["APP_ORIGIN=http://localhost:18721 x", "STUB_PORT=18722 y", "curl -fsS http://127.0.0.1:18720/health"]) passes(ok);
  });

  it("runs the Supabase CLI only through local-stack.mjs or the 127.0.0.1 migration repair", () => {
    for (const bad of [
      "supabase db push",
      'supabase --workdir cloud db push --db-url "$LIVE_DB_URL"',
      "npx supabase link --project-ref abc",
      "supabase start --workdir /tmp/x",
      "x && supabase stop",
      'supabase --workdir cloud migration repair --status applied 1 --db-url "$URL"',
    ])
      refuses(bad, /Supabase CLI/);
    for (const ok of [
      "node cloud/supabase/scripts/local-stack.mjs start --name oab-m7-demo --ports 18700",
      "node cloud/supabase/scripts/local-stack.mjs push-dry-run --name oab-m7-g8 | node cloud/supabase/scripts/check-push-plan.mjs",
      'supabase --workdir cloud migration repair --status applied "$@" --db-url "postgresql://postgres:postgres@127.0.0.1:18712/postgres?sslmode=disable"',
      "supabase --version",
    ])
      passes(ok);
    refuses("node cloud/supabase/scripts/local-stack.mjs start --name oab-m7-b --ports 18740", /oab-m7-demo and oab-m7-g8/);
  });

  it("never reads a production settings file, and writes the live host pattern without a literal .supabase.co", () => {
    for (const bad of [
      "ls -l cloud/deploy/.env-agent",
      "set -a; . cloud/deploy/.env-nextjs; set +a",
      "x --env-file cloud/deploy/env-files/.env-supabase-admin",
      "grep -c E2E cloud/deploy/env-files/.env-e2e",
    ])
      refuses(bad, /production settings files/);
    refuses("grep -c 'abc.supabase.co' x.log", /\[\.\]supabase\[\.\]co/);
    passes("grep -E -c '[.]supabase[.]co|api[.]supabase[.]com' x.log");
  });

  it("starts background processes only through start_bg, runs psql only against 127.0.0.1, and never captures the screen", () => {
    for (const bad of ["node scripts/demo/m7/agent.mjs &", "nohup next start -p 18721 > x.log", "sleep 5 &"]) refuses(bad, /start_bg/);
    passes("start_bg stub 18722 ./node_modules/.bin/tsx e2e/support/stubModel.ts");
    passes("a && b");
    refuses('psql "$OAB_SB_DB_URL" -c "select 1"', /psql/);
    passes('psql_demo -c "select 1"');
    passes('psql "postgresql://postgres:postgres@127.0.0.1:18712/postgres" -XAtc "select 1"');
    for (const bad of ["ffmpeg -f avfoundation -i 1 out.mp4", "screencapture -x a.png"]) refuses(bad, /screen capture/);
  });

  it("the lib needs start_bg under env -i, memory_check on docker info with M7_DEMO_SEQUENTIAL, and refuse_supabase_env", () => {
    const base = `. "$REPO/scripts/preview-preflight.sh"\nrequire_oab oab-x\nEXITS=exit-codes.txt\n`;
    const all = [
      'start_bg() {\n  env -i PATH="$PATH" "$@"\n}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell parameter expansion in a lib.sh fixture
      "memory_check() {\n  docker info --format '{{.MemTotal}}'\n  [ \"${M7_DEMO_SEQUENTIAL:-}\" = 1 ]\n}",
      "refuse_supabase_env() {\n  :\n}",
    ];
    assert.deepEqual(libProblems(base + all.join("\n"), "m7"), []);
    assert.match(libProblems(base + all.slice(1).join("\n"), "m7").join("\n"), /start_bg/);
    assert.match(libProblems(base + ['start_bg() {\n  "$@"\n}', ...all.slice(1)].join("\n"), "m7").join("\n"), /env -i/);
    assert.match(libProblems(base + [all[0], all[2]].join("\n"), "m7").join("\n"), /memory_check/);
    assert.match(libProblems(base + all.slice(0, 2).join("\n"), "m7").join("\n"), /refuse_supabase_env/);
  });

  it("memory_check refuses below 6 GB unless M7_DEMO_SEQUENTIAL=1, which stops oab-m7-demo before oab-m7-g8", () => {
    const bin = mkdtempSync(join(tmpdir(), "oab-m7-fake-docker-"));
    const fake = (bytes) =>
      spawnSync("bash", ["-c", `printf '#!/bin/sh\\necho ${bytes}\\n' > "${bin}/docker" && chmod +x "${bin}/docker"`], {
        encoding: "utf8",
      });
    try {
      fake(4 * 1024 ** 3);
      const low = sh("memory_check; echo after", { PATH: `${bin}:${process.env.PATH}` });
      assert.equal(low.status, 1, low.stdout);
      assert.match(low.stdout, /M7_DEMO_SEQUENTIAL=1/);
      assert.doesNotMatch(low.stdout, /after/);
      const seq = sh('memory_check && echo "mode=$M7_MODE"', { PATH: `${bin}:${process.env.PATH}`, M7_DEMO_SEQUENTIAL: "1" });
      assert.equal(seq.status, 0, seq.stderr);
      assert.match(seq.stdout, /mode=sequential/);
      fake(8 * 1024 ** 3);
      const ok = sh('memory_check && echo "mode=$M7_MODE"', { PATH: `${bin}:${process.env.PATH}` });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, /mode=together/);
    } finally {
      rmSync(bin, { recursive: true, force: true });
      cleanup();
    }
    const p2 = read(join(M7, "part-2.sh"));
    assert.ok(p2.search(/if \[ "\$M7_MODE" = sequential \]/) >= 0);
    assert.ok(p2.indexOf("stack_stop oab-m7-demo") < p2.indexOf("stack_start oab-m7-g8"), "sequential mode stops the demo stack first");
  });

  it("refuse_supabase_env stops on any Supabase access variable or LIVE_DB_URL", () => {
    try {
      for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL", "LIVE_DB_URL"]) {
        const r = sh("refuse_supabase_env; echo after", { [name]: "x" });
        assert.equal(r.status, 1, name);
        assert.match(r.stdout, new RegExp(name));
        assert.doesNotMatch(r.stdout, /after/);
      }
      assert.equal(sh("refuse_supabase_env").status, 0);
    } finally {
      cleanup();
    }
  });

  it("demo_env writes the secrets into a 0700 run folder outside .factory, as a 0600 file, and prints none of them", () => {
    try {
      const r = sh(
        'demo_env_secrets && d="$(recall run)" && stat -f "%Lp" "$d" "$d/secrets.env" && grep -c "^[A-Z_]*=" "$d/secrets.env" && rm -rf "$d"',
      );
      assert.equal(r.status, 0, r.stderr);
      const [dirMode, fileMode, count] = r.stdout.trim().split("\n").slice(-3);
      assert.equal(dirMode, "700");
      assert.equal(fileMode, "600");
      assert.equal(Number(count), 4, count);
      assert.doesNotMatch(r.stdout, /[0-9a-f]{64}/);
    } finally {
      cleanup();
    }
  });

  it("part 0 snapshots live first and starts oab-m7-demo; part 8 diffs live, scans secrets and supabase.co and checks leftovers", () => {
    const p0 = read(join(M7, "part-0.sh"));
    const at0 = (re) => p0.search(re);
    assert.ok(at0(/live_snapshot before/) >= 0 && at0(/live_snapshot before/) < at0(/stack_start oab-m7-demo/));
    assert.match(read(M7_LIB), /grep -E '\^open-agent-bot' \| sort > "\$DEMO_DIR\/live-\$1\.txt"/);
    assert.ok(at0(/^refuse_supabase_env$/m) >= 0 && at0(/^refuse_supabase_env$/m) < at0(/stack_start oab-m7-demo/));
    assert.match(p0, /^run bindings "stack_bindings"$/m);
    assert.match(
      read(M7_LIB),
      /^stack_bindings\(\) \{ docker ps --filter name=_oab-m7- --format '\{\{\.Names\}\} \{\{\.Ports\}\}' \| sort; \}$/m,
    );
    const p8 = read(join(M7, "part-8.sh"));
    for (const s of [
      "stack_stop oab-m7-demo",
      "stack_stop oab-m7-g8",
      "live_snapshot after",
      "live-after.txt",
      "grep -F -c -f <(secret_patterns",
      "supabase_hosts",
      "m7_leftovers",
    ])
      assert.ok(p8.includes(s), s);
    assert.ok(p8.indexOf("stop_all") < p8.indexOf("stack_stop oab-m7-demo"));
    assert.match(read(M7_LIB), /grep -E '_oab-m7-\(demo\|g8\)\$'/);
    assert.match(read(M7_LIB), /grep -E -c '\[\.\]supabase\[\.\]co/);
    assert.match(p8, /^no_background$/m);
  });

  it("part 2 rehearses Gate 8 on oab-m7-g8: old bodies, plan 0 and 1, history repair 3 then 0, push, rollback", () => {
    const p2 = read(join(M7, "part-2.sh"));
    const steps = [
      "stack_start oab-m7-g8",
      "g8_bodies",
      "--pre-m7-query",
      "push-dry-run --name oab-m7-g8",
      "repair_g8",
      "local-stack.mjs push --name oab-m7-g8",
      "--applied",
      "rollback/m7.sql",
      "stack_stop oab-m7-g8",
    ];
    let at = -1;
    for (const s of steps) {
      const i = p2.indexOf(s, at + 1);
      assert.ok(i > at, `part 2 lacks (or misorders) ${s}`);
      at = i;
    }
    assert.match(p2, /^exits plan-extra 1 /m);
    assert.match(p2, /^exits plan-history 3 /m);
    assert.match(p2, /^exits old-bodies-after-push 1 /m);
  });

  it("the node helpers refuse anything but the local stack and the factory origins", () => {
    for (const f of HELPERS) {
      const t = read(join(M7, f));
      assert.doesNotMatch(t, /\.supabase\.co\b/, f);
      assert.doesNotMatch(t, /\/Users\//, f);
    }
    assert.match(read(join(M7, "users.mjs")), /local_stack_only/);
    assert.match(read(join(M7, "users.mjs")), /oab-m7\\\+/);
    const b = read(join(M7, "browser.mjs"));
    assert.match(b, /http:\/\/localhost:18721/);
    assert.match(b, /recordVideo/);
    assert.match(b, /recordHar/);
    assert.match(b, /FORBIDDEN request/);
  });

  it("part 1 shows AC 2: the local paths unchanged since M7_BASE, the desktop and local e2e suites and the standalone job, then no leftovers", () => {
    const p1 = read(join(M7, "part-1.sh"));
    const steps = [
      'git diff --stat --exit-code \\"$M7_BASE\\" HEAD -- docker-compose.yml local apps/desktop .github/workflows/release.yml',
      "--project desktop-fake",
      'run local-up "local_up"',
      "npm run local -w e2e",
      "down_local",
      "rm -rf e2e/.local",
      "scripts/ci/standalone.sh --docker --hosted-free",
      "ac2_leftovers",
    ];
    let at = -1;
    for (const s of steps) {
      const i = p1.indexOf(s, at + 1);
      assert.ok(i > at, `part 1 lacks (or misorders) ${s}`);
      at = i;
    }
    assert.match(p1, /test\/copilot\/parity\.test\.ts --reporter=verbose/);
    const lib = read(M7_LIB);
    assert.match(lib, /^M7_BASE="\$\{M7_BASE:-revamp\/clean\}"$/m);
    assert.match(lib, /^PORTS_USED="18720 18721 18722 18740 18741"$/m);
    assert.match(lib, /grep -E '\^oab-m7-\(local\|oss\)'/);
  });

  it("part 3 shows the low and unavailable meter, the cleanup timestamps and N admitted after the server frees; part 2 drops the always-empty usage view", () => {
    const p3 = read(join(M7, "part-3.sh"));
    assert.match(p3, /^run agent "agent_up 1 1000 5 8"$/m);
    assert.match(p3, /test\/limits\/lifecycle\.test\.ts --reporter=verbose/);
    assert.match(p3, /test\/local\/policy\.local\.test\.ts --reporter=verbose/);
    assert.doesNotMatch(read(join(M7, "part-2.sh")), /usage-tables/);
    const b = read(join(M7, "browser.mjs"));
    for (const needle of [
      "#sidebar-usage-meter-low",
      '"data-level", "low"',
      "#sidebar-usage-meter-unavailable",
      "#sidebar-usage-meter-retry",
      "request_usage_get(uuid, timestamptz) from service_role",
      "toBe(before + 1)",
      "running.mine = 0; until then a send in B is refused limit_running",
    ])
      assert.ok(b.includes(needle), needle);
  });

  it("part 6 revokes the mode lookup only after the agent started, then shows the agent refusing to start while it is revoked", () => {
    const p6 = read(join(M7, "part-6.sh"));
    const unknown = p6.slice(p6.indexOf("the mode unknown"));
    const at = (s) => unknown.indexOf(s);
    assert.ok(at("agent_up 1 1000 1000 8 $TURNSTILE_PASS") >= 0 && at("agent_up 1 1000 1000 8 $TURNSTILE_PASS") < at("revoke execute"));
    assert.ok(at("revoke execute") < at("browser pages-unknown"));
    assert.ok(at("browser pages-unknown") < at("exits agent-refuses-signup 1 "));
    assert.ok(at("exits agent-refuses-signup 1 ") < at("grant execute"));
  });

  it("names no revamp-only commit hash", () => {
    for (const f of readdirSync(M7))
      for (const h of read(join(M7, f)).match(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/g) ?? [])
        assert.ok(/^0+$/.test(h), `${f} pins ${h}`);
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
