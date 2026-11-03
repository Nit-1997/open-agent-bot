export const REFUSAL_EXIT = Object.freeze({
  config: 78,
  db_corrupt: 79,
  db_newer: 80,
  db_migration: 81,
  kek_missing: 82,
  keyfile_invalid: 83,
  ui_missing: 84,
  identity: 85,
  listen: 86,
} as const);

export type RefusalCode = keyof typeof REFUSAL_EXIT;
export const REFUSAL_CODES = Object.keys(REFUSAL_EXIT) as RefusalCode[];

export const isRefusalCode = (v: string): v is RefusalCode => Object.hasOwn(REFUSAL_EXIT, v);
export const isRefusalExit = (n: number | undefined) => n !== undefined && n >= 78 && n <= 86;

export type RefusalReading =
  | { kind: "refused"; code: RefusalCode; line: string; message: string }
  | { kind: "mismatch"; exitCode?: number; line?: string }
  | { kind: "crashed"; exitCode: number }
  | { kind: "none" };

const PREFIX = /^[\w.-]+\s*\|\s?/;
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/;
const LINE = /^\[startup\] refused code=([a-z_]+) (.*)$/;

export function lastRefusalLine(logs: string): { code: string; line: string; message: string } | undefined {
  let found: { code: string; line: string; message: string } | undefined;
  for (const raw of logs.split(/\r?\n/)) {
    const l = raw.replace(PREFIX, "").replace(STAMP, "").trimEnd();
    const m = LINE.exec(l);
    if (m) found = { code: m[1]!, line: l, message: m[2]! };
  }
  return found;
}

export function readRefusal(exitCode: number | undefined, logs: string): RefusalReading {
  const hit = lastRefusalLine(logs);
  if (hit) {
    if (isRefusalCode(hit.code) && REFUSAL_EXIT[hit.code] === exitCode)
      return { kind: "refused", code: hit.code, line: hit.line, message: hit.message };
    return { kind: "mismatch", ...(exitCode === undefined ? {} : { exitCode }), line: hit.line };
  }
  if (isRefusalExit(exitCode)) return { kind: "mismatch", exitCode };
  if (exitCode !== undefined && exitCode !== 0) return { kind: "crashed", exitCode };
  return { kind: "none" };
}

export function savedKeyCount(message: string): number | undefined {
  const m = /holds (\d+) saved model key/.exec(message);
  return m ? Number(m[1]) : undefined;
}
