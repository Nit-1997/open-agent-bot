export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

let threshold = LOG_LEVELS.indexOf("info");

export function setLogLevel(level: LogLevel): void {
  threshold = LOG_LEVELS.indexOf(level);
}

const at =
  (level: LogLevel, write: (...args: unknown[]) => void) =>
  (...args: unknown[]): void => {
    if (LOG_LEVELS.indexOf(level) >= threshold) write(...args);
  };

export const log = {
  debug: at("debug", (...args) => console.log(...args)),
  info: at("info", (...args) => console.log(...args)),
  warn: at("warn", (...args) => console.warn(...args)),
  error: at("error", (...args) => console.error(...args)),
};
