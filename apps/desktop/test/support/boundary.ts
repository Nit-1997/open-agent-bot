import { dirname, relative, resolve } from "node:path";

const PATTERNS = [
  /^\s*(?:import|export)\s+(?:type\s+)?[^"';]*?\sfrom\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];

export function importSpecifiers(text: string): string[] {
  return PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]!));
}

export function boundaryViolations(file: string, text: string, srcRoot: string): { spec: string }[] {
  return importSpecifiers(text)
    .filter((spec) => {
      if (spec === "electron" || spec.startsWith("node:")) return false;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const rel = relative(srcRoot, resolve(dirname(file), spec));
        return rel.startsWith("..") || rel === "";
      }
      return true;
    })
    .map((spec) => ({ spec }));
}
