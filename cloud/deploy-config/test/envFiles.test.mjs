import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AUTH_DIR, ENV_FILES } from "../../e2e/support/env.ts";
import { dirProblem, GROUPS, KNOWN, MAX_BYTES, parseEnv, run, TARGETS } from "../scripts/env-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "cloud/deploy-config/scripts/env-files.mjs");
const SECRET = "dummy-secret-0f3c9a7e51b2";
const WORK = realpathSync(mkdtempSync(join(tmpdir(), "env-files-")));
after(() => rmSync(WORK, { recursive: true, force: true }));

const keyOf = (name) => `KEY_${name.replace(/\W/g, "_").toUpperCase()}`;
const body = (name) => `# ${name}\n${keyOf(name)}=${SECRET}-${name}\n`;

let n = 0;
function repo({ from = "deploy-config", files = { ".env-agent": 0o600, "env-files/.env-e2e": 0o600 }, ignore, text = {} } = {}) {
  const root = join(WORK, String(n++));
  mkdirSync(join(root, "cloud/deploy-config/env-files"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ignore ?? readFileSync(join(ROOT, ".gitignore")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const src = join(root, from);
  mkdirSync(src, { recursive: true });
  for (const [name, mode] of Object.entries(files)) {
    mkdirSync(dirname(join(src, name)), { recursive: true });
    writeFileSync(join(src, name), text[name] ?? body(name), { mode });
    chmodSync(join(src, name), mode);
  }
  return { root, from: src, to: join(root, "cloud/deploy-config/env-files") };
}

const cli = (args, cwd = WORK) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const modeOf = (p) => statSync(p).mode & 0o777;
const line = (out, name) => out.split("\n").find((l) => l.startsWith(`${name} `));
const keysIn = (path) => parseEnv(readFileSync(path), "t").map((e) => e.key);

describe("env-files.mjs", () => {
  it("knows the eight old env files and maps them onto backend, frontend and ops", () => {
    assert.deepEqual(KNOWN, [
      ".env-agent",
      ".env-renderer",
      ".env-nextjs",
      ".env-caddy",
      ".env-llm",
      ".env-search",
      "env-files/.env-supabase-admin",
      "env-files/.env-e2e",
    ]);
    assert.deepEqual(GROUPS, {
      backend: [".env-agent", ".env-renderer", ".env-caddy", ".env-llm", ".env-search"],
      frontend: [".env-nextjs"],
      ops: ["env-files/.env-supabase-admin", "env-files/.env-e2e"],
    });
    assert.deepEqual(TARGETS, ["backend/.env", "frontend/.env", "ops/.env"]);
  });

  it("parseEnv reads KEY=VALUE, export lines, comments and blanks, and refuses anything else by line number only", () => {
    assert.deepEqual(
      parseEnv(Buffer.from("# c\n\nA=1\nexport B=two words\r\nC=\n"), "f").map((e) => [e.key, e.value]),
      [
        ["A", "1"],
        ["B", "two words"],
        ["C", ""],
      ],
    );
    assert.throws(
      () => parseEnv(Buffer.from(`A=1\n${SECRET}\n`), "f"),
      (e) => e.message === "f line 2 is not KEY=VALUE",
    );
    assert.throws(
      () => parseEnv(Buffer.from(`A=1\nA=${SECRET}\n`), "f"),
      (e) => e.message === "f sets A twice with different values",
    );
    assert.deepEqual(
      parseEnv(Buffer.from("A=1\nA=1\n"), "f").map((e) => e.key),
      ["A", "A"],
    );
  });

  it("dry run lists names, modes, sizes, targets and key names only, writes nothing and never prints a value", () => {
    const r0 = repo();
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy", "--dry-run"]);
    assert.equal(r.status, 0, r.out);
    assert.match(line(r.out, ".env-agent"), /^\.env-agent 0600 \d+ -> backend\/\.env$/);
    assert.match(line(r.out, "env-files/.env-e2e"), /^env-files\/\.env-e2e 0600 \d+ -> ops\/\.env$/);
    assert.equal(line(r.out, ".env-nextjs"), ".env-nextjs - - absent");
    assert.match(line(r.out, "backend/.env"), /^backend\/\.env 0600 \d+ copy \(dry run\) keys KEY__ENV_AGENT$/);
    assert.match(line(r.out, "ops/.env"), /^ops\/\.env 0600 \d+ copy \(dry run\) keys KEY_ENV_FILES__ENV_E2E$/);
    assert.equal(line(r.out, "frontend/.env"), "frontend/.env - - no sources");
    assert.equal(r.out.includes(SECRET), false);
    assert.equal(r.out.includes("="), false);
    assert.equal(existsSync(join(r0.to, "backend")), false);
    assert.equal(existsSync(join(r0.to, "ops")), false);
  });

  it("merges each group into one 0600 file in a 0700 folder, keeps the sources and every key", () => {
    const r0 = repo({
      files: {
        ".env-agent": 0o644,
        ".env-renderer": 0o600,
        ".env-caddy": 0o600,
        ".env-nextjs": 0o600,
        "env-files/.env-supabase-admin": 0o600,
      },
    });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 0, r.out);
    for (const g of ["backend", "frontend", "ops"]) {
      assert.equal(modeOf(join(r0.to, g)), 0o700, g);
      assert.equal(modeOf(join(r0.to, g, ".env")), 0o600, g);
    }
    assert.match(
      line(r.out, "backend/.env"),
      /^backend\/\.env 0600 \d+ copy \(from 0644, tightened\) keys KEY__ENV_AGENT KEY__ENV_RENDERER KEY__ENV_CADDY$/,
    );
    assert.deepEqual(keysIn(join(r0.to, "backend/.env")), ["KEY__ENV_AGENT", "KEY__ENV_RENDERER", "KEY__ENV_CADDY"]);
    assert.ok(readFileSync(join(r0.to, "frontend/.env")).equals(readFileSync(join(r0.from, ".env-nextjs"))));
    assert.ok(readFileSync(join(r0.to, "backend/.env"), "utf8").includes(`KEY__ENV_RENDERER=${SECRET}-.env-renderer\n`));
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.equal(r.out.includes(SECRET), false);
  });

  it("uses an existing group folder that is not group- or world-writable and tightens it to 0700", () => {
    const r0 = repo({ files: { ".env-nextjs": 0o600 } });
    mkdirSync(join(r0.to, "frontend"));
    chmodSync(join(r0.to, "frontend"), 0o755);
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes("--to frontend tightened to 0700"), r.out);
    assert.equal(modeOf(join(r0.to, "frontend")), 0o700);
    assert.ok(existsSync(join(r0.to, "frontend/.env")));
  });

  it("keeps a key set to the same value in two sources once, and says so by name", () => {
    const shared = `RENDERER_SECRET=${SECRET}\n`;
    const r0 = repo({
      files: { ".env-agent": 0o600, ".env-renderer": 0o600 },
      text: { ".env-agent": `A=1\n${shared}`, ".env-renderer": shared },
    });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(r.out.includes("RENDERER_SECRET in .env-renderer is the same as in .env-agent (kept once)"), r.out);
    assert.equal(readFileSync(join(r0.to, "backend/.env"), "utf8"), `A=1\n${shared}`);
    assert.equal(r.out.includes(SECRET), false);
  });

  it("refuses a key set to different values in two sources, by name only, and writes no file at all", () => {
    const r0 = repo({
      files: { ".env-agent": 0o600, ".env-renderer": 0o600, ".env-nextjs": 0o600 },
      text: { ".env-agent": `RENDERER_SECRET=${SECRET}-a\n`, ".env-renderer": `RENDERER_SECRET=${SECRET}-b\n` },
    });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^env-files: refused: RENDERER_SECRET differs between \.env-agent and \.env-renderer$/m);
    assert.equal(r.out.includes(SECRET), false);
    for (const t of TARGETS) assert.equal(existsSync(join(r0.to, t)), false, t);
  });

  it("refuses a source line that is not KEY=VALUE, by line number only", () => {
    const r0 = repo({ files: { ".env-agent": 0o600 }, text: { ".env-agent": `A=1\n"${SECRET}\n` } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /refused: \.env-agent line 2 is not KEY=VALUE/);
    assert.equal(r.out.includes(SECRET), false);
  });

  it("never overwrites an existing target: it reports exists-skip, writes the other groups and exits 1", () => {
    const r0 = repo({ files: { ".env-agent": 0o600, ".env-nextjs": 0o600 } });
    mkdirSync(join(r0.to, "backend"), { mode: 0o700 });
    writeFileSync(join(r0.to, "backend/.env"), "KEPT=1\n");
    const r = cli(["--from", r0.from, "--to", r0.to, "--move"]);
    assert.equal(r.status, 1, r.out);
    assert.equal(line(r.out, "backend/.env"), "backend/.env exists-skip");
    assert.equal(readFileSync(join(r0.to, "backend/.env"), "utf8"), "KEPT=1\n");
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.ok(existsSync(join(r0.to, "frontend/.env")));
    assert.equal(existsSync(join(r0.from, ".env-nextjs")), false);
  });

  it("--move deletes each source only after the written target holds every key with its value", () => {
    const r0 = repo({ files: { ".env-agent": 0o600, ".env-renderer": 0o600, "env-files/.env-e2e": 0o600 } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--move"]);
    assert.equal(r.status, 0, r.out);
    assert.match(line(r.out, "backend/.env"), /^backend\/\.env 0600 \d+ move keys KEY__ENV_AGENT KEY__ENV_RENDERER$/);
    for (const f of [".env-agent", ".env-renderer", "env-files/.env-e2e"]) assert.equal(existsSync(join(r0.from, f)), false, f);
    assert.deepEqual(keysIn(join(r0.to, "ops/.env")), ["KEY_ENV_FILES__ENV_E2E"]);
  });

  it("--move keeps the sources when the written target does not read back the same", () => {
    const r0 = repo({ files: { ".env-agent": 0o600 } });
    const lines = [];
    const code = run(
      { from: r0.from, to: r0.to, action: "move", dryRun: false },
      { log: (l) => lines.push(l), write: (fd, buf) => writeFileSync(fd, Buffer.concat([buf, Buffer.from("x")])) },
    );
    assert.equal(code, 1, lines.join("\n"));
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.match(lines.join("\n"), /backend\/\.env does not read back the same keys and values; sources kept/);
    assert.equal(lines.join("\n").includes(SECRET), false);
  });

  it("removes a partly written target when the write fails, and refuses", () => {
    const r0 = repo({ files: { ".env-agent": 0o600 } });
    const lines = [];
    const code = run(
      { from: r0.from, to: r0.to, action: "copy", dryRun: false },
      {
        log: (l) => lines.push(l),
        write: (fd) => {
          writeFileSync(fd, "KEY=");
          throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      },
    );
    assert.equal(code, 1, lines.join("\n"));
    assert.equal(existsSync(join(r0.to, "backend/.env")), false);
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.match(lines.join("\n"), /refused: backend\/\.env could not be written \(ENOSPC\); nothing left behind/);
  });

  it("accepts a group folder that appears between the check and mkdir, then checks it again", () => {
    const r0 = repo({ files: { "env-files/.env-e2e": 0o600 } });
    const lines = [];
    const code = run(
      { from: r0.from, to: r0.to, action: "copy", dryRun: false },
      {
        log: (l) => lines.push(l),
        mkdir: (path, opts) => {
          mkdirSync(path, opts);
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        },
      },
    );
    assert.equal(code, 0, lines.join("\n"));
    assert.ok(existsSync(join(r0.to, "ops/.env")));
  });

  it("refuses a group folder that appears as a symlink between the check and mkdir", () => {
    const r0 = repo({ files: { "env-files/.env-e2e": 0o600 } });
    mkdirSync(join(r0.root, "elsewhere"));
    const lines = [];
    const code = run(
      { from: r0.from, to: r0.to, action: "copy", dryRun: false },
      {
        log: (l) => lines.push(l),
        mkdir: (path) => {
          symlinkSync(join(r0.root, "elsewhere"), path);
          throw Object.assign(new Error("exists"), { code: "EEXIST" });
        },
      },
    );
    assert.equal(code, 1, lines.join("\n"));
    assert.match(lines.join("\n"), /--to ops is a symlink/);
  });

  it("lists any other .env* file as unknown, does not move it, and exits 2", () => {
    const r0 = repo({ files: { ".env-agent": 0o600, ".env-x": 0o600, "env-files/.env-old": 0o600 } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 2, r.out);
    assert.ok(r.out.includes(".env-x unknown (not moved)"), r.out);
    assert.ok(r.out.includes("env-files/.env-old unknown (not moved)"), r.out);
    assert.ok(existsSync(join(r0.to, "backend/.env")));
  });

  it("migrates the M6 cloud/deploy layout too", () => {
    const r0 = repo({ from: "cloud/deploy", files: { ".env-nextjs": 0o600, "env-files/.env-supabase-admin": 0o600 } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(existsSync(join(r0.to, "frontend/.env")));
    assert.ok(existsSync(join(r0.to, "ops/.env")));
  });

  describe("refuses (exit 1, nothing written)", () => {
    const refused = (r0, args, reason) => {
      const r = cli(args ?? ["--from", r0.from, "--to", r0.to, "--copy"]);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /^env-files: refused: /m);
      assert.ok(r.out.includes(reason), r.out);
      assert.equal(r.out.includes(SECRET), false);
      if (r0) for (const t of TARGETS) assert.equal(existsSync(join(r0.to, t)), false, t);
    };

    it("without exactly one of --copy and --move", () => {
      const r0 = repo();
      refused(r0, ["--from", r0.from, "--to", r0.to], "exactly one of --copy and --move");
      refused(r0, ["--from", r0.from, "--to", r0.to, "--copy", "--move"], "exactly one of --copy and --move");
    });

    it("a --to that is not cloud/deploy-config/env-files, or a --from that is not an old layout", () => {
      const r0 = repo();
      mkdirSync(join(r0.root, "cloud/deploy"), { recursive: true });
      refused(r0, ["--from", r0.from, "--to", join(r0.root, "cloud/deploy"), "--copy"], "--to must end in cloud/deploy-config/env-files");
      mkdirSync(join(r0.root, "elsewhere"));
      refused(r0, ["--from", join(r0.root, "elsewhere"), "--to", r0.to, "--copy"], "--from must end in deploy-config or cloud/deploy");
      refused(r0, ["--from", join(r0.root, "cloud/deploy-config"), "--to", r0.to, "--copy"], "--from is the new layout");
    });

    it("a --to reached through a symlink", () => {
      const r0 = repo();
      const link = join(r0.root, "linked");
      mkdirSync(join(link, "cloud/deploy-config"), { recursive: true });
      symlinkSync(r0.to, join(link, "cloud/deploy-config/env-files"));
      refused(r0, ["--from", r0.from, "--to", join(link, "cloud/deploy-config/env-files"), "--copy"], "is a symlink");
    });

    it("a --to outside a git work tree", () => {
      const outside = join(WORK, `nogit-${n++}`);
      mkdirSync(join(outside, "cloud/deploy-config/env-files"), { recursive: true });
      mkdirSync(join(outside, "deploy-config"));
      writeFileSync(join(outside, "deploy-config/.env-agent"), `KEY=${SECRET}\n`, { mode: 0o600 });
      refused(
        null,
        ["--from", join(outside, "deploy-config"), "--to", join(outside, "cloud/deploy-config/env-files"), "--copy"],
        "not inside a git work tree",
      );
      assert.equal(existsSync(join(outside, "cloud/deploy-config/env-files/backend")), false);
    });

    it("a group- or world-writable --to or group folder, leaving its mode unchanged", () => {
      const r0 = repo();
      chmodSync(r0.to, 0o777);
      refused(r0, undefined, "is group- or world-writable");
      assert.equal(modeOf(r0.to), 0o777);
      chmodSync(r0.to, 0o755);
      mkdirSync(join(r0.to, "backend"));
      chmodSync(join(r0.to, "backend"), 0o775);
      refused(r0, undefined, "--to backend is group- or world-writable");
    });

    it("a symlinked env-files/ in the source or a symlinked group folder in the target", () => {
      const r0 = repo();
      const real = join(r0.root, "real-backend");
      mkdirSync(real);
      symlinkSync(real, join(r0.to, "backend"));
      refused(r0, undefined, "--to backend is a symlink");
      const r1 = repo({ files: { ".env-agent": 0o600 } });
      const elsewhere = join(r1.root, "elsewhere");
      mkdirSync(elsewhere);
      symlinkSync(elsewhere, join(r1.from, "env-files"));
      refused(r1, undefined, "env-files is a symlink");
    });

    it("a symlinked source file", () => {
      const r0 = repo({ files: {} });
      writeFileSync(join(r0.root, "outside"), `KEY=${SECRET}\n`, { mode: 0o600 });
      symlinkSync(join(r0.root, "outside"), join(r0.from, ".env-agent"));
      refused(r0, undefined, ".env-agent is a symlink");
    });

    it("a hard-linked source file", () => {
      const r0 = repo({ files: { ".env-agent": 0o600 } });
      linkSync(join(r0.from, ".env-agent"), join(r0.root, "second-name"));
      refused(r0, undefined, ".env-agent has 2 links");
    });

    it("a FIFO source file, without blocking on it", () => {
      const r0 = repo({ files: {} });
      execFileSync("mkfifo", [join(r0.from, ".env-agent")]);
      refused(r0, undefined, ".env-agent is not a regular file");
    });

    it("a source file larger than the size cap", () => {
      const r0 = repo({ files: {} });
      writeFileSync(join(r0.from, ".env-agent"), Buffer.alloc(MAX_BYTES + 1, 0x61), { mode: 0o600 });
      refused(r0, undefined, `.env-agent is larger than ${MAX_BYTES} bytes`);
    });

    it("a target that git would not ignore", () => {
      const r0 = repo({ ignore: "node_modules/\n" });
      refused(r0, undefined, "is not git-ignored");
    });
  });

  it("dirProblem refuses symlinks, other owners and, for targets, group- or world-writable folders", () => {
    const dir = (over) => ({ isSymbolicLink: () => false, isDirectory: () => true, uid: 501, mode: 0o40700, ...over });
    assert.equal(dirProblem("d", dir(), 501, true), undefined);
    assert.match(dirProblem("d", dir({ isSymbolicLink: () => true }), 501, true), /d is a symlink/);
    assert.match(dirProblem("d", dir({ isDirectory: () => false }), 501, true), /d is not a directory/);
    assert.match(dirProblem("d", dir({ uid: 0 }), 501, false), /d is not owned by uid 501/);
    assert.match(dirProblem("d", dir({ mode: 0o40770 }), 501, true), /d is group- or world-writable/);
    assert.match(dirProblem("d", dir({ mode: 0o40702 }), 501, true), /d is group- or world-writable/);
    assert.equal(dirProblem("d", dir({ mode: 0o40777 }), 501, false), undefined);
  });
});

describe("cloud/e2e state and env files are git-ignored", () => {
  it("ignores the resolved AUTH_DIR and env-file paths that cloud/e2e/support/env.ts exports", () => {
    assert.deepEqual(ENV_FILES, [join(ROOT, "cloud/deploy-config/env-files/ops/.env")]);
    for (const path of [join(AUTH_DIR, "state.json"), ...ENV_FILES]) {
      assert.ok(path.startsWith(`${ROOT}/cloud/`), path);
      const r = spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT });
      assert.equal(r.status, 0, `${path} is not git-ignored`);
    }
  });

  it("ignores every new target and every old env file name under cloud/deploy-config, the M6 cloud/deploy and the legacy deploy-config", () => {
    for (const t of TARGETS) {
      const r = spawnSync("git", ["check-ignore", "-q", join(ROOT, "cloud/deploy-config/env-files", t)], { cwd: ROOT });
      assert.equal(r.status, 0, `${t} is not git-ignored`);
    }
    for (const base of ["cloud/deploy-config", "cloud/deploy", "deploy-config"])
      for (const name of [...KNOWN, ".env"]) {
        const r = spawnSync("git", ["check-ignore", "-q", join(ROOT, base, name)], { cwd: ROOT });
        assert.equal(r.status, 0, `${base}/${name} is not git-ignored`);
      }
  });

  it("tracks a names-only .env.example beside each target", () => {
    for (const g of Object.keys(GROUPS)) {
      const ex = `cloud/deploy-config/env-files/${g}/.env.example`;
      assert.equal(execFileSync("git", ["ls-files", ex], { cwd: ROOT, encoding: "utf8" }).trim(), ex);
    }
  });
});
