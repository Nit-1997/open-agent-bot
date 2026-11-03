import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import type { MessagePart, MessageRole, MessageStatus } from "@oab/shared/chats";
import { isUuid } from "@oab/shared/ids";
import { CHATS_PAGE_SIZE, REPORTS_PAGE_SIZE, type SearchScope } from "@oab/shared/lists";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { UserError } from "../../lib/errors.js";
import type { CredentialKind } from "../../secrets/envelope.js";
import type {
  ArtifactListRow,
  ArtifactRepo,
  ChatRepo,
  CredentialRepo,
  CredentialRow,
  MessageRepo,
  ProfileRepo,
  ProviderSettingsRepo,
  SearchRepo,
  UserRepos,
} from "../../store/types.js";
import type { Clock } from "./clock.js";
import { sqliteError } from "./errors.js";
import { reportFiles, validArtifactId } from "./files.js";
import { searchUser } from "./search.js";

export type Ctx = Readonly<{
  db: DatabaseSync;
  stmt(sql: string): StatementSync;
  now: Clock;
  reportsDir: string;
}>;

const TITLE_MAX = 200;
const RUN_ID_MAX = 100;
const HISTORY_LIMIT = 200;
const DEFAULT_SETTINGS = JSON.stringify({ custom: {}, enabled: {}, hidden: [] });
const MESSAGE_ROLES: readonly MessageRole[] = ["user", "assistant"];
const MESSAGE_STATUSES: readonly MessageStatus[] = ["complete", "interrupted"];
const CREDENTIAL_KINDS: readonly CredentialKind[] = ["api_key", "oauth"];

const invalid = () => new UserError("That value isn't valid.", "invalid");
const noProfile = () => new UserError("Your account has no profile.", "not_found");
const missingChat = () => new UserError("This chat doesn't exist.", "not_found");

export const uuidColumn = (value: string): string => {
  if (!isUuid(value)) throw invalid();
  return value.toLowerCase();
};

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`unexpected ${column} value in the database`);
}

const bytes = (v: unknown): Buffer => {
  if (!(v instanceof Uint8Array)) throw new Error("not a blob value");
  return Buffer.from(v);
};

const pageOffset = (page: number, size: number) => (Math.max(1, Math.floor(page)) - 1) * size;

export function guarded<A extends unknown[], R>(where: string, fn: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof UserError) throw e;
      throw sqliteError(where, e);
    }
  };
}

export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

const PartsSchema = Type.Array(
  Type.Union([
    Type.Object({ type: Type.Literal("text"), text: Type.String() }),
    Type.Object({
      type: Type.Literal("tool"),
      id: Type.String(),
      name: Type.String(),
      args: Type.String(),
      result: Type.Optional(Type.String()),
    }),
  ]),
);

function partsOf(raw: string | null): MessagePart[] | undefined {
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return Value.Check(PartsSchema, parsed) ? (parsed as MessagePart[]) : undefined;
}

function profiles(ctx: Ctx, userId: string): ProfileRepo {
  return {
    get: guarded("profiles.get", () => {
      const row = ctx.stmt("SELECT data FROM profiles WHERE user_id = ?").get(userId) as { data: string } | undefined;
      if (!row) throw noProfile();
      return JSON.parse(row.data) as unknown;
    }),
    putData: guarded("profiles.put", (value: object) => {
      const res = ctx.stmt("UPDATE profiles SET data = ?, updated_at = ? WHERE user_id = ?").run(JSON.stringify(value), ctx.now(), userId);
      if (!res.changes) throw noProfile();
    }),
  };
}

type ChatRow = { id: string; title: string; last_message_at: string };
const toChatSummary = (r: ChatRow) => ({ id: r.id, title: r.title, lastMessageAt: r.last_message_at });
const cutModel = (model?: string) => (model ? model.slice(0, TITLE_MAX) : undefined);

function chats(ctx: Ctx, userId: string): ChatRepo {
  const owned = (chatId: string) => !!ctx.stmt("SELECT 1 AS one FROM chats WHERE id = ? AND user_id = ?").get(chatId, userId);
  return {
    claim: guarded("chats.claim", (chatId: string, opts: { model?: string }) => {
      if (!isUuid(chatId)) throw missingChat();
      const id = chatId.toLowerCase();
      const at = ctx.now();
      ctx
        .stmt("INSERT INTO chats (id, user_id, model, created_at, last_message_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
        .run(id, userId, cutModel(opts.model) ?? null, at, at);
      if (!owned(id)) throw missingChat();
    }),
    exists: guarded("chats.get", (chatId: string) => owned(uuidColumn(chatId))),
    touch: guarded("chats.touch", (chatId: string, opts: { titleIfEmpty?: string; model?: string }) => {
      const id = uuidColumn(chatId);
      inTransaction(ctx.db, () => {
        ctx
          .stmt("UPDATE chats SET last_message_at = ?, model = coalesce(?, model) WHERE id = ? AND user_id = ?")
          .run(ctx.now(), cutModel(opts.model) ?? null, id, userId);
        if (opts.titleIfEmpty)
          ctx
            .stmt("UPDATE chats SET title = ? WHERE id = ? AND user_id = ? AND title = ''")
            .run(opts.titleIfEmpty.slice(0, TITLE_MAX), id, userId);
      });
    }),
    page: guarded("chats.page", (page: number) => {
      const items = ctx
        .stmt("SELECT id, title, last_message_at FROM chats WHERE user_id = ? ORDER BY last_message_at DESC, id DESC LIMIT ? OFFSET ?")
        .all(userId, CHATS_PAGE_SIZE, pageOffset(page, CHATS_PAGE_SIZE)) as ChatRow[];
      const { n } = ctx.stmt("SELECT count(*) AS n FROM chats WHERE user_id = ?").get(userId) as { n: number };
      return { items: items.map(toChatSummary), total: Number(n) };
    }),
    get: guarded("chats.get", (chatId: string) => {
      if (!isUuid(chatId)) return undefined;
      const row = ctx.stmt("SELECT id, title, last_message_at FROM chats WHERE id = ? AND user_id = ?").get(chatId.toLowerCase(), userId) as
        | ChatRow
        | undefined;
      return row ? toChatSummary(row) : undefined;
    }),
    titles: guarded("chats.titles", (chatIds: string[]) => {
      const ids = [...new Set(chatIds.filter(isUuid).map((id) => id.toLowerCase()))];
      if (!ids.length) return new Map<string, string>();
      const rows = ctx
        .stmt("SELECT id, title FROM chats WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))")
        .all(userId, JSON.stringify(ids)) as Array<{ id: string; title: string }>;
      return new Map(rows.map((r) => [r.id, r.title]));
    }),
  };
}

type MessageRow = { role: string; content: string; status: string; created_at: string; parts: string | null };

function messages(ctx: Ctx, userId: string): MessageRepo {
  return {
    append: guarded("messages.append", (chatId: string, runId: string, rows: Parameters<MessageRepo["append"]>[2]) => {
      if (!rows.length) return;
      const id = uuidColumn(chatId);
      const insert = ctx.stmt(
        "INSERT INTO chat_messages (chat_id, user_id, run_id, role, content, status, parts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      inTransaction(ctx.db, () => {
        for (const r of rows)
          insert.run(
            id,
            userId,
            runId.slice(0, RUN_ID_MAX),
            r.role,
            r.content,
            r.status,
            r.parts ? JSON.stringify(r.parts) : null,
            ctx.now(),
          );
      });
    }),
    history: guarded("messages.history", (chatId: string, limit: number = HISTORY_LIMIT) => {
      const id = uuidColumn(chatId);
      const rows = ctx
        .stmt(
          "SELECT role, content, status, created_at, parts FROM chat_messages WHERE chat_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(id, userId, limit) as MessageRow[];
      const { n } = ctx.stmt("SELECT count(*) AS n FROM chat_messages WHERE chat_id = ? AND user_id = ?").get(id, userId) as { n: number };
      const items = rows
        .map((r) => {
          const parts = partsOf(r.parts);
          return {
            role: oneOf(MESSAGE_ROLES, r.role, "chat_messages.role"),
            content: r.content,
            status: oneOf(MESSAGE_STATUSES, r.status, "chat_messages.status"),
            createdAt: r.created_at,
            ...(parts && { parts }),
          };
        })
        .reverse();
      return { items, total: Number(n) };
    }),
  };
}

type ArtifactDbRow = {
  id: string;
  chat_id: string | null;
  title: string;
  pdf_ready: number;
  thumb_ready: number;
  size_bytes: number;
  created_at: string;
};

const ARTIFACT_COLUMNS = "id, chat_id, title, pdf_ready, thumb_ready, size_bytes, created_at";

const toArtifactListRow = (r: ArtifactDbRow): ArtifactListRow => ({
  id: r.id,
  chatId: r.chat_id,
  title: r.title,
  pdfReady: !!r.pdf_ready,
  sizeBytes: Number(r.size_bytes),
  createdAt: r.created_at,
});

function artifacts(ctx: Ctx, userId: string): ArtifactRepo {
  const find = (id: string) =>
    ARTIFACT_ID_RE.test(id)
      ? (ctx.stmt(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = ? AND user_id = ?`).get(id, userId) as ArtifactDbRow | undefined)
      : undefined;
  return {
    insert: guarded("artifacts.insert", (row: { id: string; chatId: string | null; title: string; sizeBytes: number }) => {
      const id = validArtifactId(row.id);
      const chatId = row.chatId === null ? null : uuidColumn(row.chatId);
      ctx
        .stmt("INSERT INTO artifacts (id, user_id, chat_id, title, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, userId, chatId, row.title.slice(0, TITLE_MAX), row.sizeBytes, ctx.now());
    }),
    get: guarded("artifacts.get", (id: string) => {
      const r = find(id);
      return r ? { id: r.id, chatId: r.chat_id, title: r.title, pdfReady: !!r.pdf_ready, thumbReady: !!r.thumb_ready } : undefined;
    }),
    summary: guarded("artifacts.summary", (id: string) => {
      const r = find(id);
      return r ? toArtifactListRow(r) : undefined;
    }),
    page: guarded("artifacts.page", (page: number) => {
      const rows = ctx
        .stmt(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
        .all(userId, REPORTS_PAGE_SIZE, pageOffset(page, REPORTS_PAGE_SIZE)) as ArtifactDbRow[];
      const { n } = ctx.stmt("SELECT count(*) AS n FROM artifacts WHERE user_id = ?").get(userId) as { n: number };
      return { items: rows.map(toArtifactListRow), total: Number(n) };
    }),
    setPdf: guarded("artifacts.setPdf", (id: string) => {
      ctx.stmt("UPDATE artifacts SET pdf_ready = 1 WHERE id = ? AND user_id = ?").run(validArtifactId(id), userId);
    }),
    setThumb: guarded("artifacts.setThumb", (id: string) => {
      const res = ctx.stmt("UPDATE artifacts SET thumb_ready = 1 WHERE id = ? AND user_id = ?").run(validArtifactId(id), userId);
      return Number(res.changes) > 0;
    }),
  };
}

function search(ctx: Ctx, userId: string): SearchRepo {
  return { search: guarded("search", (query: string, scope: SearchScope, page: number) => searchUser(ctx, userId, query, scope, page)) };
}

type SettingsRow = { data: string; device_id: string; updated_at: string };

function providerSettings(ctx: Ctx, userId: string): ProviderSettingsRepo {
  const load = () =>
    ctx.stmt("SELECT data, device_id, updated_at FROM provider_settings WHERE user_id = ?").get(userId) as SettingsRow | undefined;
  const toRow = (r: SettingsRow) => ({ data: JSON.parse(r.data) as unknown, deviceId: r.device_id, stamp: r.updated_at });
  return {
    get: guarded("providerSettings.get", () => {
      const found = load();
      if (found) return toRow(found);
      ctx
        .stmt("INSERT INTO provider_settings (user_id, data, device_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO NOTHING")
        .run(userId, DEFAULT_SETTINGS, randomUUID(), ctx.now());
      const created = load();
      if (!created) throw new UserError("Your account has no model settings.", "not_found");
      return toRow(created);
    }),
    put: guarded("providerSettings.put", (value: object, stamp: string) => {
      const next = ctx.now();
      const res = ctx
        .stmt("UPDATE provider_settings SET data = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?")
        .run(JSON.stringify(value), next, userId, stamp);
      if (!res.changes)
        throw new UserError("Your model settings changed somewhere else. Reload and try again.", "conflict", { code: "settings_changed" });
      return next;
    }),
  };
}

type CredentialDbRow = {
  provider: string;
  kind: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  dek_wrapped: Uint8Array;
  dek_nonce: Uint8Array;
  key_version: number;
  hint: string;
  version: number;
};

const CREDENTIAL_COLUMNS = "provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint, version";

const credentialFromDb = (r: CredentialDbRow): CredentialRow => ({
  provider: r.provider,
  kind: oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"),
  ciphertext: bytes(r.ciphertext),
  nonce: bytes(r.nonce),
  dekWrapped: bytes(r.dek_wrapped),
  dekNonce: bytes(r.dek_nonce),
  keyVersion: Number(r.key_version),
  hint: r.hint,
  version: Number(r.version),
});

const sealedParams = (r: Omit<CredentialRow, "version">) =>
  [
    oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"),
    r.ciphertext,
    r.nonce,
    r.dekWrapped,
    r.dekNonce,
    r.keyVersion,
    r.hint,
  ] as const;

function credentials(ctx: Ctx, userId: string): CredentialRepo {
  return {
    read: guarded("credentials.read", (provider: string) => {
      const row = ctx
        .stmt(`SELECT ${CREDENTIAL_COLUMNS} FROM provider_credentials WHERE user_id = ? AND provider = ?`)
        .get(userId, provider) as CredentialDbRow | undefined;
      return row ? credentialFromDb(row) : undefined;
    }),
    list: guarded("credentials.list", () => {
      const rows = ctx
        .stmt("SELECT provider, kind, hint FROM provider_credentials WHERE user_id = ? ORDER BY provider")
        .all(userId) as Array<{
        provider: string;
        kind: string;
        hint: string;
      }>;
      return rows.map((r) => ({ provider: r.provider, kind: oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"), hint: r.hint }));
    }),
    insert: guarded("credentials.insert", (row: Omit<CredentialRow, "version">) => {
      ctx
        .stmt(
          "INSERT INTO provider_credentials (user_id, provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(userId, row.provider, ...sealedParams(row));
    }),
    update: guarded("credentials.update", (row: Omit<CredentialRow, "version">, expectedVersion: number) => {
      const res = ctx
        .stmt(
          "UPDATE provider_credentials SET kind = ?, ciphertext = ?, nonce = ?, dek_wrapped = ?, dek_nonce = ?, key_version = ?, hint = ?, version = ? WHERE user_id = ? AND provider = ? AND version = ?",
        )
        .run(...sealedParams(row), expectedVersion + 1, userId, row.provider, expectedVersion);
      return Number(res.changes) > 0;
    }),
    delete: guarded("credentials.delete", (provider: string) => {
      ctx.stmt("DELETE FROM provider_credentials WHERE user_id = ? AND provider = ?").run(userId, provider);
    }),
  };
}

export function userRepos(ctx: Ctx, userId: string): UserRepos {
  if (!isUuid(userId) || userId !== userId.toLowerCase()) throw new Error("forUser needs a verified user id");
  return Object.freeze({
    userId,
    profiles: profiles(ctx, userId),
    chats: chats(ctx, userId),
    messages: messages(ctx, userId),
    artifacts: artifacts(ctx, userId),
    search: search(ctx, userId),
    storage: reportFiles(ctx.reportsDir, userId),
    providerSettings: providerSettings(ctx, userId),
    credentials: credentials(ctx, userId),
  });
}
