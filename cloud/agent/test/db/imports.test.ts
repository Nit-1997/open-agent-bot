import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_SRC, SRC } from "../fixtures/sourceTree.js";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const sources = () => [
  ...files(SRC).map((f) => ({ name: relative(SRC, f), text: readFileSync(f, "utf8") })),
  ...files(CORE_SRC).map((f) => ({ name: `core/${relative(CORE_SRC, f)}`, text: readFileSync(f, "utf8") })),
];

describe("database access", () => {
  it("creates Supabase clients only inside src/store, the hosted wiring and the rotation entry", () => {
    const allowed = new Set(["deps.ts", "scripts/rotateCredentials.ts"]);
    const offenders = sources()
      .filter((f) => !f.name.startsWith("store/") && !allowed.has(f.name))
      .filter((f) => /^import (?!type )[^;]*store\/client\.js["']/m.test(f.text))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("never reaches Supabase tables from outside the repositories", () => {
    const offenders = sources()
      .filter((f) => !f.name.startsWith("store/") && !f.name.startsWith("admin/authAdmin"))
      .filter((f) =>
        /\.from\(["'](profiles|chats|chat_messages|artifacts|provider_settings|provider_credentials|access_requests|invited_emails)["']\)/.test(
          f.text,
        ),
      )
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("never touches the retired workspace table or its functions", () => {
    const offenders = sources()
      .filter((f) => /workspace_entities|workspace_put|workspace_counts/.test(f.text))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("scans the hosted source and core's source", () => {
    const names = sources().map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["store/client.ts", "deps.ts", "scripts/rotateCredentials.ts", "core/startAgent.ts"]));
  });
});
