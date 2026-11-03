import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStore, type SqliteStore, type SqliteStoreOptions } from "../../src/local/store/sqliteStore.js";

export function tempDir(prefix = "oab-sqlite-"): { dir: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export function openWithUser(opts: SqliteStoreOptions): { store: SqliteStore; userId: string } {
  const store = openSqliteStore(opts);
  const userId = randomUUID();
  store.ensureUser(userId, `${userId}@test.invalid`);
  return { store, userId };
}
