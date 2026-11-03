import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../../src/", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("database access", () => {
  it("creates Supabase clients only inside src/hosted/store and the two entry points", () => {
    const allowed = new Set(["server.ts", "scripts/rotateCredentials.ts"]);
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !f.startsWith("hosted/store/") && !allowed.has(f))
      .filter((f) => /^import (?!type )[^;]*store\/client\.js["']/m.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("never reaches Supabase tables from outside the repositories", () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !f.startsWith("hosted/store/") && !f.startsWith("hosted/admin/authAdmin"))
      .filter((f) =>
        /\.from\(["'](profiles|chats|chat_messages|artifacts|provider_settings|provider_credentials|access_requests|invited_emails)["']\)/.test(
          readFileSync(join(SRC, f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("never touches the retired workspace table or its functions", () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => /workspace_entities|workspace_put|workspace_counts/.test(readFileSync(join(SRC, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
