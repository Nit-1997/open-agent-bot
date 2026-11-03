import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCHEMA } from "../../src/local/store/schema.js";
import { type Migration, openSqliteStore, StoreOpenError } from "../../src/local/store/sqliteStore.js";
import { openWithUser, tempDir } from "./storeHarness.js";

const BACKUP_RE = /^open-agent-v\d+-to-v\d+-\d{8}T\d{6}Z\.db$/;
const T0 = Date.parse("2026-11-03T10:00:00.000Z");

const v = (version: number, sql: string, before?: () => void): Migration => ({ version, sql, ...(before && { before }) });
const V2 = v(2, "CREATE TABLE extra_two (x TEXT) STRICT;");

function openError(fn: () => unknown): StoreOpenError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(StoreOpenError);
    return e as StoreOpenError;
  }
  throw new Error("expected a StoreOpenError");
}

const readOnly = (path: string) => new DatabaseSync(path, { readOnly: true });
const userVersion = (db: DatabaseSync) => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

describe("schema migrations", () => {
  let tmp: ReturnType<typeof tempDir>;
  let dbPath: string;
  let backups: string;
  beforeEach(() => {
    tmp = tempDir("oab-migrate-");
    dbPath = join(tmp.dir, "open-agent.db");
    backups = join(tmp.dir, "backups");
  });
  afterEach(() => tmp.dispose());

  it("opens synchronously: the result is a store, not a promise", async () => {
    const store = openSqliteStore({ dir: tmp.dir });
    expect(store).not.toBeInstanceOf(Promise);
    expect((store as unknown as { then?: unknown }).then).toBeUndefined();
    expect(typeof store.forUser).toBe("function");
    await store.close();
  });

  it("migrates a fresh directory to v1 with no backup, and reopening is a no-op", async () => {
    const first = openSqliteStore({ dir: tmp.dir });
    expect(first.schemaVersion()).toBe(1);
    await first.close();
    expect(readdirSync(backups)).toEqual([]);
    const db = readOnly(dbPath);
    expect(userVersion(db)).toBe(1);
    db.close();
    const again = openSqliteStore({ dir: tmp.dir });
    expect(again.schemaVersion()).toBe(1);
    await again.close();
    expect(readdirSync(backups)).toEqual([]);
  });

  it("backs up v1 with data before v2 runs, then reaches v2", async () => {
    const { store, userId } = openWithUser({ dir: tmp.dir, now: () => T0 });
    const chat = randomUUID();
    await store.forUser(userId).chats.claim(chat, {});
    await store.forUser(userId).chats.touch(chat, { titleIfEmpty: "Before v2" });
    await store.close();

    const seen: Array<{ files: string[]; version: number; titles: string[] }> = [];
    const v2 = v(2, V2.sql, () => {
      const files = readdirSync(backups);
      const db = readOnly(join(backups, files[0]!));
      const titles = (db.prepare("SELECT title FROM chats").all() as Array<{ title: string }>).map((r) => r.title);
      seen.push({ files, version: userVersion(db), titles });
      db.close();
    });
    const migrated = openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, v2], now: () => T0 });
    expect(migrated.schemaVersion()).toBe(2);
    await migrated.close();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.files).toEqual(["open-agent-v1-to-v2-20261103T100000Z.db"]);
    expect(seen[0]!.version).toBe(1);
    expect(seen[0]!.titles).toEqual(["Before v2"]);
    expect(readdirSync(backups)).toEqual(["open-agent-v1-to-v2-20261103T100000Z.db"]);
    expect(statSync(join(backups, seen[0]!.files[0]!)).mode & 0o777).toBe(0o600);
  });

  it("rolls back a failing migration, keeps the backup and names it", async () => {
    await openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2], now: () => T0 }).close();
    const v3 = v(3, "CREATE TABLE extra_three (x TEXT) STRICT; INSERT INTO no_such_table VALUES (1);");
    const err = openError(() => openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2, v3], now: () => T0 + 1000 }));
    expect(err.code).toBe("db_migration");
    const backup = join(backups, "open-agent-v2-to-v3-20261103T100001Z.db");
    expect(err.message).toContain(backup);
    expect(existsSync(backup)).toBe(true);
    const db = readOnly(dbPath);
    expect(userVersion(db)).toBe(2);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extra_three'").get()).toBeUndefined();
    db.close();
    const reopened = openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2] });
    expect(reopened.schemaVersion()).toBe(2);
    await reopened.close();
  });

  it("refuses a database written by a newer version", async () => {
    await openSqliteStore({ dir: tmp.dir }).close();
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA user_version = 99");
    db.close();
    const err = openError(() => openSqliteStore({ dir: tmp.dir }));
    expect(err.code).toBe("db_newer");
    expect(err.message).toContain("newer Open Agent");
    expect(readdirSync(backups)).toEqual([]);
  });

  it("refuses a corrupt file and names it", () => {
    writeFileSync(dbPath, Buffer.alloc(16_384, 0x5a));
    const err = openError(() => openSqliteStore({ dir: tmp.dir }));
    expect(err.code).toBe("db_corrupt");
    expect(err.message).toContain(dbPath);
  });

  it("leaves no temp backup file after a successful or failed migration", async () => {
    await openSqliteStore({ dir: tmp.dir, now: () => T0 }).close();
    await openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2], now: () => T0 + 1000 }).close();
    openError(() => openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2, v(3, "BROKEN SQL")], now: () => T0 + 2000 }));
    const files = readdirSync(backups);
    expect(files).toHaveLength(2);
    expect(files.every((f) => BACKUP_RE.test(f))).toBe(true);
    expect(readdirSync(tmp.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the newest 5 backups and prunes the oldest first", async () => {
    const migrations: Migration[] = [...SCHEMA];
    await openSqliteStore({ dir: tmp.dir, now: () => T0 }).close();
    for (let n = 2; n <= 8; n++) {
      migrations.push(v(n, `CREATE TABLE extra_${n} (x TEXT) STRICT;`));
      await openSqliteStore({ dir: tmp.dir, migrations, now: () => T0 + n * 60_000 }).close();
    }
    expect(readdirSync(backups).sort()).toEqual([
      "open-agent-v3-to-v4-20261103T100400Z.db",
      "open-agent-v4-to-v5-20261103T100500Z.db",
      "open-agent-v5-to-v6-20261103T100600Z.db",
      "open-agent-v6-to-v7-20261103T100700Z.db",
      "open-agent-v7-to-v8-20261103T100800Z.db",
    ]);
  });

  it("creates the database, its WAL files and backups as 0600 under umask 077", async () => {
    const previous = process.umask(0o077);
    try {
      const { store, userId } = openWithUser({ dir: tmp.dir, now: () => T0 });
      await store.forUser(userId).chats.claim(randomUUID(), {});
      for (const f of ["open-agent.db", "open-agent.db-wal", "open-agent.db-shm"])
        expect(statSync(join(tmp.dir, f)).mode & 0o777).toBe(0o600);
      await store.close();
      await openSqliteStore({ dir: tmp.dir, migrations: [...SCHEMA, V2], now: () => T0 }).close();
      const [backup] = readdirSync(backups);
      expect(statSync(join(backups, backup!)).mode & 0o777).toBe(0o600);
      for (const d of [tmp.dir, backups, join(tmp.dir, "reports")]) expect(statSync(d).mode & 0o777).toBe(0o700);
    } finally {
      process.umask(previous);
    }
  });
});
