import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function imageVersion(): string {
  const match = read("agent/Dockerfile").match(/^FROM mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble$/m);
  if (!match) throw new Error("agent/Dockerfile has no Playwright base image");
  return match[1];
}

describe("Playwright version pin", () => {
  const expected = imageVersion();
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { version?: string }> };

  it("pins the agent's playwright dependency exactly to the image version", () => {
    const agent = JSON.parse(read("agent/package.json")) as { dependencies: Record<string, string> };
    expect(agent.dependencies.playwright).toBe(expected);
  });

  it.each(["playwright", "playwright-core", "@playwright/test"])("locks every copy of %s to the image version", (name) => {
    const copies = Object.entries(lock.packages).filter(
      ([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    expect(copies.length).toBeGreaterThan(0);
    for (const [, entry] of copies) expect(entry.version).toBe(expected);
  });
});
