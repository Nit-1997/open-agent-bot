import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { isUuid } from "@oab/shared/ids";
import type { Store, UserRepos } from "../../store/types.js";
import { monotonicClock } from "./clock.js";
import { StoreOpenError } from "./errors.js";
import { checkIntegrity, type Migration, migrate, userVersionOf } from "./migrate.js";
import { type Ctx, inTransaction, userRepos } from "./repos.js";
import { SCHEMA } from "./schema.js";
import { registerSearchFunctions } from "./search.js";

export type { Migration } from "./migrate.js";
export { StoreOpenError } from "./errors.js";
export { SCHEMA } from "./schema.js";

export type SqliteStoreOptions = Readonly<{
  dir: string;
  migrations?: readonly Migration[];
  now?: () => number;
  backupsKept?: number;
}>;

export interface SqliteStore extends Store {
  ensureUser(id: string, email: string): void;
  schemaVersion(): number;
  credentialCount(): number;
  resetCredentials(): number;
  close(): Promise<void>;
}

export const DB_FILE = "open-agent.db";
const BACKUPS_KEPT = 5;

const STAMP_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["chats", "created_at"],
  ["chats", "last_message_at"],
  ["chat_messages", "created_at"],
  ["artifacts", "created_at"],
  ["profiles", "updated_at"],
  ["provider_settings", "updated_at"],
  ["users", "created_at"],
];

function largestStamp(db: DatabaseSync): number {
  const sql = STAMP_COLUMNS.map(([t, c]) => `SELECT max(${c}) AS at FROM ${t}`).join(" UNION ALL ");
  const rows = db.prepare(sql).all() as Array<{ at: string | null }>;
  return rows.reduce((max, r) => {
    const ms = r.at ? Date.parse(r.at) : Number.NaN;
    return Number.isFinite(ms) ? Math.max(max, ms) : max;
  }, 0);
}

function createPrivateFile(path: string): void {
  closeSync(openSync(path, "a", 0o600));
}

function openDatabase(path: string): DatabaseSync {
  try {
    return new DatabaseSync(path);
  } catch (e) {
    throw new StoreOpenError("db_corrupt", `The database file ${path} can't be opened (${(e as Error).message}).`);
  }
}

export function openSqliteStore(opts: SqliteStoreOptions): SqliteStore {
  const now = opts.now ?? Date.now;
  const reportsDir = join(opts.dir, "reports");
  const backupsDir = join(opts.dir, "backups");
  for (const d of [opts.dir, reportsDir, backupsDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
  const dbPath = join(opts.dir, DB_FILE);
  createPrivateFile(dbPath);

  const db = openDatabase(dbPath);
  let version: number;
  let largest: number;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    checkIntegrity(db, dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA foreign_keys = ON");
    version = migrate(db, {
      dbPath,
      backupsDir,
      migrations: opts.migrations ?? SCHEMA,
      now,
      backupsKept: opts.backupsKept ?? BACKUPS_KEPT,
    });
    registerSearchFunctions(db);
    largest = largestStamp(db);
  } catch (e) {
    db.close();
    throw e;
  }

  const statements = new Map<string, StatementSync>();
  const stmt = (sql: string) => {
    let s = statements.get(sql);
    if (!s) {
      s = db.prepare(sql);
      statements.set(sql, s);
    }
    return s;
  };
  const clock = monotonicClock(now, largest);
  const ctx: Ctx = Object.freeze({ db, stmt, now: clock, reportsDir });
  let closed = false;

  return {
    forUser(userId: string): UserRepos {
      return userRepos(ctx, userId);
    },
    ensureUser(id, email) {
      if (!isUuid(id) || id !== id.toLowerCase()) throw new Error("ensureUser needs a lower-case UUID");
      inTransaction(db, () => {
        const at = clock();
        stmt("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING").run(id, email.toLowerCase(), at);
        stmt("INSERT INTO profiles (user_id, data, updated_at) VALUES (?, '{}', ?) ON CONFLICT (user_id) DO NOTHING").run(id, at);
      });
    },
    schemaVersion: () => (closed ? version : userVersionOf(db)),
    credentialCount: () => Number((stmt("SELECT count(*) AS n FROM provider_credentials").get() as { n: number }).n),
    resetCredentials: () => Number(stmt("DELETE FROM provider_credentials").run().changes),
    async close() {
      if (closed) return;
      closed = true;
      statements.clear();
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        db.close();
      }
    },
  };
}
