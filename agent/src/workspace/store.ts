import type { EntityKind } from "../../../shared/workspace.js";
import type { VersionedEntity, WorkspaceRepo } from "../db/types.js";
import { VersionConflict } from "./conflict.js";
import { summarize } from "./summary.js";

export type { VersionedEntity };

export interface WorkspaceStore {
  get(kind: EntityKind, id: string): Promise<VersionedEntity | undefined>;
  list(kind?: EntityKind): Promise<VersionedEntity[]>;
  put(kind: EntityKind, id: string, value: unknown, expectedVersion?: number): Promise<number>;
  remove(kind: EntityKind, id: string): Promise<boolean>;
  summary(): Promise<string>;
}

export class SupabaseWorkspaceStore implements WorkspaceStore {
  constructor(
    private readonly repo: WorkspaceRepo,
    private readonly chatId: string,
  ) {}

  get(kind: EntityKind, id: string) {
    return this.repo.get(this.chatId, kind, id);
  }

  list(kind?: EntityKind) {
    return this.repo.list(this.chatId, kind);
  }

  put(kind: EntityKind, id: string, value: unknown, expectedVersion?: number) {
    return this.repo.put(this.chatId, kind, id, value, expectedVersion);
  }

  remove(kind: EntityKind, id: string) {
    return this.repo.remove(this.chatId, kind, id);
  }

  async summary(): Promise<string> {
    return summarize(await this.list());
  }
}

export class MemoryWorkspaceStore implements WorkspaceStore {
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
    const version = (current?.version ?? 0) + 1;
    this.rows.set(this.key(kind, id), { kind, id, value: structuredClone(value), version, updatedAt: this.now() });
    return version;
  }

  async remove(kind: EntityKind, id: string) {
    return this.rows.delete(this.key(kind, id));
  }

  async summary() {
    return summarize(await this.list());
  }
}
