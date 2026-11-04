import { join } from "node:path";
import { readSourceTree, type SourceTree } from "../../../../packages/core/test/lint/boundary.js";

export const SRC = join(import.meta.dirname, "../../src");
export const CORE_SRC = join(import.meta.dirname, "../../../../packages/core/src");
export const BIOME = join(import.meta.dirname, "../../biome.json");

export function hostedSourceTree(): SourceTree {
  const hosted = Object.entries(readSourceTree(SRC)).map(([file, code]) => [`hosted/${file}`, code]);
  return { ...readSourceTree(CORE_SRC), ...Object.fromEntries(hosted) };
}
