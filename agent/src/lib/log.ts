export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

let threshold = LOG_LEVELS.indexOf("info");

export function setLogLevel(level: LogLevel): void {
  threshold = LOG_LEVELS.indexOf(level);
}

const MASK = "[redacted]";
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bsb_secret_\S+/g,
  /\bsb_publishable_\S+/g,
  /\bBearer\s+\S+/gi,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /("(?:apiKey|key|access|refresh|token|secret|password|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
];

function redactText(text: string): string {
  return PATTERNS.reduce(
    (out, re) => out.replace(re, (_match, prefix?: string) => (typeof prefix === "string" ? `${prefix}"${MASK}"` : MASK)),
    text,
  );
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    const copy = new Error(redactText(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactText(value.stack);
    return copy;
  }
  if (value && typeof value === "object") {
    try {
      return redactText(JSON.stringify(value));
    } catch {
      return MASK;
    }
  }
  return value;
}

const at =
  (level: LogLevel, write: (...args: unknown[]) => void) =>
  (...args: unknown[]): void => {
    if (LOG_LEVELS.indexOf(level) >= threshold) write(...args);
  };

export const log = {
  debug: at("debug", (...args) => console.log(...args)),
  info: at("info", (...args) => console.log(...args)),
  warn: at("warn", (...args) => console.warn(...args.map(redact))),
  error: at("error", (...args) => console.error(...args.map(redact))),
};
