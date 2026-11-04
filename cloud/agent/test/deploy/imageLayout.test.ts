import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;
const DOCKERFILE = read("cloud/agent/Dockerfile");
const LINES = DOCKERFILE.split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

function workspaceDirs(): string[] {
  return json<{ workspaces: string[] }>("package.json").workspaces.flatMap((glob) => {
    if (!glob.endsWith("/*")) return [glob];
    const parent = glob.slice(0, -2);
    return readdirSync(join(ROOT, parent), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ROOT, parent, d.name, "package.json")))
      .map((d) => `${parent}/${d.name}`);
  });
}

describe("hosted agent image (cloud/agent/Dockerfile)", () => {
  it("is one stage on the pinned Playwright base with the Node 24 guard", () => {
    const froms = LINES.filter((l) => l.startsWith("FROM "));
    expect(froms).toHaveLength(1);
    expect(froms[0]).toMatch(/^FROM mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/);
    expect(LINES[1]).toContain('case "$(node -p process.versions.node)" in 24.*)');
    expect(LINES).toContain("ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1");
  });

  it("copies every workspace package.json, cloud ones included, before npm ci", () => {
    const dirs = workspaceDirs();
    expect(dirs).toEqual(expect.arrayContaining(["packages/core", "cloud/agent"]));
    const ci = DOCKERFILE.indexOf("RUN npm ci");
    for (const dir of dirs) {
      const copy = DOCKERFILE.indexOf(`COPY ${dir}/package.json ${dir}/`);
      expect(copy, `cloud/agent/Dockerfile must copy ${dir}/package.json`).toBeGreaterThan(-1);
      expect(copy).toBeLessThan(ci);
    }
  });

  it("installs, checks the pi-ai patch, builds the hosted agent and prunes dev dependencies", () => {
    expect(LINES).toContain("RUN npm ci -w @oab/cloud-agent -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root");
    expect(LINES).toContain('RUN grep -q "closeAllConnections() { }" node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js');
    for (const src of ["packages/shared/src", "packages/bff/src", "packages/core/src", "packages/core/skills", "cloud/agent/src"])
      expect(LINES).toContain(`COPY ${src} ${src}`);
    expect(LINES).toContain(
      "RUN npm run build -w @oab/cloud-agent && npm prune --omit=dev -w @oab/cloud-agent -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root",
    );
    expect(DOCKERFILE).not.toContain("local-web/dist");
  });

  it("runs as pwuser from /app/cloud/agent with telemetry off and the hosted command", () => {
    const tail = LINES.slice(LINES.indexOf("USER pwuser"));
    expect(tail).toEqual([
      "USER pwuser",
      "ENV NODE_ENV=production",
      "ENV COPILOTKIT_TELEMETRY_DISABLED=true",
      "WORKDIR /app/cloud/agent",
      "EXPOSE 8000",
      'CMD ["node", "dist/server.js"]',
    ]);
  });

  it("takes no build args", () => {
    expect(LINES.filter((l) => l.startsWith("ARG "))).toEqual([]);
  });

  it("is the image the hosted compose file builds for the agent, and the lockfile knows the workspace", () => {
    expect(read("cloud/deploy/compose.hosted.yml")).toMatch(
      /^ {2}agent:\n {4}build:\n {6}context: \.\.\/\.\.\n {6}dockerfile: cloud\/agent\/Dockerfile$/m,
    );
    expect(json<{ packages: Record<string, { name?: string }> }>("package-lock.json").packages["cloud/agent"]?.name).toBe(
      "@oab/cloud-agent",
    );
  });

  it("points typebox paths at files that exist", () => {
    const { compilerOptions } = json<{ compilerOptions: { paths: Record<string, string[]> } }>("cloud/agent/tsconfig.json");
    const targets = Object.entries(compilerOptions.paths)
      .filter(([key]) => key.startsWith("typebox"))
      .flatMap(([, values]) => values);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(join(ROOT, "cloud/agent", target)), target).toBe(true);
  });
});
