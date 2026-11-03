import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import type { ChatSummary, StoredMessage } from "@oab/shared/chats";
import { isUuid } from "@oab/shared/ids";
import {
  CHATS_PAGE_SIZE,
  REPORTS_PAGE_SIZE,
  SEARCH_MAX,
  SEARCH_MIN,
  SEARCH_PAGE_SIZE,
  type SearchScope,
  SNIPPET_CHARS,
} from "@oab/shared/lists";
import { emptyProfile } from "@oab/shared/profile";
import type { ArtifactFile, ArtifactListRow, ArtifactRow, CredentialRow, NewMessage, SearchRow, UserRepos } from "../../src/store/types.js";
import { UserError } from "../../src/lib/errors.js";

const TITLE_MAX = 200;
const SEARCH_DB_MIN = 2;
const SEARCH_DB_MAX = 100;

const copyCredential = <T extends Omit<CredentialRow, "version">>(row: T): T => ({
  ...row,
  ciphertext: Buffer.from(row.ciphertext),
  nonce: Buffer.from(row.nonce),
  dekWrapped: Buffer.from(row.dekWrapped),
  dekNonce: Buffer.from(row.dekNonce),
});

type Chat = { id: string; userId: string; title: string; lastMessageAt: string; seq: number };

export class MemoryDb {
  profiles = new Map<string, unknown>();
  chats = new Map<string, Chat>();
  messages: Array<StoredMessage & { chatId: string; userId: string; runId: string }> = [];
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
    if (!isUuid(userId) || userId !== userId.toLowerCase()) throw new Error("forUser needs a verified user id");
    if (!db.profiles.has(userId)) db.profiles.set(userId, emptyProfile());
    const owned = (chatId: string) => db.chats.get(chatId)?.userId === userId;
    const okey = (id: string, file: ArtifactFile) => `${userId}/${id}.${file}`;
    const summary = (c: Chat): ChatSummary => ({ id: c.id, title: c.title, lastMessageAt: c.lastMessageAt });
    const myChats = () =>
      [...db.chats.values()]
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.id.localeCompare(a.id));
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
          if (!isUuid(chatId)) throw new UserError("This chat doesn't exist.", "not_found");
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
          if (opts.titleIfEmpty && !c.title) c.title = opts.titleIfEmpty.slice(0, TITLE_MAX);
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
          if (!rows.length) return;
          if (!owned(chatId)) throw new UserError("That doesn't exist.", "not_found");
          for (const r of rows) db.messages.push({ ...r, chatId, userId, runId, createdAt: db.at() });
        },
        async history(chatId: string, limit = 200) {
          const mine = db.messages.filter((m) => m.chatId === chatId && m.userId === userId);
          return {
            items: mine.slice(-limit).map(({ role, content, status, createdAt, parts }) => ({
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
      artifacts: {
        async insert(row: { id: string; chatId: string | null; title: string; sizeBytes: number }) {
          if (!ARTIFACT_ID_RE.test(row.id)) throw new UserError("That report doesn't exist.", "not_found");
          if (row.chatId !== null && !owned(row.chatId)) throw new UserError("That doesn't exist.", "not_found");
          db.artifacts.set(row.id, {
            ...row,
            title: row.title.slice(0, TITLE_MAX),
            userId,
            pdfReady: false,
            thumbReady: false,
            createdAt: db.at(),
          });
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
          return a && a.userId === userId
            ? { id: a.id, chatId: a.chatId, title: a.title, pdfReady: a.pdfReady, thumbReady: a.thumbReady }
            : undefined;
        },
        async setPdf(id: string) {
          const a = db.artifacts.get(id);
          if (a && a.userId === userId) a.pdfReady = true;
        },
        async setThumb(id: string) {
          const a = db.artifacts.get(id);
          if (!a || a.userId !== userId) return false;
          a.thumbReady = true;
          return true;
        },
      },
      search: {
        async search(query: string, scope: SearchScope, page: number) {
          const length = Array.from(query).length;
          if (length < SEARCH_DB_MIN || length > SEARCH_DB_MAX)
            throw new UserError(`Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`, "invalid");
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
          if (file === "html" && db.objects.has(okey(id, file))) throw new UserError("The data service returned an error.", "upstream");
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
          return copyCredential(row);
        },
        async list() {
          return [...db.credentials.values()]
            .filter((r) => r.userId === userId)
            .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0))
            .map((r) => ({ provider: r.provider, kind: r.kind, hint: r.hint }));
        },
        async insert(row: Omit<CredentialRow, "version">) {
          const key = `${userId}\0${row.provider}`;
          if (db.credentials.has(key)) throw new UserError("That already exists.", "conflict");
          db.credentials.set(key, { ...copyCredential(row), version: 1, userId });
        },
        async update(row: Omit<CredentialRow, "version">, expected: number) {
          const key = `${userId}\0${row.provider}`;
          const cur = db.credentials.get(key);
          if (!cur || cur.version !== expected) return false;
          db.credentials.set(key, { ...copyCredential(row), version: expected + 1, userId });
          return true;
        },
        async delete(provider: string) {
          db.credentials.delete(`${userId}\0${provider}`);
        },
      },
    });
  }
}
