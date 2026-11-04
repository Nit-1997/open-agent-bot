import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const BASE = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble(@sha256:[0-9a-f]{64})?/g;

const imagesIn = (path: string) => [...read(path).matchAll(BASE)].map((m) => ({ version: m[1]!, digest: m[2] }));
const baseImages = () => imagesIn("packages/core/Dockerfile");

const recorded = Object.fromEntries(
  read("packages/core/test/deploy/playwright-node.txt")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Record<string, string>;

const NODE_GUARD = /RUN case "\$\(node -p process\.versions\.node\)" in 24\.\*\) ;; \*\) echo "[^"]*" >&2; exit 1 ;; esac/g;

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

  it("pins the digest recorded with its Node version, and that Node is 24", () => {
    expect(recorded.node).toMatch(/^24\.\d+\.\d+$/);
    expect(recorded.image).toBe(`mcr.microsoft.com/playwright:v${expected}-noble`);
    for (const image of baseImages()) expect(image.digest).toBe(`@${recorded.digest}`);
  });

  it("guards each Dockerfile stage with a Node 24 check right after its FROM", () => {
    const lines = read("packages/core/Dockerfile").split("\n");
    const froms = lines.flatMap((line, i) => (line.startsWith("FROM ") ? [i] : []));
    expect(froms.length).toBe(2);
    for (const i of froms) expect(lines.slice(i + 1, i + 3).some((l) => new RegExp(NODE_GUARD.source).test(l))).toBe(true);
  });

  it.each([".github/workflows/ci.yml", "CONTRIBUTING.md"])(
    "pins the Node 24 test image in %s to the Dockerfile's tag and digest",
    (path) => {
      const [base] = baseImages();
      const images = imagesIn(path);
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) expect(image).toEqual(base);
    },
  );

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
