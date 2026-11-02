import type { EntityKind } from "../../../shared/workspace.js";
import { VersionConflict, WorkspaceFull } from "./conflict.js";
import { summarize } from "./summary.js";

export type VersionedEntity = { kind: EntityKind; id: string; value: unknown; version: number; updatedAt: number };

export const MAX_ENTITIES = 50;

export class WorkspaceStore {
  private readonly rows = new Map<string, VersionedEntity>();
  private tick = 0;

  constructor(private readonly now: () => number = () => ++this.tick) {}

  private key = (kind: EntityKind, id: string) => `${kind}\0${id}`;

  async get(kind: EntityKind, id: string) {
    const row = this.rows.get(this.key(kind, id));
    return row && structuredClone(row);
  }

  async list(kind?: EntityKind) {
    return [...this.rows.values()]
      .filter((r) => !kind || r.kind === kind)
      .sort((a, b) => a.updatedAt - b.updatedAt || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
      .map((r) => structuredClone(r));
  }

  async put(kind: EntityKind, id: string, value: unknown, expectedVersion?: number) {
    const current = this.rows.get(this.key(kind, id));
    if (expectedVersion !== undefined && (current?.version ?? 0) !== expectedVersion)
      throw new VersionConflict(kind, id, expectedVersion, current?.version ?? 0);
    if (!current && kind !== "cart" && this.rows.size >= MAX_ENTITIES) throw new WorkspaceFull(MAX_ENTITIES);
    const version = (current?.version ?? 0) + 1;
    this.rows.set(this.key(kind, id), { kind, id, value: structuredClone(value), version, updatedAt: this.now() });
    return version;
  }

  async summary() {
    return summarize(await this.list());
  }
}
