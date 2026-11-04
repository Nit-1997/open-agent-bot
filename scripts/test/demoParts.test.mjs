import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PARTS, PARTS_DIR, LIB, libProblems, partProblems } from "../demo/partChecks.mjs";
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
    const tmp = mkdtempSync(join(tmpdir(), "tmp."));
    mkdirSync(join(repo, ".factory/m5"), { recursive: true });
    const outside = mkdtempSync(join(repo, ".factory/m5/outside-"));
    const recall = (path) =>
      spawnSync("bash", ["-c", `. scripts/demo/m5/lib.sh; printf '%s\\n' "$1" > "$DEMO_DIR/x.path"; recall x`, "part-test", path], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, DEMO_DIR: demo, TMPDIR: tmpdir() },
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
        [realpathSync(tmpdir()), /outside/],
      ]) {
        const r = recall(path);
        assert.equal(r.status, 1, path);
        assert.match(r.stderr, why, path);
      }
      symlinkSync(outside, join(tmp, "link"));
      assert.match(recall(join(tmp, "link")).stderr, /outside/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
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
