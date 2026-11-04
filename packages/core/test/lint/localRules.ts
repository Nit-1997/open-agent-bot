import { posix } from "node:path";
import { importSpecifiers, type SourceTree } from "./boundary.js";

export type LocalRule = "B7" | "B8" | "B9";
export type LocalViolation = { rule: LocalRule; file: string; specifier: string };

const isSqlite = (s: string) => s === "node:sqlite" || s === "sqlite";
const resolveTarget = (file: string, s: string) =>
  s.startsWith(".")
    ? posix.normalize(posix.join(posix.dirname(file), s))
    : s.startsWith("@oab/core/")
      ? s.slice("@oab/core/".length)
      : undefined;

export function localViolations(tree: SourceTree): LocalViolation[] {
  const out: LocalViolation[] = [];
  for (const [file, code] of Object.entries(tree)) {
    const hosted = file.startsWith("hosted/");
    for (const specifier of importSpecifiers(code)) {
      const to = resolveTarget(file, specifier);
      if (isSqlite(specifier) && !file.startsWith("local/store/")) out.push({ rule: "B8", file, specifier });
      if (hosted && (isSqlite(specifier) || to?.toLowerCase().startsWith("local/"))) out.push({ rule: "B7", file, specifier });
      if (!hosted && !file.startsWith("local/") && to?.startsWith("local/")) out.push({ rule: "B9", file, specifier });
    }
  }
  return out;
}

export const withAppended = (tree: SourceTree, file: string, line: string): SourceTree => ({ ...tree, [file]: `${tree[file]}${line}` });
