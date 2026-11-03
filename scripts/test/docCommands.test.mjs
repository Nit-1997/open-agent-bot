import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  attestationProblems,
  classify,
  COVERED_FILES,
  coverage,
  extractCommands,
  forbiddenNames,
  guideVersion,
  htmlProblems,
  imageTagProblems,
  loadManifest,
  manifestProblems,
  substitute,
  substitutionRules,
  tokenize,
  tsvRow,
  versionProblems,
} from "../docs/doc-commands.mjs";
import {
  createRunner,
  parseRunnerArgs,
  preflight,
  SCRATCH,
  scratchEnv,
  writeDockerConfig,
} from "../docs/run-doc-commands.mjs";
import { notes } from "../release/releaseLib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "scripts/test/fixtures/docs");
const fixture = (n) => readFileSync(join(FIX, n), "utf8");
const INSTALL = readFileSync(join(ROOT, "docs/INSTALL.md"), "utf8");
const D = (c) => c.repeat(64);
const DIR = "/private/tmp/oab-docs-scratch";
const REPO = "/work/repo";
const CTX = Object.freeze({
  repo: REPO,
  dir: DIR,
  clone: `${DIR}/open-agent-bot`,
  downloads: `${DIR}/downloads`,
  installApp: `${DIR}/install/Open Agent.app`,
  port: 18520,
  branch: "revamp/integration",
  project: "oab-factory-m5-clone",
  guideVersion: "1.0.0",
  dryVersion: "0.0.0-dryrun.1",
  refs: {
    agent: `127.0.0.1:18501/oab-m5-open-agent@sha256:${D("c")}`,
    search: `127.0.0.1:18501/oab-m5-open-agent-search@sha256:${D("d")}`,
  },
});
const RULES = substitutionRules(CTX);
const owner = (line, cwd = CTX.clone) => classify(line, CTX, cwd);
const PRINTF =
  "printf 'OPEN_AGENT_IMAGE=ghcr.io/nit-1997/open-agent@sha256:<agent-digest>\\nOPEN_AGENT_SEARCH_IMAGE=ghcr.io/nit-1997/open-agent-search@sha256:<search-digest>\\n' > .env";

describe("extractCommands", () => {
  const got = extractCommands(fixture("extract.md"), "fixture.md");
  it("reads bash, sh and zsh blocks only, with prompts stripped and continuations joined", () => {
    assert.deepEqual(
      got.map((c) => c.command),
      ["echo one", "echo two three", "printf 'a\\n' > .env", "docker compose ps", "echo tilde fence"],
    );
  });
  it("keeps the source line of each command", () => {
    assert.deepEqual(
      got.map((c) => c.line),
      [4, 5, 12, 18, 34],
    );
    assert.ok(got.every((c) => c.file === "fixture.md"));
  });
});

describe("manifest", () => {
  const manifest = loadManifest();
  it("covers every shell line in the covered docs exactly once and names nothing else", () => {
    assert.deepEqual(COVERED_FILES, ["docs/INSTALL.md"]);
    const extracted = COVERED_FILES.flatMap((f) => extractCommands(readFileSync(join(ROOT, f), "utf8"), f));
    const { missing, extra } = coverage(extracted, manifest, COVERED_FILES);
    assert.deepEqual(missing, []);
    assert.deepEqual(extra, []);
    assert.deepEqual(manifestProblems(manifest, Object.keys(RULES)), []);
  });
  it("reports a missing and an extra command", () => {
    const m = { commands: [{ file: "docs/INSTALL.md", command: "echo gone", mode: "owner", reason: "x" }] };
    const r = coverage([{ file: "docs/INSTALL.md", line: 1, command: "echo here" }], m, ["docs/INSTALL.md"]);
    assert.deepEqual(r.missing, ["docs/INSTALL.md: echo here"]);
    assert.deepEqual(r.extra, ["docs/INSTALL.md: echo gone"]);
  });
  it("refuses entries for files outside the covered set", () => {
    const m = { commands: [{ file: "README.md", command: "echo x", mode: "owner", reason: "x" }] };
    assert.deepEqual(coverage([], m, ["docs/INSTALL.md"]).extra, ["README.md: echo x"]);
  });
  for (const [name, entry, want] of [
    ["unknown mode", { mode: "maybe" }, /unknown mode maybe/],
    ["owner without a reason", { mode: "owner" }, /owner needs a reason/],
    ["subst without names", { mode: "subst" }, /subst needs substitutions/],
    ["unknown substitution", { mode: "subst", subst: ["nope"] }, /unknown substitution nope/],
    ["substitutions outside subst mode", { mode: "run", subst: ["local-url"] }, /substitutions need mode subst/],
    ["expectExit without a reason", { mode: "run", expectExit: 1 }, /expectExit needs a reason/],
    ["unknown cwd", { mode: "run", cwd: "elsewhere" }, /unknown cwd elsewhere/],
  ])
    it(`refuses ${name}`, () => {
      const m = { commands: [{ file: "docs/INSTALL.md", command: "echo x", ...entry }] };
      assert.match(manifestProblems(m, Object.keys(RULES)).join("\n"), want);
    });
  it("refuses a duplicate entry", () => {
    const e = { file: "docs/INSTALL.md", command: "echo x", mode: "owner", reason: "x" };
    assert.match(manifestProblems({ commands: [e, e] }, []).join("\n"), /listed twice: docs\/INSTALL.md: echo x/);
  });
  it("every entry declared run, env or subst stays runnable in document order", () => {
    let cwd = CTX.dir;
    const byKey = new Map(manifest.commands.map((e) => [`${e.file}\0${e.command}`, e]));
    for (const c of extractCommands(INSTALL, "docs/INSTALL.md")) {
      const e = byKey.get(`${c.file}\0${c.command}`);
      if (e.mode === "owner") continue;
      const s = substitute(c.command, e.subst ?? [], RULES);
      assert.deepEqual(s.missing, [], c.command);
      const at = e.cwd === "downloads" ? CTX.downloads : cwd;
      const r = classify(s.text, CTX, at);
      assert.ok(r.runnable, `${c.command}: ${r.reason}`);
      assert.equal(forbiddenNames(r.asRun, CTX), undefined, c.command);
      if (e.cwd !== "downloads") cwd = r.cwdAfter;
    }
  });
});

describe("tokenize", () => {
  it("splits words, quotes, escapes and operators", () => {
    const t = tokenize(`a 'b c' "d \\"e\\"" f\\ g && h | i; j || k`);
    assert.ok(t.ok);
    assert.deepEqual(
      t.commands.map((c) => c.words.map((w) => w.text)),
      [["a", "b c", 'd "e"', "f g"], ["h"], ["i"], ["j"], ["k"]],
    );
    assert.deepEqual(
      t.commands.map((c) => c.op),
      ["&&", "|", ";", "||", undefined],
    );
  });
  it("reads redirections with their targets", () => {
    const t = tokenize("printf 'x' > .env 2>&1 >> log < in");
    assert.deepEqual(
      t.commands[0].redirects.map((r) => [r.op, r.target]),
      [
        [">", ".env"],
        [">&", "1"],
        [">>", "log"],
        ["<", "in"],
      ],
    );
    assert.deepEqual(
      t.commands[0].words.map((w) => w.text),
      ["printf", "x"],
    );
  });
  it("flags command substitution, parameters and a leading tilde", () => {
    const t = tokenize('echo $(id) `id` "$HOME/x" ~/y \'$HOME\'');
    const w = t.commands[0].words;
    assert.ok(w[1].cmdsub && w[2].cmdsub);
    assert.deepEqual(w[3].params, ["HOME"]);
    assert.ok(w[4].tilde);
    assert.deepEqual(w[5].params, []);
  });
  it("drops comments and refuses an unterminated quote", () => {
    assert.deepEqual(
      tokenize("echo a # b").commands[0].words.map((w) => w.text),
      ["echo", "a"],
    );
    assert.equal(tokenize("echo 'a").ok, false);
  });
});

describe("substitutions", () => {
  it("rewrites the clone URL and branch and keeps the folder name", () => {
    const s = substitute(
      "git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot",
      ["clone-url", "clone-branch"],
      RULES,
    );
    assert.equal(s.text, `git clone --branch revamp/integration --depth 1 file://${REPO} open-agent-bot`);
    assert.deepEqual(s.applied, ["clone-url", "clone-branch"]);
  });
  it("leaves a longer word alone", () => {
    for (const line of [
      "cd open-agent-bot",
      "echo https://github.com/Nit-1997/open-agent-bot/releases",
      "echo xhttps://github.com/Nit-1997/open-agent-bot",
      "echo --branch v1.0.0x",
      "curl http://127.0.0.1:30000",
    ]) {
      const s = substitute(line, ["clone-url", "clone-branch", "local-url"], RULES);
      assert.equal(s.text, line);
      assert.equal(s.missing.length > 0, true, line);
    }
  });
  it("rewrites the §9 printf line's two refs and nothing else", () => {
    const s = substitute(PRINTF, ["agent-ref", "search-ref"], RULES);
    assert.equal(
      s.text,
      `printf 'OPEN_AGENT_IMAGE=${CTX.refs.agent}\\nOPEN_AGENT_SEARCH_IMAGE=${CTX.refs.search}\\n' > .env`,
    );
    const real = PRINTF.replace("<agent-digest>", D("a")).replace("<search-digest>", D("b"));
    assert.equal(substitute(real, ["agent-ref", "search-ref"], RULES).text, s.text);
  });
  it("rewrites the local URL, the install path and the DMG name", () => {
    assert.equal(substitute("open http://127.0.0.1:3000", ["local-url"], RULES).text, "open http://127.0.0.1:18520");
    assert.equal(
      substitute("curl -fsS http://127.0.0.1:3000/health", ["local-url"], RULES).text,
      "curl -fsS http://127.0.0.1:18520/health",
    );
    assert.equal(
      substitute('xattr -l "/Applications/Open Agent.app"', ["install-path"], RULES).text,
      `xattr -l "${CTX.installApp}"`,
    );
    assert.equal(
      substitute("ls Open-Agent-1.0.0-arm64.dmg", ["dmg"], RULES).text,
      "ls Open-Agent-0.0.0-dryrun.1-arm64.dmg",
    );
  });
  it("applies only the listed substitutions", () => {
    const s = substitute("open http://127.0.0.1:3000", [], RULES);
    assert.equal(s.text, "open http://127.0.0.1:3000");
  });
});

describe("allowlist", () => {
  for (const [line, cwd] of [
    [`git clone --branch revamp/integration --depth 1 file://${REPO} open-agent-bot`, CTX.dir],
    ["cd open-agent-bot", CTX.dir],
    ["docker compose up -d --build", CTX.clone],
    ["docker compose pull agent search && docker compose up -d --no-build", CTX.clone],
    ["docker compose down -v", CTX.clone],
    ["docker image ls -a --digests 'ghcr.io/nit-1997/*'", CTX.dir],
    ["docker ps", CTX.clone],
    ["curl -fsS http://127.0.0.1:18520/health", CTX.clone],
    ["printf 'A=b\\n' > .env", CTX.clone],
    ["shasum -a 256 -c SHA256SUMS --ignore-missing", CTX.downloads],
    [`xattr -dr com.apple.quarantine "${CTX.installApp}"`, CTX.dir],
    [`xattr -l "${CTX.installApp}"`, CTX.dir],
    ["git fetch --tags", CTX.clone],
  ])
    it(`runs: ${line}`, () => {
      const r = classify(line, CTX, cwd);
      assert.ok(r.runnable, r.reason);
      assert.equal(r.asRun, line);
    });
  it("rewrites open of the local URL to curl", () => {
    const r = classify("open http://127.0.0.1:18520", CTX, CTX.clone);
    assert.ok(r.runnable);
    assert.equal(r.asRun, "curl -fsS http://127.0.0.1:18520");
  });
  it("tracks cd through the line", () => {
    const r = classify(`git clone file://${REPO} open-agent-bot && cd open-agent-bot && docker compose up -d`, CTX, CTX.dir);
    assert.ok(r.runnable, r.reason);
    assert.equal(r.cwdAfter, CTX.clone);
    assert.deepEqual(r.docker, [CTX.clone]);
  });
  for (const [line, want, cwd] of [
    ["rm -rf x", /rm/],
    ["rm -fr x", /rm/],
    ["rm -r -f x", /rm/],
    ["/bin/rm x", /rm|outside/],
    ["docker rmi x", /docker rmi/],
    ["docker rm x", /docker rm/],
    ["docker image rm x", /docker image rm/],
    ["docker image remove x", /docker image remove/],
    ["docker image prune -a", /docker image prune/],
    ["docker volume rm x", /docker volume rm/],
    ["docker volume remove x", /docker volume remove/],
    ["docker volume prune", /docker volume prune/],
    ["docker container rm x", /docker container rm/],
    ["docker container remove x", /docker container remove/],
    ["docker container prune", /docker container prune/],
    ["docker network rm x", /docker network rm/],
    ["docker system prune -a", /docker system prune/],
    ["docker logout ghcr.io", /docker logout/],
    ["cat /Users/someone/secret", /outside the scratch dir/],
    ["ls ~", /~/],
    ["ls ~/Library", /~/],
    ["ls Library/Logs", /Library/],
    ["echo $HOME", /\$HOME/],
    ['ls "$HOME/x"', /\$HOME/],
    ["echo $(id)", /command substitution/],
    ["echo `id`", /command substitution/],
    ["eval ls", /eval/],
    ["exec ls", /exec/],
    ["sh -c ls", /sh -c/],
    ["bash -c ls", /bash -c/],
    ["zsh -c ls", /zsh -c/],
    ["ls | xargs echo", /xargs/],
    ["sudo ls", /sudo/],
    ["source x", /source/],
    [". x", /source/],
    ["cd ..", /cd \.\./],
    ["cd ../x", /\.\./],
    ["cd /tmp", /outside the scratch dir/],
    ["docker compose -p open-agent down -v", /docker compose -p/],
    ["docker compose --project-name x up", /docker compose --project-name/],
    ["docker compose -f other.yml up", /docker compose -f/],
    ["docker compose --file other.yml up", /docker compose --file/],
    ["docker compose --project-directory x up", /docker compose --project-directory/],
    ["docker compose --env-file x up", /docker compose --env-file/],
    ["docker -H tcp://h ps", /docker -H/],
    ["docker --host tcp://h ps", /docker --host/],
    ["docker --context other ps", /docker --context/],
    ["docker --config x ps", /docker --config/],
    ["brew install colima", /brew/],
    ["colima start", /colima/],
    ["gh auth status", /gh/],
    ["docker compose ps && rm -rf x", /rm/],
    ["ls", /not allowlisted: ls/],
    ["docker compose exec agent sh", /not allowlisted: docker compose exec/],
    ["docker compose ps", /outside the clone/, CTX.dir],
    ["curl -fsS http://example.com", /not allowlisted: curl/],
    ["curl -o out http://127.0.0.1:18520", /not allowlisted: curl/],
    ["printf x > other", /not allowlisted: printf/],
    ["docker ps > out", /redirection/],
    ["FOO=1 docker ps", /variable assignment/],
    ["docker ps &", /background/],
    ["(docker ps)", /subshell/],
    ['xattr -dr com.apple.quarantine "/Applications/Open Agent.app"', /outside the scratch dir/],
    ["shasum -a 256 -c SHA256SUMS", /not allowlisted: shasum/, CTX.clone],
    [`git clone https://github.com/Nit-1997/open-agent-bot x`, /not allowlisted: git clone/, CTX.dir],
    ["git fetch --tags", /not allowlisted: git fetch/, CTX.dir],
  ])
    it(`owner: ${line}`, () => {
      const r = owner(line, cwd);
      assert.equal(r.runnable, false);
      assert.match(r.reason, want);
    });
});

describe("forbiddenNames", () => {
  for (const [line, want] of [
    ["curl http://127.0.0.1:3000/health", /port 3000/],
    ["docker compose -p open-agent ps", /open-agent project/],
    ["docker volume ls open-agent-data", /open-agent-data/],
    ["docker volume ls open-agent-keys", /open-agent-keys/],
    ['xattr -l "/Applications/Open Agent.app"', /\/Applications/],
  ])
    it(`refuses ${line}`, () => assert.match(forbiddenNames(line, CTX), want));
  it("accepts the scratch names", () => {
    assert.equal(forbiddenNames(`xattr -l "${CTX.installApp}" && cd open-agent-bot`, CTX), undefined);
    assert.equal(forbiddenNames(`printf 'X=${CTX.refs.agent}\\n' > .env`, CTX), undefined);
  });
});

describe("scratch environment", () => {
  it("holds only the listed variables, with HOME and DOCKER_CONFIG in the scratch dir", () => {
    process.env.OAB_SHOULD_NOT_LEAK = "1";
    const env = scratchEnv({ dir: DIR, realHome: "/Users/me", exists: (p) => p === "/Users/me/.docker/run/docker.sock" });
    assert.deepEqual(Object.keys(env).sort(), [
      "COMPOSE_PROJECT_NAME",
      "DOCKER_CONFIG",
      "DOCKER_HOST",
      "HOME",
      "LANG",
      "OPEN_AGENT_DATA_VOLUME",
      "OPEN_AGENT_KEYS_VOLUME",
      "OPEN_AGENT_PORT",
      "PATH",
    ]);
    assert.equal(env.HOME, `${DIR}/home`);
    assert.equal(env.DOCKER_CONFIG, `${DIR}/docker-config`);
    assert.equal(env.DOCKER_HOST, "unix:///Users/me/.docker/run/docker.sock");
    assert.equal(env.PATH, "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    assert.equal(env.LANG, "en_US.UTF-8");
    assert.equal(env.COMPOSE_PROJECT_NAME, "oab-factory-m5-clone");
    assert.equal(env.OPEN_AGENT_PORT, "18520");
    assert.equal(env.OPEN_AGENT_DATA_VOLUME, "oab-factory-m5-clone-data");
    assert.equal(env.OPEN_AGENT_KEYS_VOLUME, "oab-factory-m5-clone-keys");
    assert.equal(SCRATCH.project, "oab-factory-m5-clone");
    delete process.env.OAB_SHOULD_NOT_LEAK;
  });
  it("falls back to /var/run/docker.sock", () => {
    assert.equal(scratchEnv({ dir: DIR, realHome: "/Users/me", exists: () => false }).DOCKER_HOST, "unix:///var/run/docker.sock");
  });
  it("writes a docker config with only cliPluginsExtraDirs for Docker Desktop", () => {
    const dir = mkdtempSync(join(tmpdir(), "oab-m5-docs-"));
    const desktop = join(dir, "Docker.app/cli-plugins");
    mkdirSync(desktop, { recursive: true });
    writeDockerConfig({ dir, desktopPlugins: desktop, pluginDirs: [] });
    const cfg = JSON.parse(readFileSync(join(dir, "docker-config/config.json"), "utf8"));
    assert.deepEqual(cfg, { cliPluginsExtraDirs: [desktop] });
  });
  it("links the trusted compose and buildx plugins for other engines", () => {
    const dir = mkdtempSync(join(tmpdir(), "oab-m5-docs-"));
    const brew = join(dir, "brew-plugins");
    mkdirSync(brew);
    for (const p of ["docker-compose", "docker-buildx", "docker-other"]) writeFileSync(join(brew, p), "");
    writeDockerConfig({ dir, desktopPlugins: join(dir, "absent"), pluginDirs: [brew] });
    const cfg = JSON.parse(readFileSync(join(dir, "docker-config/config.json"), "utf8"));
    assert.deepEqual(cfg, { cliPluginsExtraDirs: [] });
    for (const p of ["docker-compose", "docker-buildx"]) {
      const link = join(dir, "docker-config/cli-plugins", p);
      assert.ok(lstatSync(link).isSymbolicLink());
      assert.equal(readlinkSync(link), join(brew, p));
    }
    assert.throws(() => lstatSync(join(dir, "docker-config/cli-plugins/docker-other")));
  });
});

describe("preflight", () => {
  const exec = (name) => (cmd, args, o) => {
    if (cmd === "docker") return { status: 0, stdout: JSON.stringify({ name, services: {}, volumes: {} }), stderr: "" };
    if (cmd === "jq") return { status: 0, stdout: `${JSON.parse(o.input).name}\n`, stderr: "" };
    return { status: 127, stdout: "", stderr: "unexpected" };
  };
  it("accepts the scratch project", () => {
    assert.deepEqual(preflight(CTX.clone, {}, exec("oab-factory-m5-clone"), CTX.project), { ok: true, name: "oab-factory-m5-clone" });
  });
  it("refuses another project name", () => {
    const r = preflight(CTX.clone, {}, exec("open-agent"), CTX.project);
    assert.equal(r.ok, false);
    assert.match(r.reason, /open-agent/);
  });
  it("refuses a published port other than the scratch port and a volume without oab-", () => {
    const cfg = (o) => (cmd, args, x) =>
      cmd === "docker" ? { status: 0, stdout: JSON.stringify({ name: CTX.project, ...o }), stderr: "" } : exec(CTX.project)(cmd, args, x);
    const port = preflight(CTX.clone, {}, cfg({ services: { agent: { ports: [{ host_ip: "127.0.0.1", published: "3000" }] } } }), CTX.project, 18520);
    assert.match(port.reason, /port 3000/);
    const vol = preflight(CTX.clone, {}, cfg({ volumes: { data: { name: "open-agent-data" } } }), CTX.project, 18520);
    assert.match(vol.reason, /open-agent-data/);
  });
});

describe("runner", () => {
  const manifestFor = (entries) => ({ commands: entries.map((e) => ({ file: "f.md", ...e })) });
  const harness = (entries, { projectName = CTX.project, exits = {} } = {}) => {
    const calls = [];
    const exec = (cmd, args, o = {}) => {
      if (cmd === "docker" && args[0] === "compose" && args[1] === "config") {
        calls.push(["preflight", o.cwd]);
        return { status: 0, stdout: JSON.stringify({ name: projectName, services: {}, volumes: {} }), stderr: "" };
      }
      if (cmd === "jq") return { status: 0, stdout: `${JSON.parse(o.input).name}\n`, stderr: "" };
      if (cmd === "/bin/bash") {
        const line = args.at(-1);
        calls.push(["run", line, o.cwd]);
        return { status: exits[line] ?? 0, stdout: "", stderr: "" };
      }
      return { status: 127, stdout: "", stderr: `unexpected ${cmd}` };
    };
    const log = [];
    const runner = createRunner({
      ctx: CTX,
      env: { HOME: `${DIR}/home` },
      manifest: manifestFor(entries),
      exec,
      log: (s) => log.push(s),
      hasCompose: (d) => d === CTX.clone,
      preflightDir: `${DIR}/.preflight`,
    });
    return { runner, calls, log };
  };
  const occ = (command, line = 1) => ({ file: "f.md", line, command });

  it("runs preflight before every docker command and runs the line once", () => {
    const line = "docker compose pull agent search && docker compose up -d --no-build";
    const { runner, calls } = harness([{ command: line, mode: "env" }]);
    runner.cwd = CTX.clone;
    const row = runner.run(occ(line));
    assert.equal(row.exit, 0);
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["preflight", "preflight", "run"],
    );
  });
  it("refuses a docker command when the project name is wrong and never runs it", () => {
    const { runner, calls } = harness([{ command: "docker compose ps", mode: "env" }], { projectName: "open-agent" });
    runner.cwd = CTX.clone;
    const row = runner.run(occ("docker compose ps"));
    assert.notEqual(row.exit, 0);
    assert.match(row.note, /preflight/);
    assert.ok(!calls.some((c) => c[0] === "run"));
  });
  it("uses the preflight copy before the clone exists", () => {
    const { runner, calls } = harness([{ command: "docker ps", mode: "run" }]);
    runner.run(occ("docker ps"));
    assert.deepEqual(calls[0], ["preflight", `${DIR}/.preflight`]);
  });
  it("records owner rows with their reason and never runs them", () => {
    const { runner, calls } = harness([
      { command: "brew install gh", mode: "owner", reason: "Homebrew changes the real Mac" },
      { command: "ls", mode: "run" },
    ]);
    const a = runner.run(occ("brew install gh"));
    const b = runner.run(occ("ls"));
    assert.deepEqual([a.mode, a.note, a.asRun, a.exit], ["owner", "Homebrew changes the real Mac", "", ""]);
    assert.deepEqual([b.mode, b.note], ["owner", "not allowlisted: ls (declared run)"]);
    assert.equal(calls.length, 0);
  });
  it("refuses a line that still names a real resource after substitution", () => {
    const { runner, calls } = harness([{ command: "curl -fsS http://127.0.0.1:3000/health", mode: "run" }]);
    runner.cwd = CTX.clone;
    const row = runner.run(occ("curl -fsS http://127.0.0.1:3000/health"));
    assert.notEqual(row.exit, 0);
    assert.match(row.note, /port 3000/);
    assert.equal(calls.length, 0);
  });
  it("tracks cwd after a successful cd and fails on an unexpected exit", () => {
    const { runner } = harness([
      { command: "cd open-agent-bot", mode: "run" },
      { command: "docker compose ps", mode: "env", expectExit: 0 },
      { command: "docker compose logs agent", mode: "env", expectExit: 1, reason: "no containers" },
    ], { exits: { "docker compose ps": 3, "docker compose logs agent": 1 } });
    runner.run(occ("cd open-agent-bot"));
    assert.equal(runner.cwd, CTX.clone);
    const ps = runner.run(occ("docker compose ps"));
    assert.equal(ps.exit, 3);
    assert.equal(ps.ok, false);
    const logs = runner.run(occ("docker compose logs agent"));
    assert.equal(logs.ok, true);
    assert.equal(logs.note, "expected exit 1: no containers");
  });
  it("runs downloads entries in the downloads folder without moving cwd", () => {
    const { runner, calls } = harness([{ command: "shasum -a 256 -c SHA256SUMS --ignore-missing", mode: "run", cwd: "downloads" }]);
    runner.cwd = CTX.dir;
    runner.run(occ("shasum -a 256 -c SHA256SUMS --ignore-missing"));
    assert.deepEqual(calls[0], ["run", "shasum -a 256 -c SHA256SUMS --ignore-missing", CTX.downloads]);
    assert.equal(runner.cwd, CTX.dir);
  });
  it("writes one TSV row per command with tabs and newlines escaped", () => {
    assert.equal(tsvRow(["a\tb", "c\nd", "", 0]), "a\\tb\tc\\nd\t\t0");
  });
});

describe("runner arguments", () => {
  const tmp = realpathSync(tmpdir());
  it("refuses a scratch dir outside the temp dir and .factory", () => {
    assert.throws(() => parseRunnerArgs(["--scratch", "/Users/me/x", "--release-dir", "r", "--log", "l", "--tsv", "t"], { tmp, repo: ROOT }), /--scratch must be under/);
  });
  it("refuses a non-empty scratch dir", () => {
    const d = mkdtempSync(join(tmp, "oab-m5-docs-"));
    writeFileSync(join(d, "x"), "");
    assert.throws(() => parseRunnerArgs(["--scratch", d, "--release-dir", d, "--log", "l", "--tsv", "t"], { tmp, repo: ROOT }), /is not empty/);
  });
  it("requires every option and a release dir with a lock and SHA256SUMS", () => {
    const d = mkdtempSync(join(tmp, "oab-m5-docs-"));
    assert.throws(() => parseRunnerArgs(["--scratch", join(d, "s")], { tmp, repo: ROOT }), /--release-dir/);
    assert.throws(
      () => parseRunnerArgs(["--scratch", join(d, "s"), "--release-dir", d, "--log", "l", "--tsv", "t"], { tmp, repo: ROOT }),
      /lock\/services.lock.json/,
    );
  });
});

describe("guide checks", () => {
  it("reads the guide version", () => {
    assert.equal(guideVersion(INSTALL), "1.0.0");
  });
  it("uses one version for every file name and tag in README and INSTALL", () => {
    const docs = ["README.md", "docs/INSTALL.md"].map((f) => ({ name: f, text: readFileSync(join(ROOT, f), "utf8") }));
    assert.deepEqual(versionProblems(docs, guideVersion(INSTALL)), []);
  });
  it("fails on mixed versions", () => {
    const p = versionProblems([{ name: "mixed.md", text: fixture("mixed-version.md") }], "1.0.0");
    assert.deepEqual(p, ["mixed.md: Open-Agent-1.0.1-x64.dmg uses 1.0.1, not 1.0.0"]);
  });
  it("names images only by digest", () => {
    assert.deepEqual(imageTagProblems(INSTALL), []);
    assert.deepEqual(imageTagProblems(fixture("image-tag.md")), ["ghcr.io/nit-1997/open-agent:1.0.0 names an image by tag"]);
  });
  it("pins every gh attestation verify", () => {
    assert.deepEqual(attestationProblems(INSTALL, "1.0.0"), []);
    assert.match(attestationProblems(fixture("bare-attest.md"), "1.0.0").join("\n"), /--signer-workflow.*--source-ref.*--deny-self-hosted-runners/s);
    const generated = notes({
      version: "1.0.0",
      prerelease: false,
      digests: { agent: `ghcr.io/nit-1997/open-agent@sha256:${D("a")}`, search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` },
      bases: { agent: "a", search: "b" },
      changes: [],
    });
    assert.deepEqual(attestationProblems(generated, "1.0.0"), []);
    assert.match(attestationProblems(generated, "1.0.1").join("\n"), /--source-ref refs\/tags\/v1.0.1/);
  });
  it("has no raw HTML outside code", () => {
    assert.deepEqual(htmlProblems(INSTALL), []);
    assert.deepEqual(htmlProblems(fixture("html-in-code.md")), []);
    assert.deepEqual(htmlProblems(fixture("html.md")), ['line 3: <div id="x">', "line 3: </div>"]);
  });
});

describe("INSTALL content", () => {
  const has = (s) => assert.ok(INSTALL.includes(s), `INSTALL.md lacks ${s}`);
  it("has every section in order", () => {
    const want = [
      "## 1. What you need",
      "## 2. Download",
      "## 3. Install",
      "## 4. First open",
      "## 5. What happens next",
      "## 6. Updates",
      "## 7. Where things are",
      "## 8. Remove everything",
      "## 9. No Mac app",
      "## 10. Security",
      "## 11. Troubleshooting",
    ];
    const at = want.map((h) => INSTALL.indexOf(h));
    assert.ok(at.every((i) => i >= 0), `missing ${want.filter((_, i) => at[i] < 0)}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  });
  it("covers the Docker engines with their first-run steps", () => {
    for (const s of [
      "Docker Desktop",
      '"Engine running"',
      "OrbStack",
      "Colima",
      "brew install colima docker docker-compose",
      "colima start",
      '"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]',
      "~/.docker/config.json",
      '"Docker Compose is too old"',
    ])
      has(s);
  });
  it("covers download checks, Open Anyway and the xattr line", () => {
    for (const s of [
      "Open-Agent-1.0.0-arm64.dmg",
      "Open-Agent-1.0.0-x64.dmg",
      '"About This Mac"',
      "shasum -a 256 -c SHA256SUMS --ignore-missing",
      "gh attestation verify Open-Agent-1.0.0-arm64.dmg --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners",
      "brew upgrade gh",
      "gh auth login",
      "gh auth status",
      '"Open Anyway"',
      "Privacy & Security",
      "Control-click",
      '"Move to Trash"',
      'xattr -dr com.apple.quarantine "/Applications/Open Agent.app"',
      '"Move to Applications"',
    ])
      has(s);
    assert.match(INSTALL, /broken or incomplete download/);
  });
  it("covers first launch, updates, paths, removal and the browser-only path", () => {
    for (const s of [
      '"Getting your agent ready"',
      '"Downloading services"',
      '"Starting"',
      '"Docker isn\'t running"',
      "Ollama",
      "LM Studio",
      '"Check for updates…"',
      '"Check for new versions"',
      '"Update services (',
      "open-agent-data",
      "open-agent-keys",
      "~/Library/Application Support/Open Agent",
      "~/Library/Logs/Open Agent",
      '"Save logs…"',
      '"Delete all data…"',
      "rm -rf ~/Library/Application\\ Support/Open\\ Agent ~/Library/Logs/Open\\ Agent",
      "git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot",
      "docker compose up -d --build",
      "http://127.0.0.1:3000",
      PRINTF,
      "docker compose pull agent search",
      "docker compose up -d --no-build",
      "open-agent-services.json",
      "docker compose down",
      "docker compose down -v",
      '"Open Agent\'s services were started elsewhere"',
      "127.0.0.1",
      "SECURITY.md",
    ])
      has(s);
  });
});
