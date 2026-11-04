import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const NEVER_FROM_FILES = new Set(["APP_ORIGIN", "E2E_ALLOW_LIVE"]);

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [
          line.slice(0, at).trim(),
          line
            .slice(at + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      })
      .filter(([key]) => !NEVER_FROM_FILES.has(key)),
  );
}

export const readEnvFiles = (paths: readonly string[]): Record<string, string> =>
  Object.assign({}, ...paths.map((path) => readEnvFile(path)));

export type EnvReader = (name: string, optional?: boolean) => string;

export function envReader(source: NodeJS.ProcessEnv, loadFiles: () => Record<string, string>, hint: string): EnvReader {
  let files: Record<string, string> | undefined;
  return (name, optional = false) => {
    files ??= loadFiles();
    const v = (source[name] ?? files[name] ?? "").trim();
    if (!v && !optional) throw new Error(`missing ${name} (${hint})`);
    return v;
  };
}

export function envFrom(source: NodeJS.ProcessEnv): EnvReader {
  const named = source.E2E_ENV_FILE?.trim();
  return envReader(
    source,
    () => {
      if (!named) return {};
      const path = resolve(named);
      if (!existsSync(path)) throw new Error(`E2E_ENV_FILE names a missing file: ${path}`);
      return readEnvFile(path);
    },
    "set it in the environment or in the file named by E2E_ENV_FILE",
  );
}

export const env = envFrom(process.env);
