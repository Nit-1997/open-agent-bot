import { emptyProfile } from "../../../shared/profile.js";
import type { EntityKind } from "../../../shared/workspace.js";
import type {
  ArtifactFile,
  ArtifactRow,
  ChatSummary,
  CredentialRow,
  NewMessage,
  StoredMessage,
  UserRepos,
  VersionedEntity,
} from "../../src/db/types.js";
import { PAGE_SIZE } from "../../src/db/types.js";
import { UserError } from "../../src/lib/errors.js";
import { VersionConflict } from "../../src/workspace/conflict.js";

type Chat = { id: string; userId: string; title: string; lastMessageAt: string; seq: number };

export class MemoryDb {
  profiles = new Map<string, unknown>();
  chats = new Map<string, Chat>();
  messages: Array<StoredMessage & { chatId: string; userId: string; runId: string }> = [];
  entities = new Map<string, VersionedEntity & { chatId: string; userId: string }>();
  artifacts = new Map<string, ArtifactRow & { userId: string; sizeBytes: number }>();
  objects = new Map<string, Buffer>();
  settings = new Map<string, { data: unknown; deviceId: string }>();
  credentials = new Map<string, CredentialRow & { userId: string }>();
  private clock = 0;

  tick(): number {
    return ++this.clock;
  }

  at(): string {
    return new Date(1_700_000_000_000 + this.tick() * 1000).toISOString();
  }

  forUser(userId: string): UserRepos {
    const db = this;
    if (!db.profiles.has(userId)) db.profiles.set(userId, emptyProfile());
    const owned = (chatId: string) => db.chats.get(chatId)?.userId === userId;
    const ekey = (chatId: string, kind: EntityKind, id: string) => `${chatId}\0${kind}\0${id}`;
    const okey = (id: string, file: ArtifactFile) => `${userId}/${id}.${file}`;
    return Object.freeze({
      userId,
      profiles: {
        async get() {
          return structuredClone(db.profiles.get(userId));
        },
        async putData(data: object) {
          db.profiles.set(userId, structuredClone(data));
        },
      },
      chats: {
        async claim(chatId: string) {
          const c = db.chats.get(chatId);
          if (c && c.userId !== userId) throw new UserError("This chat doesn't exist.", "not_found");
          if (!c) db.chats.set(chatId, { id: chatId, userId, title: "", lastMessageAt: db.at(), seq: db.tick() });
        },
        async exists(chatId: string) {
          return owned(chatId);
        },
        async touch(chatId: string, opts: { titleIfEmpty?: string }) {
          const c = db.chats.get(chatId);
          if (!c || c.userId !== userId) return;
          c.lastMessageAt = db.at();
          if (opts.titleIfEmpty && !c.title) c.title = opts.titleIfEmpty;
        },
        async page(page: number) {
          const mine = [...db.chats.values()]
            .filter((c) => c.userId === userId)
            .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
          const items: ChatSummary[] = mine
            .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            .map((c) => ({ id: c.id, title: c.title, lastMessageAt: c.lastMessageAt }));
          return { items, total: mine.length };
        },
      },
      messages: {
        async append(chatId: string, runId: string, rows: NewMessage[]) {
          if (!owned(chatId)) throw new UserError("That doesn't exist.", "not_found");
          for (const r of rows) db.messages.push({ ...r, chatId, userId, runId, createdAt: db.at() });
        },
        async history(chatId: string, limit = 200) {
          const mine = db.messages.filter((m) => m.chatId === chatId && m.userId === userId);
          return {
            items: mine.slice(-limit).map(({ role, content, status, createdAt }) => ({ role, content, status, createdAt })),
            total: mine.length,
          };
        },
      },
      workspace: {
        async get(chatId: string, kind: EntityKind, id: string) {
          const e = db.entities.get(ekey(chatId, kind, id));
          return e && e.userId === userId
            ? structuredClone({ kind: e.kind, id: e.id, value: e.value, version: e.version, updatedAt: e.updatedAt })
            : undefined;
        },
        async list(chatId: string, kind?: EntityKind) {
          return [...db.entities.values()]
            .filter((e) => e.chatId === chatId && e.userId === userId && (!kind || e.kind === kind))
            .sort((a, b) => a.updatedAt - b.updatedAt)
            .map((e) => structuredClone({ kind: e.kind, id: e.id, value: e.value, version: e.version, updatedAt: e.updatedAt }));
        },
        async put(chatId: string, kind: EntityKind, id: string, value: unknown, expected?: number) {
          if (!owned(chatId)) throw new UserError("That doesn't exist.", "not_found");
          const cur = db.entities.get(ekey(chatId, kind, id));
          if (expected !== undefined && (cur?.version ?? 0) !== expected) throw new VersionConflict(kind, id, expected, cur?.version ?? 0);
          const version = (cur?.version ?? 0) + 1;
          db.entities.set(ekey(chatId, kind, id), {
            chatId,
            userId,
            kind,
            id,
            value: structuredClone(value),
            version,
            updatedAt: db.tick(),
          });
          return version;
        },
        async remove(chatId: string, kind: EntityKind, id: string) {
          const e = db.entities.get(ekey(chatId, kind, id));
          return !!e && e.userId === userId && db.entities.delete(ekey(chatId, kind, id));
        },
      },
      artifacts: {
        async insert(row: { id: string; chatId: string | null; title: string; sizeBytes: number }) {
          db.artifacts.set(row.id, { ...row, userId, pdfReady: false });
        },
        async get(id: string) {
          const a = db.artifacts.get(id);
          return a && a.userId === userId ? { id: a.id, chatId: a.chatId, title: a.title, pdfReady: a.pdfReady } : undefined;
        },
        async setPdf(id: string) {
          const a = db.artifacts.get(id);
          if (a && a.userId === userId) a.pdfReady = true;
        },
      },
      storage: {
        async upload(id: string, file: ArtifactFile, bytes: Buffer) {
          db.objects.set(okey(id, file), Buffer.from(bytes));
        },
        async download(id: string, file: ArtifactFile) {
          return db.objects.get(okey(id, file));
        },
        async remove(id: string, file: ArtifactFile) {
          db.objects.delete(okey(id, file));
        },
      },
      providerSettings: {
        async get() {
          if (!db.settings.has(userId))
            db.settings.set(userId, { data: { custom: {}, enabled: {}, hidden: [] }, deviceId: crypto.randomUUID() });
          return structuredClone(db.settings.get(userId)!);
        },
        async put(data: object) {
          const cur = db.settings.get(userId) ?? { data: {}, deviceId: crypto.randomUUID() };
          db.settings.set(userId, { ...cur, data: structuredClone(data) });
        },
      },
      credentials: {
        async read(provider: string) {
          const r = db.credentials.get(`${userId}\0${provider}`);
          if (!r) return undefined;
          const { userId: _u, ...row } = r;
          return structuredClone(row);
        },
        async list() {
          return [...db.credentials.values()]
            .filter((r) => r.userId === userId)
            .map((r) => ({ provider: r.provider, kind: r.kind, hint: r.hint }));
        },
        async insert(row: Omit<CredentialRow, "version">) {
          const key = `${userId}\0${row.provider}`;
          if (db.credentials.has(key)) throw new UserError("That already exists.", "conflict");
          db.credentials.set(key, { ...structuredClone(row), version: 1, userId });
        },
        async update(row: Omit<CredentialRow, "version">, expected: number) {
          const key = `${userId}\0${row.provider}`;
          const cur = db.credentials.get(key);
          if (!cur || cur.version !== expected) return false;
          db.credentials.set(key, { ...structuredClone(row), version: expected + 1, userId });
          return true;
        },
        async delete(provider: string) {
          db.credentials.delete(`${userId}\0${provider}`);
        },
      },
    });
  }
}
