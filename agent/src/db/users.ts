import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import type { MessagePart, MessageRole, MessageStatus } from "@oab/shared/chats";
import { isUuid } from "@oab/shared/ids";
import { CHATS_PAGE_SIZE, REPORTS_PAGE_SIZE, SEARCH_MAX, SEARCH_MIN, SEARCH_PAGE_SIZE } from "@oab/shared/lists";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { CredentialKind } from "../crypto/envelope.js";
import { UserError } from "../lib/errors.js";
import { fromBytea, toBytea } from "./bytea.js";
import type { Db } from "./client.js";
import type { Json, Tables } from "./database.types.js";
import { dbError, must, read, readPage } from "./errors.js";
import { oneOf, pageOffset } from "./rows.js";
import {
  ARTIFACTS_BUCKET,
  type ArtifactFile,
  type ArtifactListRow,
  type ArtifactRepo,
  type ArtifactStorage,
  artifactPath,
  type ChatRepo,
  type CredentialRepo,
  type CredentialRow,
  type MessageRepo,
  type ProfileRepo,
  type ProviderSettingsRepo,
  type SearchRepo,
  type SearchResult,
  type UserRepos,
} from "./types.js";

const CONTENT_TYPE: Record<ArtifactFile, string> = { html: "text/html", pdf: "application/pdf", jpg: "image/jpeg" };
const HISTORY_LIMIT = 200;

const CREDENTIAL_KINDS: readonly CredentialKind[] = ["api_key", "oauth"];

function profiles(db: Db, userId: string): ProfileRepo {
  return {
    async get() {
      const { data } = await read("profiles.get", () => db.from("profiles").select("data").eq("user_id", userId).maybeSingle());
      if (!data) throw new UserError("Your account has no profile.", "not_found");
      return data.data;
    },
    async putData(value) {
      const { data } = await must(
        "profiles.put",
        db
          .from("profiles")
          .update({ data: value as Json })
          .eq("user_id", userId)
          .select("user_id"),
      );
      if (!data?.length) throw new UserError("Your account has no profile.", "not_found");
    },
  };
}

const toChatSummary = (r: { id: string; title: string; last_message_at: string }) => ({
  id: r.id,
  title: r.title,
  lastMessageAt: r.last_message_at,
});

function chats(db: Db, userId: string): ChatRepo {
  const exists = async (chatId: string) => {
    const { data } = await read("chats.get", () => db.from("chats").select("id").eq("id", chatId).eq("user_id", userId).maybeSingle());
    return !!data;
  };
  return {
    exists,
    async claim(chatId, opts) {
      if (!isUuid(chatId)) throw new UserError("This chat doesn't exist.", "not_found");
      await must(
        "chats.claim",
        db
          .from("chats")
          .upsert(
            { id: chatId, user_id: userId, ...(opts.model && { model: opts.model.slice(0, 200) }) },
            { onConflict: "id", ignoreDuplicates: true },
          ),
      );
      if (!(await exists(chatId))) throw new UserError("This chat doesn't exist.", "not_found");
    },
    async touch(chatId, opts) {
      await must(
        "chats.touch",
        db
          .from("chats")
          .update({ last_message_at: new Date().toISOString(), ...(opts.model && { model: opts.model.slice(0, 200) }) })
          .eq("id", chatId)
          .eq("user_id", userId),
      );
      if (opts.titleIfEmpty) {
        await must(
          "chats.title",
          db
            .from("chats")
            .update({ title: opts.titleIfEmpty.slice(0, 200) })
            .eq("id", chatId)
            .eq("user_id", userId)
            .eq("title", ""),
        );
      }
    },
    async page(page) {
      const from = pageOffset(page, CHATS_PAGE_SIZE);
      const { data, total } = await readPage(
        "chats.page",
        () =>
          db
            .from("chats")
            .select("id, title, last_message_at", { count: "exact" })
            .eq("user_id", userId)
            .order("last_message_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + CHATS_PAGE_SIZE - 1),
        () => db.from("chats").select("id", { count: "exact", head: true }).eq("user_id", userId),
      );
      return { items: (data ?? []).map(toChatSummary), total };
    },
    async get(chatId) {
      if (!isUuid(chatId)) return undefined;
      const { data } = await read("chats.get", () =>
        db.from("chats").select("id, title, last_message_at").eq("id", chatId).eq("user_id", userId).maybeSingle(),
      );
      return data ? toChatSummary(data) : undefined;
    },
    async titles(chatIds) {
      const ids = [...new Set(chatIds.filter(isUuid))];
      if (!ids.length) return new Map();
      const { data } = await read("chats.titles", () => db.from("chats").select("id, title").in("id", ids).eq("user_id", userId));
      return new Map((data ?? []).map((r) => [r.id, r.title]));
    },
  };
}

const MESSAGE_ROLES: readonly MessageRole[] = ["user", "assistant"];
const MESSAGE_STATUSES: readonly MessageStatus[] = ["complete", "interrupted"];

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
const partsOf = (raw: Json | null): MessagePart[] | undefined => (raw !== null && Value.Check(PartsSchema, raw) ? raw : undefined);

function messages(db: Db, userId: string): MessageRepo {
  return {
    async append(chatId, runId, rows) {
      if (!rows.length) return;
      await must(
        "messages.append",
        db.from("chat_messages").insert(
          rows.map(({ parts, ...r }) => ({
            chat_id: chatId,
            user_id: userId,
            run_id: runId.slice(0, 100),
            ...r,
            ...(parts && { parts }),
          })),
        ),
      );
    },
    async history(chatId, limit = HISTORY_LIMIT) {
      const { data, count } = await read("messages.history", () =>
        db
          .from("chat_messages")
          .select("role, content, status, created_at, parts", { count: "exact" })
          .eq("chat_id", chatId)
          .eq("user_id", userId)
          .order("id", { ascending: false })
          .limit(limit),
      );
      const items = (data ?? [])
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
      return { items, total: count ?? 0 };
    },
  };
}

const validArtifactId = (id: string) => {
  if (!ARTIFACT_ID_RE.test(id)) throw new UserError("That report doesn't exist.", "not_found");
  return id;
};

const ARTIFACT_LIST_COLUMNS = "id, chat_id, title, pdf_path, size_bytes, created_at";

const toArtifactListRow = (
  r: Pick<Tables<"artifacts">, "id" | "chat_id" | "title" | "pdf_path" | "size_bytes" | "created_at">,
): ArtifactListRow => ({
  id: r.id,
  chatId: r.chat_id,
  title: r.title,
  pdfReady: !!r.pdf_path,
  sizeBytes: r.size_bytes,
  createdAt: r.created_at,
});

function artifacts(db: Db, userId: string): ArtifactRepo {
  return {
    async insert(row) {
      const id = validArtifactId(row.id);
      await must(
        "artifacts.insert",
        db.from("artifacts").insert({
          id,
          user_id: userId,
          chat_id: row.chatId,
          title: row.title.slice(0, 200),
          html_path: artifactPath(userId, id, "html"),
          size_bytes: row.sizeBytes,
        }),
      );
    },
    async get(id) {
      if (!ARTIFACT_ID_RE.test(id)) return undefined;
      const { data } = await read("artifacts.get", () =>
        db.from("artifacts").select("id, chat_id, title, pdf_path, thumb_path").eq("id", id).eq("user_id", userId).maybeSingle(),
      );
      return data
        ? { id: data.id, chatId: data.chat_id, title: data.title, pdfReady: !!data.pdf_path, thumbReady: !!data.thumb_path }
        : undefined;
    },
    async page(page) {
      const from = pageOffset(page, REPORTS_PAGE_SIZE);
      const { data, total } = await readPage(
        "artifacts.page",
        () =>
          db
            .from("artifacts")
            .select(ARTIFACT_LIST_COLUMNS, { count: "exact" })
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + REPORTS_PAGE_SIZE - 1),
        () => db.from("artifacts").select("id", { count: "exact", head: true }).eq("user_id", userId),
      );
      return { items: (data ?? []).map(toArtifactListRow), total };
    },
    async summary(id) {
      if (!ARTIFACT_ID_RE.test(id)) return undefined;
      const { data } = await read("artifacts.summary", () =>
        db.from("artifacts").select(ARTIFACT_LIST_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle(),
      );
      return data ? toArtifactListRow(data) : undefined;
    },
    async setPdf(id) {
      await must(
        "artifacts.setPdf",
        db
          .from("artifacts")
          .update({ pdf_path: artifactPath(userId, validArtifactId(id), "pdf") })
          .eq("id", id)
          .eq("user_id", userId),
      );
    },
    async setThumb(id) {
      const { data } = await must(
        "artifacts.setThumb",
        db
          .from("artifacts")
          .update({ thumb_path: artifactPath(userId, validArtifactId(id), "jpg") })
          .eq("id", id)
          .eq("user_id", userId)
          .select("id"),
      );
      return (data ?? []).length > 0;
    },
  };
}

const SearchRowSchema = Type.Object({
  kind: Type.Union([Type.Literal("chat"), Type.Literal("report")]),
  refId: Type.String(),
  title: Type.String(),
  at: Type.String(),
  chatId: Type.Union([Type.String(), Type.Null()]),
  match: Type.Union([Type.Literal("title"), Type.Literal("message")]),
  snippet: Type.Union([Type.String(), Type.Null()]),
  snippetStart: Type.Union([Type.Integer(), Type.Null()]),
  contentLength: Type.Union([Type.Integer(), Type.Null()]),
});

const SearchResultSchema = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  chats: Type.Integer({ minimum: 0 }),
  reports: Type.Integer({ minimum: 0 }),
  items: Type.Array(SearchRowSchema),
});

function search(db: Db, userId: string): SearchRepo {
  return {
    async search(query, scope, page) {
      const res = await db.rpc("search_user_content", {
        p_user: userId,
        p_query: query,
        p_scope: scope,
        p_limit: SEARCH_PAGE_SIZE,
        p_offset: pageOffset(page, SEARCH_PAGE_SIZE),
      });
      if (res.error?.code === "22023") throw new UserError(`Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`, "invalid");
      if (res.error) throw dbError("search", { ...res.error, status: res.status });
      if (!Value.Check(SearchResultSchema, res.data)) throw new Error("unexpected search_user_content result");
      return res.data as SearchResult;
    },
  };
}

type StorageFailure = { message?: string; statusCode?: string; status?: number; name?: string };

function storageError(where: string, e: StorageFailure): UserError {
  const status = Number(e.statusCode ?? e.status ?? 0);
  return dbError(where, { code: status ? String(status) : "", status, message: e.message });
}

function isMissingObject(e: StorageFailure): boolean {
  const status = Number(e.statusCode ?? e.status ?? 0);
  return status === 404 || (status === 400 && /not found/i.test(e.message ?? ""));
}

function storage(db: Db, userId: string): ArtifactStorage {
  const bucket = () => db.storage.from(ARTIFACTS_BUCKET);
  return {
    async upload(id, file, bytes) {
      const { error } = await bucket().upload(artifactPath(userId, validArtifactId(id), file), bytes, {
        contentType: CONTENT_TYPE[file],
        upsert: file !== "html",
      });
      if (error) throw storageError("storage.upload", error as StorageFailure);
    },
    async download(id, file) {
      const { data, error } = await bucket().download(artifactPath(userId, validArtifactId(id), file));
      if (error) {
        if (isMissingObject(error as StorageFailure)) return undefined;
        throw storageError("storage.download", error as StorageFailure);
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(id, file) {
      const { error } = await bucket().remove([artifactPath(userId, validArtifactId(id), file)]);
      if (error) throw storageError("storage.remove", error as StorageFailure);
    },
  };
}

const DEFAULT_SETTINGS = { custom: {}, enabled: {}, hidden: [] };

function providerSettings(db: Db, userId: string): ProviderSettingsRepo {
  const load = async () => {
    const { data } = await read("providerSettings.get", () =>
      db.from("provider_settings").select("data, device_id, updated_at").eq("user_id", userId).maybeSingle(),
    );
    return data ? { data: data.data, deviceId: data.device_id, stamp: data.updated_at } : undefined;
  };
  return {
    async get() {
      const found = await load();
      if (found) return found;
      await must(
        "providerSettings.create",
        db.from("provider_settings").upsert({ user_id: userId, data: DEFAULT_SETTINGS }, { onConflict: "user_id", ignoreDuplicates: true }),
      );
      const created = await load();
      if (!created) throw new UserError("Your account has no model settings.", "not_found");
      return created;
    },
    async put(value, stamp) {
      const { data } = await must(
        "providerSettings.put",
        db
          .from("provider_settings")
          .update({ data: value as Json })
          .eq("user_id", userId)
          .eq("updated_at", stamp)
          .select("updated_at"),
      );
      const next = data?.[0]?.updated_at;
      if (!next)
        throw new UserError("Your model settings changed somewhere else. Reload and try again.", "conflict", { code: "settings_changed" });
      return next;
    },
  };
}

type CredentialRowDb = Pick<
  Tables<"provider_credentials">,
  "provider" | "kind" | "ciphertext" | "nonce" | "dek_wrapped" | "dek_nonce" | "key_version" | "hint" | "version"
>;

const CREDENTIAL_COLUMNS = "provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint, version";

export const credentialFromDb = (r: CredentialRowDb): CredentialRow => ({
  provider: r.provider,
  kind: oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"),
  ciphertext: fromBytea(r.ciphertext),
  nonce: fromBytea(r.nonce),
  dekWrapped: fromBytea(r.dek_wrapped),
  dekNonce: fromBytea(r.dek_nonce),
  keyVersion: r.key_version,
  hint: r.hint,
  version: r.version,
});

export const credentialToDb = (r: Omit<CredentialRow, "version">) => ({
  provider: r.provider,
  kind: oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"),
  ciphertext: toBytea(r.ciphertext),
  nonce: toBytea(r.nonce),
  dek_wrapped: toBytea(r.dekWrapped),
  dek_nonce: toBytea(r.dekNonce),
  key_version: r.keyVersion,
  hint: r.hint,
});

function credentials(db: Db, userId: string): CredentialRepo {
  return {
    async read(provider) {
      const { data } = await read("credentials.read", () =>
        db.from("provider_credentials").select(CREDENTIAL_COLUMNS).eq("user_id", userId).eq("provider", provider).maybeSingle(),
      );
      return data ? credentialFromDb(data) : undefined;
    },
    async list() {
      const { data } = await read("credentials.list", () =>
        db.from("provider_credentials").select("provider, kind, hint").eq("user_id", userId).order("provider"),
      );
      return (data ?? []).map((r) => ({
        provider: r.provider,
        kind: oneOf(CREDENTIAL_KINDS, r.kind, "provider_credentials.kind"),
        hint: r.hint,
      }));
    },
    async insert(row) {
      await must("credentials.insert", db.from("provider_credentials").insert({ user_id: userId, ...credentialToDb(row) }));
    },
    async update(row, expectedVersion) {
      const { data } = await must(
        "credentials.update",
        db
          .from("provider_credentials")
          .update({ ...credentialToDb(row), version: expectedVersion + 1 })
          .eq("user_id", userId)
          .eq("provider", row.provider)
          .eq("version", expectedVersion)
          .select("version"),
      );
      return (data?.length ?? 0) > 0;
    },
    async delete(provider) {
      await must("credentials.delete", db.from("provider_credentials").delete().eq("user_id", userId).eq("provider", provider));
    },
  };
}

export function forUser(db: Db, userId: string): UserRepos {
  if (!isUuid(userId) || userId !== userId.toLowerCase()) throw new Error("forUser needs a verified user id");
  return Object.freeze({
    userId,
    profiles: profiles(db, userId),
    chats: chats(db, userId),
    messages: messages(db, userId),
    artifacts: artifacts(db, userId),
    search: search(db, userId),
    storage: storage(db, userId),
    providerSettings: providerSettings(db, userId),
    credentials: credentials(db, userId),
  });
}
