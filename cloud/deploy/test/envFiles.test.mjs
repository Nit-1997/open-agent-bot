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
import { dirProblem, KNOWN, run } from "../scripts/env-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "cloud/deploy/scripts/env-files.mjs");
const SECRET = "dummy-secret-0f3c9a7e51b2";
const WORK = realpathSync(mkdtempSync(join(tmpdir(), "env-files-")));
after(() => rmSync(WORK, { recursive: true, force: true }));

let n = 0;
function repo({ from = "deploy-config", files = { ".env-agent": 0o600, "env-files/.env-e2e": 0o600 }, ignore } = {}) {
  const root = join(WORK, String(n++));
  mkdirSync(join(root, "cloud/deploy"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ignore ?? readFileSync(join(ROOT, ".gitignore")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const src = join(root, from);
  mkdirSync(src, { recursive: true });
  for (const [name, mode] of Object.entries(files)) {
    mkdirSync(dirname(join(src, name)), { recursive: true });
    writeFileSync(join(src, name), `KEY=${SECRET}-${name}\n`, { mode });
    chmodSync(join(src, name), mode);
  }
  return { root, from: src, to: join(root, "cloud/deploy") };
}

const cli = (args, cwd = WORK) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const modeOf = (p) => statSync(p).mode & 0o777;
const line = (out, name) => out.split("\n").find((l) => l.startsWith(`${name} `));

describe("env-files.mjs", () => {
  it("knows the six top-level env files and the two env-files/ ones", () => {
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
  });

  it("dry run lists names, modes, sizes and actions only, writes nothing and never prints a value", () => {
    const r0 = repo();
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy", "--dry-run"]);
    assert.equal(r.status, 0, r.out);
    assert.match(line(r.out, ".env-agent"), /^\.env-agent 0600 \d+ copy \(dry run\)$/);
    assert.match(line(r.out, "env-files/.env-e2e"), /^env-files\/\.env-e2e 0600 \d+ copy \(dry run\)$/);
    assert.equal(line(r.out, ".env-nextjs"), ".env-nextjs - - absent");
    assert.equal(r.out.includes(SECRET), false);
    assert.equal(r.out.includes("KEY="), false);
    assert.equal(existsSync(join(r0.to, ".env-agent")), false);
    assert.equal(existsSync(join(r0.to, "env-files")), false);
  });

  it("copies to 0600 targets, creates env-files/ as 0700, keeps the sources and reports a tightened mode", () => {
    const r0 = repo({ files: { ".env-agent": 0o644, ".env-renderer": 0o400, "env-files/.env-supabase-admin": 0o600 } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 0, r.out);
    assert.match(line(r.out, ".env-agent"), /^\.env-agent 0644 \d+ copy \(target 0600, tightened\)$/);
    assert.match(line(r.out, ".env-renderer"), /^\.env-renderer 0400 \d+ copy$/);
    assert.equal(modeOf(join(r0.to, ".env-agent")), 0o600);
    assert.equal(modeOf(join(r0.to, ".env-renderer")), 0o400);
    assert.equal(modeOf(join(r0.to, "env-files")), 0o700);
    assert.equal(modeOf(join(r0.to, "env-files/.env-supabase-admin")), 0o600);
    assert.ok(readFileSync(join(r0.to, ".env-agent")).equals(readFileSync(join(r0.from, ".env-agent"))));
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.equal(r.out.includes(SECRET), false);
  });

  it("never overwrites an existing target: a second copy reports exists-skip and exits 1", () => {
    const r0 = repo();
    assert.equal(cli(["--from", r0.from, "--to", r0.to, "--copy"]).status, 0);
    writeFileSync(join(r0.to, ".env-agent"), "KEPT=1\n");
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 1, r.out);
    assert.match(line(r.out, ".env-agent"), /^\.env-agent 0600 \d+ exists-skip$/);
    assert.equal(readFileSync(join(r0.to, ".env-agent"), "utf8"), "KEPT=1\n");
  });

  it("--move deletes each source only after the written target compares equal", () => {
    const r0 = repo();
    const want = readFileSync(join(r0.from, ".env-agent"));
    const r = cli(["--from", r0.from, "--to", r0.to, "--move"]);
    assert.equal(r.status, 0, r.out);
    assert.match(line(r.out, ".env-agent"), /^\.env-agent 0600 \d+ move$/);
    assert.equal(existsSync(join(r0.from, ".env-agent")), false);
    assert.equal(existsSync(join(r0.from, "env-files/.env-e2e")), false);
    assert.ok(readFileSync(join(r0.to, ".env-agent")).equals(want));
  });

  it("--move keeps the source when the written target differs", () => {
    const r0 = repo({ files: { ".env-agent": 0o600 } });
    const lines = [];
    const code = run(
      { from: r0.from, to: r0.to, action: "move", dryRun: false },
      { log: (l) => lines.push(l), write: (fd, buf) => writeFileSync(fd, Buffer.concat([buf, Buffer.from("x")])) },
    );
    assert.equal(code, 1, lines.join("\n"));
    assert.ok(existsSync(join(r0.from, ".env-agent")));
    assert.match(lines.join("\n"), /\.env-agent differs from its source after writing; source kept/);
    assert.equal(lines.join("\n").includes(SECRET), false);
  });

  it("lists any other .env* file as unknown, does not move it, and exits 2", () => {
    const r0 = repo({ files: { ".env-agent": 0o600, ".env-x": 0o600, "env-files/.env-old": 0o600 } });
    const r = cli(["--from", r0.from, "--to", r0.to, "--copy"]);
    assert.equal(r.status, 2, r.out);
    assert.ok(r.out.includes(".env-x unknown (not moved)"), r.out);
    assert.ok(r.out.includes("env-files/.env-old unknown (not moved)"), r.out);
    assert.equal(existsSync(join(r0.to, ".env-x")), false);
    assert.ok(existsSync(join(r0.to, ".env-agent")));
  });

  describe("refuses (exit 1, nothing written)", () => {
    const refused = (r0, args, reason) => {
      const r = cli(args ?? ["--from", r0.from, "--to", r0.to, "--copy"]);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, /^env-files: refused: /m);
      assert.ok(r.out.includes(reason), r.out);
      assert.equal(r.out.includes(SECRET), false);
      if (r0) assert.equal(existsSync(join(r0.to, ".env-agent")), false);
    };

    it("without exactly one of --copy and --move", () => {
      const r0 = repo();
      refused(r0, ["--from", r0.from, "--to", r0.to], "exactly one of --copy and --move");
      refused(r0, ["--from", r0.from, "--to", r0.to, "--copy", "--move"], "exactly one of --copy and --move");
    });

    it("a --to that is not <repo>/cloud/deploy, or a --from that is neither deploy-config nor cloud/deploy", () => {
      const r0 = repo();
      mkdirSync(join(r0.root, "cloud/other"), { recursive: true });
      refused(r0, ["--from", r0.from, "--to", join(r0.root, "cloud/other"), "--copy"], "--to must end in cloud/deploy");
      mkdirSync(join(r0.root, "elsewhere"));
      refused(r0, ["--from", join(r0.root, "elsewhere"), "--to", r0.to, "--copy"], "--from must end in deploy-config or cloud/deploy");
      refused(r0, ["--from", r0.to, "--to", r0.to, "--copy"], "--from and --to are the same folder");
    });

    it("a --to reached through a symlink", () => {
      const r0 = repo();
      const link = join(r0.root, "linked");
      mkdirSync(join(link, "cloud"), { recursive: true });
      symlinkSync(r0.to, join(link, "cloud/deploy"));
      refused(r0, ["--from", r0.from, "--to", join(link, "cloud/deploy"), "--copy"], "is a symlink");
    });

    it("a --to outside a git work tree", () => {
      const outside = join(WORK, `nogit-${n++}`);
      mkdirSync(join(outside, "cloud/deploy"), { recursive: true });
      mkdirSync(join(outside, "deploy-config"));
      writeFileSync(join(outside, "deploy-config/.env-agent"), `KEY=${SECRET}\n`, { mode: 0o600 });
      refused(
        null,
        ["--from", join(outside, "deploy-config"), "--to", join(outside, "cloud/deploy"), "--copy"],
        "not inside a git work tree",
      );
      assert.equal(existsSync(join(outside, "cloud/deploy/.env-agent")), false);
    });

    it("a group- or world-writable --to, leaving its mode unchanged", () => {
      const r0 = repo();
      chmodSync(r0.to, 0o777);
      refused(r0, undefined, "is group- or world-writable");
      assert.equal(modeOf(r0.to), 0o777);
      chmodSync(r0.to, 0o755);
    });

    it("a symlinked env-files/ in the source or the target", () => {
      const r0 = repo();
      const real = join(r0.root, "real-env-files");
      mkdirSync(real);
      symlinkSync(real, join(r0.to, "env-files"));
      refused(r0, undefined, "env-files is a symlink");
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
    assert.ok(ENV_FILES.length === 2);
    for (const path of [join(AUTH_DIR, "state.json"), ...ENV_FILES]) {
      assert.ok(path.startsWith(`${ROOT}/cloud/`), path);
      const r = spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT });
      assert.equal(r.status, 0, `${path} is not git-ignored`);
    }
  });

  it("ignores every known env file name under cloud/deploy and the legacy deploy-config", () => {
    for (const base of ["cloud/deploy", "deploy-config"])
      for (const name of [...KNOWN, ".env"]) {
        const r = spawnSync("git", ["check-ignore", "-q", join(ROOT, base, name)], { cwd: ROOT });
        assert.equal(r.status, 0, `${base}/${name} is not git-ignored`);
      }
  });
});
