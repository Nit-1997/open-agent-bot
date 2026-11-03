import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCKERFILE = readFileSync(join(import.meta.dirname, "../../Dockerfile"), "utf8");
const LINES = DOCKERFILE.split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

type Stage = { from: string; name: string | undefined; lines: string[] };

function stages(): Stage[] {
  const out: Stage[] = [];
  for (const line of LINES) {
    const from = /^FROM\s+(.+?)(?:\s+AS\s+(\S+))?$/i.exec(line);
    if (from) out.push({ from: from[1], name: from[2], lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out;
}

const final = () => stages().at(-1) as Stage;
const ui = () => stages().find((s) => s.name === "ui");
const indexIn = (s: Stage, test: (l: string) => boolean) => s.lines.findIndex(test);

describe("agent image layout", () => {
  it("builds the local UI in a ui stage on the build platform", () => {
    const stage = ui();
    expect(stage, "a stage named ui").toBeDefined();
    expect(stage?.from.startsWith("--platform=$BUILDPLATFORM ")).toBe(true);
    expect(stage?.lines).toContain("RUN npm ci -w @oab/local-web -w @oab/ui -w @oab/shared --include-workspace-root");
    expect(stage?.lines.some((l) => /^RUN npm run build -w @oab\/local-web\b/.test(l))).toBe(true);
  });

  it("runs the final stage on the target platform", () => {
    expect(final().from).not.toContain("--platform");
    expect(final().name).toBeUndefined();
  });

  it("copies the local-web build into the final image", () => {
    expect(final().lines).toContain("COPY --from=ui /app/packages/local-web/dist packages/local-web/dist");
  });

  it("installs and builds @oab/bff for the local front", () => {
    const s = final();
    expect(s.lines).toContain("RUN npm ci -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root");
    expect(s.lines).toContain("COPY packages/bff/src packages/bff/src");
    expect(s.lines.some((l) => l.startsWith("RUN npm run build -w @oab/core") && l.includes("-w @oab/bff"))).toBe(true);
  });

  it("creates /data, /keys and /run/open-agent/renderer for pwuser with mode 0700 before switching user", () => {
    const s = final();
    const dirs = "/data /keys /run/open-agent/renderer";
    const run = indexIn(s, (l) => l === `RUN mkdir -p ${dirs} && chown pwuser:pwuser ${dirs} && chmod 700 ${dirs}`);
    expect(run).toBeGreaterThan(-1);
    expect(run).toBeLessThan(indexIn(s, (l) => l === "USER pwuser"));
  });

  it("carries the OCI labels with build-arg version and revision", () => {
    const s = final();
    expect(s.lines).toContain("ARG OPEN_AGENT_VERSION=dev");
    expect(s.lines).toContain("ARG OPEN_AGENT_REVISION=unknown");
    const labels = DOCKERFILE.slice(DOCKERFILE.lastIndexOf("LABEL "));
    for (const key of ["source", "version", "revision", "licenses", "title"]) expect(labels).toContain(`org.opencontainers.image.${key}=`);
    expect(labels).toContain('org.opencontainers.image.licenses="MIT"');
    expect(labels).toContain(`org.opencontainers.image.version="$\{OPEN_AGENT_VERSION}"`);
    expect(labels).toContain(`org.opencontainers.image.revision="$\{OPEN_AGENT_REVISION}"`);
  });

  it("turns CopilotKit telemetry off and keeps the hosted command", () => {
    const s = final();
    expect(s.lines).toContain("ENV COPILOTKIT_TELEMETRY_DISABLED=true");
    expect(s.lines.filter((l) => l.startsWith("CMD "))).toEqual(['CMD ["node", "dist/server.js"]']);
    expect(s.lines.at(-1)).toBe('CMD ["node", "dist/server.js"]');
  });

  it("takes no secret build args", () => {
    const args = LINES.filter((l) => l.startsWith("ARG ")).map((l) => l.slice(4).split("=")[0]);
    expect(args.filter((a) => /SECRET|KEY|TOKEN|PASSWORD/i.test(a))).toEqual([]);
  });
});
