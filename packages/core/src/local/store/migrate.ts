import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, openSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { escapeControl, log } from "../../lib/log.js";
import { errcodeOf, StoreOpenError } from "./errors.js";

export type Migration = Readonly<{ version: number; sql: string; before?: () => void }>;

export type MigrateOptions = Readonly<{
  dbPath: string;
  backupsDir: string;
  migrations: readonly Migration[];
  now: () => number;
  backupsKept: number;
}>;

const BACKUP_RE = /^open-agent-v(\d+)-to-v(\d+)-(\d{8}T\d{6}Z)\.db$/;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

const one = <T>(db: DatabaseSync, sql: string) => db.prepare(sql).get() as T;

export const userVersionOf = (db: DatabaseSync): number => Number(one<{ user_version: number }>(db, "PRAGMA user_version").user_version);

const utcStamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");

export const backupName = (from: number, to: number, ms: number) => `open-agent-v${from}-to-v${to}-${utcStamp(ms)}.db`;

function fsyncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function checkIntegrity(db: DatabaseSync, dbPath: string): void {
  let result: string;
  try {
    const rows = db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
    result = rows.map((r) => r.quick_check).join("; ");
  } catch (e) {
    const code = (errcodeOf(e) ?? 0) & 0xff;
    if (code === SQLITE_NOTADB || code === SQLITE_CORRUPT)
      throw new StoreOpenError("db_corrupt", `The database file ${dbPath} is damaged.`);
    throw e;
  }
  if (result !== "ok") throw new StoreOpenError("db_corrupt", `The database file ${dbPath} is damaged (${result.slice(0, 200)}).`);
}

export function latestVersion(migrations: readonly Migration[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

function backup(db: DatabaseSync, o: MigrateOptions, from: number, to: number): string {
  const final = join(o.backupsDir, backupName(from, to, o.now()));
  const temp = join(o.backupsDir, `.backup-${randomBytes(8).toString("hex")}.tmp`);
  try {
    db.prepare("VACUUM INTO ?").run(temp);
    chmodSync(temp, 0o600);
    fsyncPath(temp);
    renameSync(temp, final);
    fsyncPath(o.backupsDir);
  } finally {
    rmSync(temp, { force: true });
  }
  return final;
}

function prune(dir: string, keep: number): void {
  const backups = readdirSync(dir)
    .flatMap((f) => {
      const m = BACKUP_RE.exec(f);
      return m ? [{ f, stamp: m[3]!, to: Number(m[2]) }] : [];
    })
    .sort((a, b) => (a.stamp === b.stamp ? a.to - b.to : a.stamp < b.stamp ? -1 : 1));
  for (const { f } of backups.slice(0, Math.max(0, backups.length - keep))) rmSync(join(dir, f), { force: true });
}

export function migrate(db: DatabaseSync, o: MigrateOptions): number {
  const current = userVersionOf(db);
  const latest = latestVersion(o.migrations);
  if (current > latest)
    throw new StoreOpenError(
      "db_newer",
      `The database ${o.dbPath} was written by a newer Open Agent (schema v${current}, this version knows v${latest}). Update Open Agent.`,
    );
  const pending = [...o.migrations].filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (!pending.length) return current;
  const hasTables = one<{ n: number }>(db, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").n > 0;
  let backupPath: string | undefined;
  if (hasTables) {
    try {
      backupPath = backup(db, o, current, latest);
    } catch (e) {
      throw new StoreOpenError("db_migration", `Could not back up ${o.dbPath} before migrating: ${(e as Error).message}`);
    }
    prune(o.backupsDir, o.backupsKept);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const m of pending) {
      m.before?.();
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    }
    db.exec("COMMIT");
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    const kept = backupPath ? ` The backup is kept at ${backupPath}.` : "";
    log.error(
      `[db] migration v${current} → v${latest} failed and was rolled back (${escapeControl(String((e as Error).message)).slice(0, 300)}).${kept}`,
    );
    throw new StoreOpenError("db_migration", `Updating the database from v${current} to v${latest} failed and was rolled back.${kept}`);
  }
  return latest;
}
