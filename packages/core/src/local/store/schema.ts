import type { Migration } from "./migrate.js";

const UUID_CHECK = (col: string) => `${col} GLOB '????????-????-????-????-????????????' AND ${col} NOT GLOB '*[^0-9a-f-]*'`;
const JSON_OBJECT = (col: string, max: number) =>
  `json_valid(${col}) AND json_type(${col}) = 'object' AND length(CAST(${col} AS BLOB)) <= ${max}`;

const V1 = `CREATE TABLE users (
  id TEXT NOT NULL PRIMARY KEY CHECK (${UUID_CHECK("id")}),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 1 AND 254 AND email = lower(email)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE profiles (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users (id),
  data TEXT NOT NULL DEFAULT '{}' CHECK (${JSON_OBJECT("data", 65536)}),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE chats (
  id TEXT NOT NULL PRIMARY KEY CHECK (${UUID_CHECK("id")}),
  user_id TEXT NOT NULL REFERENCES users (id),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  model TEXT CHECK (model IS NULL OR length(model) <= 200),
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  UNIQUE (id, user_id)
) STRICT;
CREATE INDEX chats_user_recent_idx ON chats (user_id, last_message_at DESC, id DESC);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 1 AND 100),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) <= 200000),
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete', 'interrupted')),
  parts TEXT CHECK (parts IS NULL OR (json_valid(parts) AND json_type(parts) = 'array' AND length(CAST(parts AS BLOB)) <= 1048576)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id, user_id) REFERENCES chats (id, user_id)
) STRICT;
CREATE INDEX chat_messages_chat_idx ON chat_messages (chat_id, user_id, id);

CREATE TABLE artifacts (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 12 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  user_id TEXT NOT NULL REFERENCES users (id),
  chat_id TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  pdf_ready INTEGER NOT NULL DEFAULT 0 CHECK (pdf_ready IN (0, 1)),
  thumb_ready INTEGER NOT NULL DEFAULT 0 CHECK (thumb_ready IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id, user_id) REFERENCES chats (id, user_id)
) STRICT;
CREATE INDEX artifacts_user_created_idx ON artifacts (user_id, created_at DESC, id DESC);
CREATE INDEX artifacts_chat_idx ON artifacts (chat_id, user_id);

CREATE TABLE provider_settings (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users (id),
  data TEXT NOT NULL DEFAULT '{"custom":{},"enabled":{},"hidden":[]}' CHECK (${JSON_OBJECT("data", 131072)}),
  device_id TEXT NOT NULL CHECK (${UUID_CHECK("device_id")}),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE provider_credentials (
  user_id TEXT NOT NULL REFERENCES users (id),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 64 AND provider GLOB '[a-z0-9]*' AND provider NOT GLOB '*[^a-z0-9:_.-]*'),
  kind TEXT NOT NULL CHECK (kind IN ('api_key', 'oauth')),
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) BETWEEN 17 AND 65536),
  nonce BLOB NOT NULL CHECK (length(nonce) = 12),
  dek_wrapped BLOB NOT NULL CHECK (length(dek_wrapped) = 48),
  dek_nonce BLOB NOT NULL CHECK (length(dek_nonce) = 12),
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  hint TEXT NOT NULL CHECK (length(hint) <= 80),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (user_id, provider)
) STRICT;
`;

export const SCHEMA: readonly Migration[] = Object.freeze([Object.freeze({ version: 1, sql: V1 })]);
