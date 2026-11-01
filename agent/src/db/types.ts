import type { EntityKind } from "../../../shared/workspace.js";
import type { CredentialKind, Sealed } from "../crypto/envelope.js";

export const PAGE_SIZE = 5;

export type Page<T> = { items: T[]; total: number };

export type ChatSummary = { id: string; title: string; lastMessageAt: string };
export type MessageStatus = "complete" | "interrupted";
export type MessageRole = "user" | "assistant";
export type NewMessage = { role: MessageRole; content: string; status: MessageStatus };
export type StoredMessage = NewMessage & { createdAt: string };

export type VersionedEntity = { kind: EntityKind; id: string; value: unknown; version: number; updatedAt: number };

export type ArtifactRow = { id: string; chatId: string | null; title: string; pdfReady: boolean };
export type ArtifactFile = "html" | "pdf";

export type ProviderSettingsRow = { data: unknown; deviceId: string };

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
}

export interface ArtifactRepo {
  insert(row: { id: string; chatId: string | null; title: string; sizeBytes: number }): Promise<void>;
  get(id: string): Promise<ArtifactRow | undefined>;
  setPdf(id: string): Promise<void>;
}

export interface ArtifactStorage {
  upload(id: string, file: ArtifactFile, bytes: Buffer): Promise<void>;
  download(id: string, file: ArtifactFile): Promise<Buffer | undefined>;
  remove(id: string, file: ArtifactFile): Promise<void>;
}

export interface ProviderSettingsRepo {
  get(): Promise<ProviderSettingsRow>;
  put(data: object): Promise<void>;
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
  storage: ArtifactStorage;
  providerSettings: ProviderSettingsRepo;
  credentials: CredentialRepo;
}>;

export const artifactPath = (userId: string, id: string, file: ArtifactFile) => `${userId}/${id}.${file}`;
