import { emptyProfile } from "../../../shared/profile.js";
import type { ChatSummary, StoredMessage } from "../../../shared/chats.js";
import {
  CHATS_PAGE_SIZE,
  PLANS_PAGE_SIZE,
  REPORTS_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  type SearchScope,
  SNIPPET_CHARS,
} from "../../../shared/lists.js";
import { ENTITY_KINDS, type EntityKind } from "../../../shared/workspace.js";
import type {
  ArtifactFile,
  ArtifactListRow,
  ArtifactRow,
  CredentialRow,
  EntityCounts,
  NewMessage,
  SearchRow,
  UserRepos,
  VersionedEntity,
} from "../../src/db/types.js";
import { UserError } from "../../src/lib/errors.js";
import { VersionConflict } from "../../src/workspace/conflict.js";

type Chat = { id: string; userId: string; title: string; lastMessageAt: string; seq: number };

export class MemoryDb {
  profiles = new Map<string, unknown>();
  chats = new Map<string, Chat>();
  messages: Array<StoredMessage & { chatId: string; userId: string; runId: string }> = [];
  entities = new Map<string, VersionedEntity & { chatId: string; userId: string }>();
  artifacts = new Map<string, ArtifactRow & { userId: string; sizeBytes: number; createdAt: string }>();
  objects = new Map<string, Buffer>();
  settings = new Map<string, { data: unknown; deviceId: string; stamp: string }>();
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
    const summary = (c: Chat): ChatSummary => ({ id: c.id, title: c.title, lastMessageAt: c.lastMessageAt });
    const myChats = () =>
      [...db.chats.values()]
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id));
    const myEntities = () => [...db.entities.values()].filter((e) => e.userId === userId);
    const listRow = (a: ArtifactRow & { sizeBytes: number; createdAt: string }): ArtifactListRow => ({
      id: a.id,
      chatId: a.chatId,
      title: a.title,
      pdfReady: a.pdfReady,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
    });
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
          const mine = myChats();
          const items: ChatSummary[] = mine.slice((page - 1) * CHATS_PAGE_SIZE, page * CHATS_PAGE_SIZE).map(summary);
          return { items, total: mine.length };
        },
        async get(chatId: string) {
          const c = db.chats.get(chatId);
          return c && c.userId === userId ? summary(c) : undefined;
        },
        async titles(chatIds: string[]) {
          return new Map(chatIds.flatMap((id) => (owned(id) ? [[id, db.chats.get(id)!.title] as const] : [])));
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
            items: mine
              .slice(-limit)
              .map(({ role, content, status, createdAt, parts }) => ({
                role,
                content,
                status,
                createdAt,
                ...(parts && { parts: structuredClone(parts) }),
              })),
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
        async page(page: number, kind?: EntityKind) {
          const mine = myEntities()
            .filter((e) => !kind || e.kind === kind)
            .sort(
              (a, b) =>
                b.updatedAt - a.updatedAt || a.chatId.localeCompare(b.chatId) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
            );
          return {
            items: mine
              .slice((page - 1) * PLANS_PAGE_SIZE, page * PLANS_PAGE_SIZE)
              .map((e) =>
                structuredClone({ chatId: e.chatId, kind: e.kind, id: e.id, value: e.value, version: e.version, updatedAt: e.updatedAt }),
              ),
            total: mine.length,
          };
        },
        async counts() {
          const mine = myEntities();
          return Object.fromEntries(ENTITY_KINDS.map((k) => [k, mine.filter((e) => e.kind === k).length])) as EntityCounts;
        },
      },
      artifacts: {
        async insert(row: { id: string; chatId: string | null; title: string; sizeBytes: number }) {
          db.artifacts.set(row.id, { ...row, userId, pdfReady: false, createdAt: db.at() });
        },
        async page(page: number) {
          const mine = [...db.artifacts.values()]
            .filter((a) => a.userId === userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
          return { items: mine.slice((page - 1) * REPORTS_PAGE_SIZE, page * REPORTS_PAGE_SIZE).map(listRow), total: mine.length };
        },
        async summary(id: string) {
          const a = db.artifacts.get(id);
          return a && a.userId === userId ? listRow(a) : undefined;
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
      search: {
        async search(query: string, scope: SearchScope, page: number) {
          const needle = query.toLowerCase();
          const has = (text: string) => text.toLowerCase().includes(needle);
          const chats: SearchRow[] = myChats().flatMap((c) => {
            const hit = db.messages.filter((m) => m.chatId === c.id && m.userId === userId && has(m.content)).at(-1);
            if (!has(c.title) && !hit) return [];
            const start = hit ? Math.max(1, hit.content.toLowerCase().indexOf(needle) + 1 - 60) : null;
            return [
              {
                kind: "chat",
                refId: c.id,
                title: c.title,
                at: c.lastMessageAt,
                chatId: c.id,
                match: has(c.title) ? "title" : "message",
                snippet: hit && start ? hit.content.slice(start - 1, start - 1 + SNIPPET_CHARS) : null,
                snippetStart: start,
                contentLength: hit ? hit.content.length : null,
              },
            ];
          });
          const reports: SearchRow[] = [...db.artifacts.values()]
            .filter((a) => a.userId === userId && has(a.title))
            .map((a) => ({
              kind: "report",
              refId: a.id,
              title: a.title,
              at: a.createdAt,
              chatId: a.chatId,
              match: "title",
              snippet: null,
              snippetStart: null,
              contentLength: null,
            }));
          const scoped = [...(scope === "reports" ? [] : chats), ...(scope === "chats" ? [] : reports)].sort(
            (a, b) => b.at.localeCompare(a.at) || b.refId.localeCompare(a.refId),
          );
          return {
            total: scoped.length,
            chats: chats.length,
            reports: reports.length,
            items: scoped.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE),
          };
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
            db.settings.set(userId, { data: { custom: {}, enabled: {}, hidden: [] }, deviceId: crypto.randomUUID(), stamp: "0" });
          return structuredClone(db.settings.get(userId)!);
        },
        async put(data: object, stamp: string) {
          const cur = db.settings.get(userId);
          if (!cur || cur.stamp !== stamp)
            throw new UserError("Your model settings changed somewhere else. Reload and try again.", "conflict", {
              code: "settings_changed",
            });
          const next = String(Number(cur.stamp) + 1);
          db.settings.set(userId, { ...cur, data: structuredClone(data), stamp: next });
          return next;
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
