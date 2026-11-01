import type { ChatSummary, StoredMessage } from "../../../shared/chats.js";
import type { SearchScope } from "../../../shared/lists.js";
import type { Page } from "../../../shared/pages.js";
import type { EntityKind } from "../../../shared/workspace.js";
import type { CredentialKind, Sealed } from "../crypto/envelope.js";

export type NewMessage = Omit<StoredMessage, "createdAt">;

export type VersionedEntity = { kind: EntityKind; id: string; value: unknown; version: number; updatedAt: number };

export type ArtifactRow = { id: string; chatId: string | null; title: string; pdfReady: boolean };
export type ArtifactListRow = ArtifactRow & { sizeBytes: number; createdAt: string };
export type ChatEntity = VersionedEntity & { chatId: string };
export type EntityCounts = Record<EntityKind, number>;
export type ArtifactFile = "html" | "pdf";

export type ProviderSettingsRow = { data: unknown; deviceId: string; stamp: string };

export type CredentialRow = Sealed & { provider: string; kind: CredentialKind; hint: string; version: number };
export type CredentialListing = { provider: string; kind: CredentialKind; hint: string };

export interface ProfileRepo {
  get(): Promise<unknown>;
  putData(data: object): Promise<void>;
}

export interface ChatRepo {
  claim(chatId: string, opts: { model?: string }): Promise<void>;
  exists(chatId: string): Promise<boolean>;
  touch(chatId: string, opts: { titleIfEmpty?: string; model?: string }): Promise<void>;
  page(page: number): Promise<Page<ChatSummary>>;
  get(chatId: string): Promise<ChatSummary | undefined>;
  titles(chatIds: string[]): Promise<Map<string, string>>;
}

export interface MessageRepo {
  append(chatId: string, runId: string, rows: NewMessage[]): Promise<void>;
  history(chatId: string, limit?: number): Promise<Page<StoredMessage>>;
}

export interface WorkspaceRepo {
  get(chatId: string, kind: EntityKind, id: string): Promise<VersionedEntity | undefined>;
  list(chatId: string, kind?: EntityKind): Promise<VersionedEntity[]>;
  put(chatId: string, kind: EntityKind, id: string, value: unknown, expectedVersion?: number): Promise<number>;
  remove(chatId: string, kind: EntityKind, id: string): Promise<boolean>;
  page(page: number, kind?: EntityKind): Promise<Page<ChatEntity>>;
  counts(): Promise<EntityCounts>;
}

export interface ArtifactRepo {
  insert(row: { id: string; chatId: string | null; title: string; sizeBytes: number }): Promise<void>;
  get(id: string): Promise<ArtifactRow | undefined>;
  setPdf(id: string): Promise<void>;
  page(page: number): Promise<Page<ArtifactListRow>>;
  summary(id: string): Promise<ArtifactListRow | undefined>;
}

export type SearchRow = {
  kind: "chat" | "report";
  refId: string;
  title: string;
  at: string;
  chatId: string | null;
  match: "title" | "message";
  snippet: string | null;
  snippetStart: number | null;
  contentLength: number | null;
};

export type SearchResult = { total: number; chats: number; reports: number; items: SearchRow[] };

export interface SearchRepo {
  search(query: string, scope: SearchScope, page: number): Promise<SearchResult>;
}

export interface ArtifactStorage {
  upload(id: string, file: ArtifactFile, bytes: Buffer): Promise<void>;
  download(id: string, file: ArtifactFile): Promise<Buffer | undefined>;
  remove(id: string, file: ArtifactFile): Promise<void>;
}

export interface ProviderSettingsRepo {
  get(): Promise<ProviderSettingsRow>;
  put(data: object, stamp: string): Promise<string>;
}

export interface CredentialRepo {
  read(provider: string): Promise<CredentialRow | undefined>;
  list(): Promise<CredentialListing[]>;
  insert(row: Omit<CredentialRow, "version">): Promise<void>;
  update(row: Omit<CredentialRow, "version">, expectedVersion: number): Promise<boolean>;
  delete(provider: string): Promise<void>;
}

export type UserRepos = Readonly<{
  userId: string;
  profiles: ProfileRepo;
  chats: ChatRepo;
  messages: MessageRepo;
  workspace: WorkspaceRepo;
  artifacts: ArtifactRepo;
  search: SearchRepo;
  storage: ArtifactStorage;
  providerSettings: ProviderSettingsRepo;
  credentials: CredentialRepo;
}>;

export const ARTIFACTS_BUCKET = "artifacts";

export const artifactPath = (userId: string, id: string, file: ArtifactFile) => `${userId}/${id}.${file}`;
