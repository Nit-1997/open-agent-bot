import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli, stats, writeExport } from "../../src/local/dataTools.js";
import { openWithUser, tempDir } from "./storeHarness.js";
import { readZip } from "./zipReader.js";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: vi.fn(real.openSync),
    readFileSync: vi.fn(real.readFileSync),
    createReadStream: vi.fn(real.createReadStream),
    realpathSync: Object.assign(vi.fn(real.realpathSync), { native: real.realpathSync.native }),
  };
});

const CIPHERTEXT = Buffer.from("SEEDED-CIPHERTEXT-oab-0123456789abcdef-SEEDED");
const REPORT = "AbCdEfGhIjKl";
const NOW = () => new Date("2026-11-03T10:20:30Z");

let tmp: ReturnType<typeof tempDir>;
let dataDir: string;
let userId: string;

function seed(o: { credentials?: boolean } = {}) {
  const opened = openWithUser({ dir: dataDir });
  userId = opened.userId;
  void opened.store.close();
  const db = new DatabaseSync(join(dataDir, "open-agent.db"));
  const at = "2026-11-03T10:00:00.000Z";
  const chatA = randomUUID();
  const chatB = randomUUID();
  db.prepare("INSERT INTO chats (id, user_id, title, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)").run(
    chatA,
    userId,
    "Lighthouse walk",
    at,
    at,
  );
  db.prepare("INSERT INTO chats (id, user_id, title, created_at, last_message_at) VALUES (?, ?, ?, ?, ?)").run(
    chatB,
    userId,
    "Second chat",
    at,
    at,
  );
  db.prepare("INSERT INTO artifacts (id, user_id, chat_id, title, size_bytes, pdf_ready, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
    REPORT,
    userId,
    chatA,
    "Field notes",
    13,
    at,
  );
  if (o.credentials !== false)
    db.prepare(
      "INSERT INTO provider_credentials (user_id, provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint) VALUES (?, 'openrouter', 'api_key', ?, ?, ?, ?, 1, 'sk-…abcd')",
    ).run(userId, CIPHERTEXT, Buffer.alloc(12, 1), Buffer.alloc(48, 2), Buffer.alloc(12, 3));
  db.close();
  const dir = join(dataDir, "reports", userId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${REPORT}.html`), "<p>report</p>");
  writeFileSync(join(dir, `${REPORT}.pdf`), "%PDF-1.7 tiny");
  writeFileSync(join(dir, ".upload-1234.tmp"), "partial upload");
}

const sink = () => {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  return { out, bytes: () => Buffer.concat(chunks), text: () => Buffer.concat(chunks).toString("utf8") };
};

const live = (sql: string) => {
  const db = new DatabaseSync(join(dataDir, "open-agent.db"), { readOnly: true });
  try {
    return db.prepare(sql).get() as Record<string, unknown>;
  } finally {
    db.close();
  }
};

const exportedDb = (zipBytes: Buffer) => {
  const entry = readZip(zipBytes).find((e) => e.name === "open-agent.db");
  if (!entry) throw new Error("no open-agent.db entry");
  const file = join(tmp.dir, `exported-${randomUUID()}.db`);
  writeFileSync(file, entry.data);
  return { file, data: entry.data, db: new DatabaseSync(file, { readOnly: true }) };
};

const leftovers = () => readdirSync(join(dataDir, "backups")).filter((f) => f.startsWith(".export-"));

beforeEach(() => {
  tmp = tempDir("oab-datatools-");
  dataDir = join(tmp.dir, "data");
  vi.mocked(fs.openSync).mockClear();
  vi.mocked(fs.readFileSync).mockClear();
  vi.mocked(fs.createReadStream).mockClear();
});
afterEach(() => tmp.dispose());

describe("dataTools stats", () => {
  it("reports the schema, database size, report and chat counts read-only", () => {
    seed();
    const s = stats(dataDir);
    expect(s).toMatchObject({ schema: 1, reports: 1, chats: 2 });
    expect(s.dbBytes).toBeGreaterThan(4096);
    expect(s.reportBytes).toBe("<p>report</p>".length + "%PDF-1.7 tiny".length);
  });
});

describe("dataTools export (D15)", () => {
  it("writes exactly export.json, the snapshot and the report files", async () => {
    seed();
    const { out, bytes } = sink();
    const r = await writeExport({ dataDir, out, version: "1.4.0", now: NOW });
    const entries = readZip(bytes());
    expect(entries.map((e) => e.name).sort()).toEqual(
      ["export.json", "open-agent.db", `reports/${userId}/${REPORT}.html`, `reports/${userId}/${REPORT}.pdf`].sort(),
    );
    expect(r.entries).toBe(4);
    expect(JSON.parse(entries.find((e) => e.name === "export.json")?.data.toString() ?? "{}")).toEqual({
      app: "open-agent",
      version: "1.4.0",
      schema: 1,
      exportedAt: "2026-11-03T10:20:30.000Z",
      kind: "snapshot",
      excludes: ["keys", "saved model keys"],
    });
    expect(leftovers()).toEqual([]);
  });

  it("the snapshot opens with node:sqlite, keeps the schema version and the chats", async () => {
    seed();
    const { out, bytes } = sink();
    await writeExport({ dataDir, out, version: "dev", now: NOW });
    const { db } = exportedDb(bytes());
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
    expect((db.prepare("SELECT title FROM chats ORDER BY title").all() as { title: string }[]).map((r) => r.title)).toEqual([
      "Lighthouse walk",
      "Second chat",
    ]);
    db.close();
  });

  it("the exported db has 0 provider_credentials rows while the live db keeps its row, and no ciphertext bytes anywhere", async () => {
    seed();
    const { out, bytes } = sink();
    await writeExport({ dataDir, out, version: "dev", now: NOW });
    const { db, data } = exportedDb(bytes());
    expect((db.prepare("SELECT count(*) AS n FROM provider_credentials").get() as { n: number }).n).toBe(0);
    db.close();
    expect(live("SELECT count(*) AS n FROM provider_credentials").n).toBe(1);
    expect(data.includes(CIPHERTEXT)).toBe(false);
    expect(data.includes(CIPHERTEXT.subarray(0, 24))).toBe(false);
    expect(bytes().includes(CIPHERTEXT)).toBe(false);
  });

  it("removes the temp snapshot even when writing the zip fails", async () => {
    seed();
    const out = new PassThrough();
    out.on("data", () => out.destroy(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
    await expect(writeExport({ dataDir, out, version: "dev", now: NOW })).rejects.toThrow();
    expect(leftovers()).toEqual([]);
  });

  it("SQLITE_FULL → exit 3 with [export] disk full, nothing on stdout, the snapshot removed", async () => {
    seed();
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["export"], {
      dataDir,
      stdout: stdout.out,
      stderr: stderr.out,
      version: "dev",
      now: NOW,
      hooks: {
        afterSnapshot: () => {
          throw Object.assign(new Error("database or disk is full"), { code: "ERR_SQLITE_ERROR", errcode: 13 });
        },
      },
    });
    expect(code).toBe(3);
    expect(stderr.text()).toContain("[export] disk full");
    expect(stdout.bytes().length).toBe(0);
    expect(leftovers()).toEqual([]);
  });

  it("a user_version above the known schema with provider_credentials present → rows removed, export succeeds", async () => {
    seed();
    const db = new DatabaseSync(join(dataDir, "open-agent.db"));
    db.exec("PRAGMA user_version = 99");
    db.close();
    const { out, bytes } = sink();
    await writeExport({ dataDir, out, version: "dev", now: NOW });
    const exported = exportedDb(bytes());
    expect((exported.db.prepare("SELECT count(*) AS n FROM provider_credentials").get() as { n: number }).n).toBe(0);
    expect((exported.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(99);
    exported.db.close();
    expect(
      JSON.parse(
        readZip(bytes())
          .find((e) => e.name === "export.json")
          ?.data.toString() ?? "{}",
      ).schema,
    ).toBe(99);
  });

  it("no provider_credentials table but another credential table → refused with [export] unknown credential schema", async () => {
    seed({ credentials: false });
    const db = new DatabaseSync(join(dataDir, "open-agent.db"));
    db.exec("DROP TABLE provider_credentials; CREATE TABLE model_credentials (secret BLOB); PRAGMA user_version = 2;");
    db.prepare("INSERT INTO model_credentials (secret) VALUES (?)").run(CIPHERTEXT);
    db.close();
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["export"], { dataDir, stdout: stdout.out, stderr: stderr.out, version: "dev", now: NOW });
    expect(code).toBe(4);
    expect(stderr.text()).toContain("[export] unknown credential schema");
    expect(stdout.bytes().length).toBe(0);
    expect(leftovers()).toEqual([]);
  });

  it("a symlink in reports/ pointing at the keys → refused, and the keys are never opened", async () => {
    seed();
    const keys = join(tmp.dir, "keys");
    mkdirSync(keys, { mode: 0o700 });
    writeFileSync(join(keys, "kek"), "KEK-SECRET");
    symlinkSync(join(keys, "kek"), join(dataDir, "reports", userId, "ZZZZZZZZZZZZ.html"));
    const stdout = sink();
    const stderr = sink();
    const code = await runCli(["export"], { dataDir, stdout: stdout.out, stderr: stderr.out, version: "dev", now: NOW });
    expect(code).toBe(5);
    expect(stderr.text()).toContain("[export] path outside the data folder");
    expect(stdout.bytes().includes(Buffer.from("KEK-SECRET"))).toBe(false);
    const touched = [
      ...vi.mocked(fs.openSync).mock.calls,
      ...vi.mocked(fs.readFileSync).mock.calls,
      ...vi.mocked(fs.createReadStream).mock.calls,
      ...vi.mocked(fs.realpathSync).mock.calls,
    ].map((c) => String(c[0]));
    expect(touched.filter((p) => p.startsWith(keys) || p.endsWith("ZZZZZZZZZZZZ.html"))).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  it("a reports directory that is a symlink out of the data folder → refused", async () => {
    seed();
    const elsewhere = join(tmp.dir, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(dataDir, "reports", randomUUID()));
    const stderr = sink();
    const code = await runCli(["export"], { dataDir, stdout: sink().out, stderr: stderr.out, version: "dev", now: NOW });
    expect(code).toBe(5);
  });

  it("more than the zip limits → exit 2 with [export] too large", async () => {
    seed();
    const stderr = sink();
    const code = await runCli(["export"], {
      dataDir,
      stdout: sink().out,
      stderr: stderr.out,
      version: "dev",
      now: NOW,
      limits: { maxBytes: 2048 },
    });
    expect(code).toBe(2);
    expect(stderr.text()).toContain("[export] too large");
    expect(leftovers()).toEqual([]);
  });

  it("check <db> counts the credential rows of an exported file", async () => {
    seed();
    const { out, bytes } = sink();
    await writeExport({ dataDir, out, version: "dev", now: NOW });
    const { file, db } = exportedDb(bytes());
    db.close();
    const stdout = sink();
    expect(await runCli(["check", file], { stdout: stdout.out, stderr: sink().out })).toBe(0);
    expect(JSON.parse(stdout.text())).toEqual({ credentials: 0, schema: 1 });
    const liveOut = sink();
    expect(await runCli(["check", join(dataDir, "open-agent.db")], { stdout: liveOut.out, stderr: sink().out })).toBe(0);
    expect(JSON.parse(liveOut.text())).toEqual({ credentials: 1, schema: 1 });
  });

  it("an unknown command → exit 64 with usage", async () => {
    const stderr = sink();
    expect(await runCli(["raw"], { stdout: sink().out, stderr: stderr.out })).toBe(64);
    expect(stderr.text()).toContain("usage");
  });
});
