import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const BASE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble(@sha256:[0-9a-f]{64})?/g;

const baseImages = () => [...read("packages/core/Dockerfile").matchAll(BASE)].map((m) => ({ version: m[1]!, digest: m[2] }));

function imageVersion(): string {
  const [first] = baseImages();
  if (!first) throw new Error("packages/core/Dockerfile has no Playwright base image");
  return first.version;
}

describe("Playwright version pin", () => {
  const expected = imageVersion();
  const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, { version?: string }> };

  it("pins every Playwright base image in the agent Dockerfile by one tag and one digest", () => {
    const images = baseImages();
    expect(images.length).toBe(2);
    for (const image of images) {
      expect(image.version).toBe(expected);
      expect(image.digest).toMatch(/^@sha256:[0-9a-f]{64}$/);
    }
    expect(new Set(images.map((i) => i.digest)).size).toBe(1);
  });

  it("pins the agent's playwright dependency exactly to the image version", () => {
    const agent = JSON.parse(read("packages/core/package.json")) as { dependencies: Record<string, string> };
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
