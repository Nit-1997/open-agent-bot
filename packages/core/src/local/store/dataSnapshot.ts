import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const CREDENTIALS_TABLE = "provider_credentials";

export class MissingDatabaseError extends Error {}
export class CredentialSchemaError extends Error {}

function openReadOnly(path: string): DatabaseSync {
  if (!existsSync(path)) throw new MissingDatabaseError(path);
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

const quoted = (s: string) => `'${s.replaceAll("'", "''")}'`;
const userVersion = (db: DatabaseSync) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const tableNames = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
const credentialTables = (db: DatabaseSync) => tableNames(db).filter((n) => /credential/i.test(n));

function count(db: DatabaseSync, table: string): number {
  if (!tableNames(db).includes(table)) return 0;
  return (db.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`).get() as { n: number }).n;
}

export function readDbStats(dbPath: string): { schema: number; chats: number; reports: number } {
  const db = openReadOnly(dbPath);
  try {
    return { schema: userVersion(db), chats: count(db, "chats"), reports: count(db, "artifacts") };
  } finally {
    db.close();
  }
}

export function takeSnapshot(dbPath: string, snapPath: string, afterCopy?: (path: string) => void): { schema: number } {
  const live = openReadOnly(dbPath);
  try {
    live.exec(`VACUUM INTO ${quoted(snapPath)}`);
  } finally {
    live.close();
  }
  chmodSync(snapPath, 0o600);
  afterCopy?.(snapPath);
  const copy = new DatabaseSync(snapPath);
  try {
    const tables = credentialTables(copy);
    if (tables.some((t) => t !== CREDENTIALS_TABLE)) throw new CredentialSchemaError(tables.join(", "));
    copy.exec("PRAGMA secure_delete = ON");
    if (tables.includes(CREDENTIALS_TABLE)) copy.exec(`DELETE FROM ${CREDENTIALS_TABLE}`);
    copy.exec("VACUUM");
    return { schema: userVersion(copy) };
  } finally {
    copy.close();
  }
}

export function countCredentials(file: string): { credentials: number; schema: number } {
  const db = openReadOnly(file);
  try {
    return { credentials: credentialTables(db).reduce((a, t) => a + count(db, t), 0), schema: userVersion(db) };
  } finally {
    db.close();
  }
}
