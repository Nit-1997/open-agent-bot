import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { envFrom } from "./env.ts";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "oab-e2e-env-file-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("envFrom", () => {
  it("reads process env first, then the file named by E2E_ENV_FILE", () => {
    const path = file(".env-e2e", 'E2E_OPENROUTER_KEY="from-file"\nOTHER=file-only\n');
    const env = envFrom({ E2E_ENV_FILE: path, E2E_OPENROUTER_KEY: "from-env" });
    assert.equal(env("E2E_OPENROUTER_KEY"), "from-env");
    assert.equal(env("OTHER"), "file-only");
  });

  it("never takes APP_ORIGIN or the live opt-in from the file", () => {
    const path = file("live", "APP_ORIGIN=https://app.localhost\nE2E_ALLOW_LIVE=1\n");
    const env = envFrom({ E2E_ENV_FILE: path });
    assert.equal(env("APP_ORIGIN", true), "");
    assert.equal(env("E2E_ALLOW_LIVE", true), "");
  });

  it("reads only process env without E2E_ENV_FILE and names the variable when a value is missing", () => {
    const env = envFrom({ PRESENT: " v " });
    assert.equal(env("PRESENT"), "v");
    assert.equal(env("E2E_OPENROUTER_KEY", true), "");
    assert.throws(
      () => env("E2E_OPENROUTER_KEY"),
      (e: Error) => /E2E_OPENROUTER_KEY/.test(e.message) && /E2E_ENV_FILE/.test(e.message) && !/deploy-config/.test(e.message),
    );
  });

  it("refuses an E2E_ENV_FILE that does not exist", () => {
    const env = envFrom({ E2E_ENV_FILE: join(dir, "missing") });
    assert.throws(() => env("ANY", true), /E2E_ENV_FILE/);
  });

  it("never names deploy-config/", () => {
    assert.doesNotMatch(readFileSync(join(E2E, "support/env.ts"), "utf8"), /deploy-config/);
  });
});

describe("hosted env split", () => {
  const walk = (at: string): string[] =>
    readdirSync(at, { withFileTypes: true }).flatMap((d) => {
      if (["node_modules", ".auth", "test-results", "playwright-report", ".local"].includes(d.name)) return [];
      const path = join(at, d.name);
      return d.isDirectory() ? walk(path) : /\.(ts|mts|mjs)$/.test(d.name) ? [relative(E2E, path)] : [];
    });
  const importsHostedEnv = (path: string) => /from\s+["'][^"']*hostedEnv(\.ts)?["']/.test(readFileSync(join(E2E, path), "utf8"));
  const LOCAL =
    /^(local|desktop)\/|^playwright\.(local|desktop)\.config\.ts$|^support\/(env|localStack|stubModel|origin|onboarding)(\.test)?\.ts$|^scripts\/local-probes/;

  it("no local or desktop file imports hostedEnv", () => {
    assert.deepEqual(
      walk(E2E).filter((path) => LOCAL.test(path) && importsHostedEnv(path)),
      [],
    );
  });

  it("holds only local and desktop files", () => {
    assert.deepEqual(
      walk(E2E).filter((path) => !LOCAL.test(path) && path !== "support/cloudImports.test.ts"),
      [],
    );
  });
});
