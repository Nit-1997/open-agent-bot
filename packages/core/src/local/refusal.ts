import { writeSync } from "node:fs";
import { ConfigError } from "../config.js";
import { escapeControl, redact } from "../lib/log.js";

export const REFUSAL_EXIT = Object.freeze({
  config: 78,
  db_corrupt: 79,
  db_newer: 80,
  db_migration: 81,
  kek_missing: 82,
  keyfile_invalid: 83,
  ui_missing: 84,
  identity: 85,
} as const);

export type RefusalCode = keyof typeof REFUSAL_EXIT;

export class StartupRefusal extends Error {
  constructor(
    readonly code: RefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "StartupRefusal";
  }
}

const isRefusalCode = (v: unknown): v is RefusalCode => typeof v === "string" && Object.hasOwn(REFUSAL_EXIT, v);

const KEY_LIKE = [/\bv\d+:[A-Za-z0-9+/]{16,}={0,2}/g, /\b[0-9a-fA-F]{32,}\b/g];

export function refusalOf(err: unknown): StartupRefusal | undefined {
  if (err instanceof StartupRefusal) return err;
  if (err instanceof ConfigError) return new StartupRefusal("config", err.message);
  if (err instanceof Error && isRefusalCode((err as { code?: unknown }).code)) {
    return new StartupRefusal((err as Error & { code: RefusalCode }).code, err.message);
  }
  return undefined;
}

const scrub = (text: string) => escapeControl(KEY_LIKE.reduce((out, re) => out.replace(re, "[redacted]"), String(redact(text))));

export const refusalLine = (r: StartupRefusal): string => `[startup] refused code=${r.code} ${scrub(r.message)}`;

export function refuse(err: unknown): never {
  const r = refusalOf(err);
  if (!r) {
    writeSync(2, `[startup] failed ${scrub(err instanceof Error ? err.message : String(err))}\n`);
    process.exit(1);
  }
  writeSync(2, `${refusalLine(r)}\n`);
  process.exit(REFUSAL_EXIT[r.code]);
}
