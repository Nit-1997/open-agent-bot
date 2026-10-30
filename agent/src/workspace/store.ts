import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { EntityKind } from "../../../shared/workspace.js";
import { VersionConflict } from "./conflict.js";
import { type StoredEntity, summarize } from "./summary.js";

type Versioned = StoredEntity & { version: number; updatedAt: number };

type Row = { kind: string; id: string; json: string; version: number; updated_at: number };

const toEntity = (r: Row): Versioned => ({ kind: r.kind as EntityKind, id: r.id, value: JSON.parse(r.json), version: r.version, updatedAt: r.updated_at });

export class WorkspaceStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(file: string, now: () => number = Date.now) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.now = now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS workspace (
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (thread_id, kind, id)
    )`);
  }

  static at(dataDir: string): WorkspaceStore {
    return new WorkspaceStore(join(dataDir, "workspace.sqlite"));
  }

  get(thread: string, kind: EntityKind, id: string): Versioned | undefined {
    const row = this.db.prepare("SELECT kind, id, json, version, updated_at FROM workspace WHERE thread_id = ? AND kind = ? AND id = ?").get(thread, kind, id) as Row | undefined;
    return row && toEntity(row);
  }

  list(thread: string, kind?: EntityKind): Versioned[] {
    const rows = (kind
      ? this.db.prepare("SELECT kind, id, json, version, updated_at FROM workspace WHERE thread_id = ? AND kind = ? ORDER BY updated_at, id").all(thread, kind)
      : this.db.prepare("SELECT kind, id, json, version, updated_at FROM workspace WHERE thread_id = ? ORDER BY updated_at, kind, id").all(thread)) as Row[];
    return rows.map(toEntity);
  }

  put(thread: string, kind: EntityKind, id: string, value: unknown, expectedVersion?: number): number {
    const current = this.get(thread, kind, id);
    if (expectedVersion !== undefined && (current?.version ?? 0) !== expectedVersion) throw new VersionConflict(kind, id, expectedVersion, current?.version ?? 0);
    const version = (current?.version ?? 0) + 1;
    this.db
      .prepare("INSERT OR REPLACE INTO workspace (thread_id, kind, id, json, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(thread, kind, id, JSON.stringify(value), version, this.now());
    return version;
  }

  remove(thread: string, kind: EntityKind, id: string): boolean {
    return Number(this.db.prepare("DELETE FROM workspace WHERE thread_id = ? AND kind = ? AND id = ?").run(thread, kind, id).changes) > 0;
  }

  summary(thread: string): string {
    return summarize(this.list(thread));
  }

  close(): void {
    this.db.close();
  }
}
