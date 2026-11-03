import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function bareImportsReachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, spec] of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
      if (spec.startsWith(".")) visit(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  };
  visit(join(SRC, entry));
  return bare;
}

describe("platform entry points", () => {
  it("@oab/ui/platform loads no CopilotKit code", () => {
    expect([...bareImportsReachableFrom("platform/index.ts")].filter((s) => s.startsWith("@copilotkit/"))).toEqual([]);
  });

  it("@oab/ui/platform/chat provides the CopilotKit runtime", async () => {
    expect([...bareImportsReachableFrom("platform/chat.ts")].some((s) => s.startsWith("@copilotkit/react-core"))).toBe(true);
    const chat = await import("../../src/platform/chat.ts");
    expect(Object.keys(chat)).toEqual(["ChatRuntime"]);
  });
});
