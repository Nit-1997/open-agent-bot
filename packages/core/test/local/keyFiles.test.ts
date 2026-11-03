import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../src/lib/log.js";
import {
  loadLocalKeys,
  loadOrCreateSecretFile,
  newAgentSecret,
  newHexSecret,
  newKekFile,
  parseHexSecret,
  parseKekFile,
} from "../../src/local/keyFiles.js";
import { REFUSAL_EXIT, type RefusalCode, StartupRefusal } from "../../src/local/refusal.js";
import { EnvelopeCredentialStore } from "../../src/secrets/credentialStore.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import { parseCredentialKeys } from "../../src/secrets/keys.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE } from "../fixtures/users.js";

const TSX = join(import.meta.dirname, "../../../../node_modules/tsx/dist/cli.mjs");
const VALID_KEK = `v1:${Buffer.alloc(32, 7).toString("base64")}\n`;

let root: string;
let keysDir: string;
let rendererDir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "oa-keys-")));
  keysDir = join(root, "keys");
  rendererDir = join(root, "renderer");
});

afterEach(() => {
  for (const p of [join(keysDir, "kek"), keysDir]) {
    try {
      chmodSync(p, 0o700);
    } catch {}
  }
  rmSync(root, { recursive: true, force: true });
});

const kekOpts = (path: string) => ({ path, generate: newKekFile, parse: parseKekFile, label: "credential key" });
const listing = (dir: string) => readdirSync(dir).sort();
const mode = (p: string) => statSync(p).mode & 0o777;

function refusalOf(fn: () => unknown): StartupRefusal {
  try {
    fn();
  } catch (err) {
    if (err instanceof StartupRefusal) return err;
    throw err;
  }
  throw new Error("expected a StartupRefusal");
}

function guard(overrides: Partial<Parameters<typeof loadLocalKeys>[0]> = {}) {
  const resetCredentials = vi.fn(() => 3);
  const run = () => loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 3, reset: false, resetCredentials, ...overrides });
  return { run, resetCredentials };
}

describe("loadLocalKeys first start", () => {
  it("creates the KEK as v1:<base64>\\n, mode 0600 in a 0700 directory, accepted by parseCredentialKeys", () => {
    const { kek } = loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials: () => 0 });
    const path = join(keysDir, "kek");
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/^v1:[A-Za-z0-9+/]{43}=\n$/);
    expect(mode(path)).toBe(0o600);
    expect(mode(keysDir)).toBe(0o700);
    const parsed = parseCredentialKeys(raw.trim());
    expect(parsed.current).toBe(1);
    expect(kek.current).toBe(1);
    expect(kek.keys.get(1)!.equals(parsed.keys.get(1)!)).toBe(true);
    expect(listing(keysDir)).toEqual(["kek"]);
  });

  it("creates the renderer secret as 64 hex in a 0600 file", () => {
    const { rendererSecret } = loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials: () => 0 });
    const path = join(rendererDir, "secret");
    expect(rendererSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path, "utf8")).toBe(`${rendererSecret}\n`);
    expect(mode(path)).toBe(0o600);
    expect(mode(rendererDir)).toBe(0o700);
    expect(listing(rendererDir)).toEqual(["secret"]);
  });

  it("newAgentSecret returns fresh 64 hex every call and writes nothing", () => {
    loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials: () => 0 });
    const before = [listing(root), listing(keysDir), listing(rendererDir)];
    const a = newAgentSecret();
    const b = newAgentSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect([listing(root), listing(keysDir), listing(rendererDir)]).toEqual(before);
  });
});

describe("loadLocalKeys second start", () => {
  it("returns the same bytes and writes nothing", () => {
    const first = loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials: () => 0 });
    const kekPath = join(keysDir, "kek");
    const secretPath = join(rendererDir, "secret");
    const stamp = [statSync(kekPath).mtimeMs, statSync(secretPath).mtimeMs, statSync(kekPath).ino];
    const raw = readFileSync(kekPath);
    const second = loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 5, reset: true, resetCredentials: () => 5 });
    expect(second.kek.keys.get(1)!.equals(first.kek.keys.get(1)!)).toBe(true);
    expect(second.rendererSecret).toBe(first.rendererSecret);
    expect(readFileSync(kekPath).equals(raw)).toBe(true);
    expect([statSync(kekPath).mtimeMs, statSync(secretPath).mtimeMs, statSync(kekPath).ino]).toEqual(stamp);
    expect(listing(keysDir)).toEqual(["kek"]);
    expect(listing(rendererDir)).toEqual(["secret"]);
  });
});

describe("loadOrCreateSecretFile concurrent first starts", () => {
  it("two processes racing get the same KEK, one file, 0600/0700 even with umask 0", async () => {
    const path = join(keysDir, "kek");
    const startAt = String(Date.now() + 1500);
    const runChild = () =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn(process.execPath, [TSX, join(import.meta.dirname, "fixtures/keyChild.ts"), path, startAt], {
          env: { ...process.env, NODE_OPTIONS: "" },
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) => resolve({ code, out, err }));
      });
    const [a, b] = await Promise.all([runChild(), runChild()]);
    expect(a.err).toBe("");
    expect(b.err).toBe("");
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(a.out).toMatch(/^[0-9a-f]{64}$/);
    expect(a.out).toBe(b.out);
    expect(listing(keysDir)).toEqual(["kek"]);
    expect(mode(path)).toBe(0o600);
    expect(mode(keysDir)).toBe(0o700);
  });
});

describe("loadOrCreateSecretFile refusals", () => {
  const prepared = (content: string, fileMode = 0o600) => {
    mkdirSync(keysDir, { mode: 0o700 });
    const path = join(keysDir, "kek");
    writeFileSync(path, content, { mode: fileMode });
    chmodSync(path, fileMode);
    return path;
  };

  const expectInvalid = (fn: () => unknown, path: string, detail: RegExp) => {
    const before = listing(keysDir);
    const err = refusalOf(fn);
    expect(err.code).toBe("keyfile_invalid");
    expect(err.message).toContain(path);
    expect(err.message).toMatch(detail);
    expect(err.message).not.toContain(Buffer.alloc(32, 7).toString("base64"));
    expect(listing(keysDir)).toEqual(before);
  };

  it("refuses a 0644 file and says chmod 600", () => {
    const path = prepared(VALID_KEK, 0o644);
    expectInvalid(() => loadOrCreateSecretFile(kekOpts(path)), path, /chmod 600/);
    expect(readFileSync(path, "utf8")).toBe(VALID_KEK);
  });

  it("refuses a 0600 file owned by another uid", () => {
    const path = prepared(VALID_KEK);
    const fstat = (fd: number) => {
      const s = fstatSync(fd);
      return { isFile: () => s.isFile(), mode: s.mode, uid: (process.getuid?.() ?? 0) + 1 };
    };
    expectInvalid(() => loadOrCreateSecretFile({ ...kekOpts(path), fstat }), path, /owned by uid/);
  });

  it.each([
    ["v1:short", "v1:short\n"],
    ["empty", ""],
    ["a CREDENTIAL_KEYS= prefix", `CREDENTIAL_KEYS=${VALID_KEK}`],
    ["two lines", `${VALID_KEK}${VALID_KEK}`],
    ["a key list", `${VALID_KEK.trim()},v2:${Buffer.alloc(32, 8).toString("base64")}\n`],
  ])("refuses malformed content: %s", (_name, content) => {
    const path = prepared(content);
    expectInvalid(() => loadOrCreateSecretFile(kekOpts(path)), path, /malformed/);
    expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("refuses a symlink even when it points to a valid 0600 key file", () => {
    mkdirSync(keysDir, { mode: 0o700 });
    const real = join(root, "real-kek");
    writeFileSync(real, VALID_KEK, { mode: 0o600 });
    const path = join(keysDir, "kek");
    symlinkSync(real, path);
    expectInvalid(() => loadOrCreateSecretFile(kekOpts(path)), path, /symlink/);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  it("refuses a FIFO without blocking", () => {
    mkdirSync(keysDir, { mode: 0o700 });
    const path = join(keysDir, "kek");
    expect(spawnSync("mkfifo", ["-m", "600", path]).status).toBe(0);
    expectInvalid(() => loadOrCreateSecretFile(kekOpts(path)), path, /not a regular file/);
  });

  it("refuses a directory at the key path", () => {
    mkdirSync(join(keysDir, "kek"), { recursive: true, mode: 0o700 });
    const path = join(keysDir, "kek");
    expectInvalid(() => loadOrCreateSecretFile(kekOpts(path)), path, /not a regular file/);
  });

  it("refuses a symlinked keys directory", () => {
    const realDir = join(root, "elsewhere");
    mkdirSync(realDir, { mode: 0o700 });
    writeFileSync(join(realDir, "kek"), VALID_KEK, { mode: 0o600 });
    symlinkSync(realDir, keysDir);
    const path = join(keysDir, "kek");
    const err = refusalOf(() => loadOrCreateSecretFile(kekOpts(path)));
    expect(err.code).toBe("keyfile_invalid");
    expect(err.message).toContain(keysDir);
    expect(err.message).toMatch(/symlink/);
    expect(listing(realDir)).toEqual(["kek"]);
  });

  it("refuses a regular file where the directory should be", () => {
    writeFileSync(keysDir, "", { mode: 0o600 });
    const err = refusalOf(() => loadOrCreateSecretFile(kekOpts(join(keysDir, "kek"))));
    expect(err.code).toBe("keyfile_invalid");
    expect(err.message).toMatch(/not a directory/);
  });
});

describe("loadLocalKeys KEK guard", () => {
  it("refuses kek_missing with the count when credentials exist, creating nothing", () => {
    mkdirSync(keysDir, { mode: 0o700 });
    const { run, resetCredentials } = guard();
    const err = refusalOf(run);
    expect(err.code).toBe("kek_missing");
    expect(err.message).toContain("3 saved model keys");
    expect(err.message).toContain("OPEN_AGENT_RESET_CREDENTIALS=1");
    expect(resetCredentials).not.toHaveBeenCalled();
    expect(listing(keysDir)).toEqual([]);
    expect(listing(root)).toEqual(["keys"]);
  });

  it("refuses kek_missing without creating the keys directory when it does not exist", () => {
    const { run } = guard();
    expect(refusalOf(run).code).toBe("kek_missing");
    expect(listing(root)).toEqual([]);
  });

  it("with reset deletes the credential rows once, creates a new KEK and warns with the count", () => {
    mkdirSync(keysDir, { mode: 0o700 });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    try {
      const { run, resetCredentials } = guard({ reset: true });
      const { kek } = run();
      expect(resetCredentials).toHaveBeenCalledTimes(1);
      expect(listing(keysDir)).toEqual(["kek"]);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = warn.mock.calls[0].join(" ");
      expect(line).toContain("so 3 saved model keys were deleted");
      expect(line).toContain("re-enter them in Models");
      expect(line).not.toContain(kek.keys.get(1)!.toString("base64"));
      expect(line).not.toContain(readFileSync(join(keysDir, "kek"), "utf8").trim());
    } finally {
      warn.mockRestore();
    }
  });

  it("words the reset warning for a single deleted key in the singular", () => {
    mkdirSync(keysDir, { mode: 0o700 });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    try {
      guard({ reset: true, credentialRows: () => 1, resetCredentials: vi.fn(() => 1) }).run();
      const line = warn.mock.calls[0].join(" ");
      expect(line).toContain("so 1 saved model key was deleted");
      expect(line).toContain("re-enter it in Models");
      expect(line).not.toMatch(/\bwere\b|\bthem\b/);
    } finally {
      warn.mockRestore();
    }
  });

  it("creates a missing KEK silently when there are no credential rows", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    try {
      const resetCredentials = vi.fn(() => 0);
      loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials });
      expect(resetCredentials).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(listing(keysDir)).toEqual(["kek"]);
    } finally {
      warn.mockRestore();
    }
  });

  describe("only ENOENT counts as missing", () => {
    const cases: Array<[string, (path: string) => void]> = [
      ["a dangling symlink", (path) => symlinkSync(join(root, "nowhere"), path)],
      [
        "a symlink to a valid key",
        (path) => {
          writeFileSync(join(root, "valid"), VALID_KEK, { mode: 0o600 });
          symlinkSync(join(root, "valid"), path);
        },
      ],
      [
        "a 0000-mode file",
        (path) => {
          writeFileSync(path, VALID_KEK, { mode: 0o600 });
          chmodSync(path, 0o000);
        },
      ],
      ["an empty file", (path) => writeFileSync(path, "", { mode: 0o600 })],
      ["a directory", (path) => mkdirSync(path, { mode: 0o700 })],
    ];

    it.each(cases)("%s → keyfile_invalid, no reset, nothing created", (_name, make) => {
      mkdirSync(keysDir, { mode: 0o700 });
      make(join(keysDir, "kek"));
      const before = listing(keysDir);
      const { run, resetCredentials } = guard({ reset: true });
      const err = refusalOf(run);
      expect(err.code).toBe("keyfile_invalid");
      expect(REFUSAL_EXIT[err.code]).toBe(83);
      expect(resetCredentials).not.toHaveBeenCalled();
      expect(listing(keysDir)).toEqual(before);
      expect(listing(root).filter((n) => n === "renderer")).toEqual([]);
    });
  });
});

describe("refuse()", () => {
  const CODES: Array<[RefusalCode, number]> = [
    ["config", 78],
    ["db_corrupt", 79],
    ["db_newer", 80],
    ["db_migration", 81],
    ["kek_missing", 82],
    ["keyfile_invalid", 83],
    ["ui_missing", 84],
    ["identity", 85],
  ];
  const LINE = /^\[startup\] refused code=(config|db_corrupt|db_newer|db_migration|kek_missing|keyfile_invalid|ui_missing|identity) /;
  const child = (...args: string[]) =>
    spawnSync(process.execPath, [TSX, join(import.meta.dirname, "fixtures/refuseChild.ts"), ...args], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    });

  it("maps every code to its distinct exit code", () => {
    expect(Object.entries(REFUSAL_EXIT).sort((a, b) => a[1] - b[1])).toEqual(CODES);
  });

  it.each(CODES)("prints exactly one stderr line for %s and exits %i, never a key", (code, exit) => {
    const run = child("refusal", code);
    expect(run.status).toBe(exit);
    expect(run.stdout).toBe("");
    const lines = run.stderr.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(LINE);
    expect(lines[0]).toContain(`code=${code} `);
    expect(lines[0]).not.toContain("A".repeat(43));
  });

  it("maps a ConfigError to config (78)", () => {
    const run = child("config");
    expect(run.status).toBe(78);
    const lines = run.stderr.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[startup\] refused code=config .*OPEN_AGENT_PORT/);
  });

  it.each([
    ["db_corrupt", 79],
    ["db_newer", 80],
    ["db_migration", 81],
  ])("maps a store open error with code %s to exit %i", (code, exit) => {
    const run = child("store", code);
    expect(run.status).toBe(exit);
    expect(run.stderr.split("\n").filter(Boolean)).toEqual([expect.stringMatching(new RegExp(`^\\[startup\\] refused code=${code} `))]);
  });
});

describe("KEK file round trip with the envelope store", () => {
  it("seals with one wrapper and opens after reloading the file into a new wrapper", async () => {
    const db = new MemoryDb();
    const first = loadLocalKeys({ keysDir, rendererDir, credentialRows: () => 0, reset: false, resetCredentials: () => 0 });
    const sealer = new EnvelopeCredentialStore(ALICE.id, db.forUser(ALICE.id).credentials, new LocalKeyWrapper(first.kek));
    await sealer.modify("openrouter", async () => ({ type: "api_key", key: "or-test-value" }));
    const reloaded = loadOrCreateSecretFile(kekOpts(join(keysDir, "kek")));
    const opener = new EnvelopeCredentialStore(ALICE.id, db.forUser(ALICE.id).credentials, new LocalKeyWrapper(reloaded));
    expect(await opener.read("openrouter")).toEqual({ type: "api_key", key: "or-test-value" });
  });
});

describe("file format helpers", () => {
  it("round-trips the KEK and hex formats", () => {
    expect(parseKekFile(newKekFile())?.current).toBe(1);
    expect(parseHexSecret(newHexSecret())).toMatch(/^[0-9a-f]{64}$/);
    expect(parseHexSecret(`${"a".repeat(64)}`)).toBe("a".repeat(64));
    expect(parseHexSecret(`${"A".repeat(64)}\n`)).toBeUndefined();
    expect(parseHexSecret(` ${"a".repeat(64)}`)).toBeUndefined();
    expect(parseKekFile(`v0:${Buffer.alloc(32).toString("base64")}`)).toBeUndefined();
  });
});
