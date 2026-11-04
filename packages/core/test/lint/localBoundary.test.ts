import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { biomeFixtures } from "./biomeFixture.js";
import { readSourceTree, type SourceTree } from "./boundary.js";
import { type LocalRule, localViolations, withAppended } from "./localRules.js";

const SRC = join(import.meta.dirname, "../../src");
const SQLITE_MESSAGE = "node:sqlite is used only inside src/local/store.";
const LOCAL_ONLY_MESSAGE = "Only src/local may import local modules.";

describe("local store boundary rules on fixture trees", () => {
  it.each<[LocalRule, SourceTree, string]>([
    ["B8", { "http/chats.ts": 'import "node:sqlite";\n' }, "node:sqlite"],
    ["B8", { "local/main.ts": 'import { DatabaseSync } from "node:sqlite";\n' }, "node:sqlite"],
    ["B8", { "lib/x.ts": 'export const f = () => import("node:sqlite");\n' }, "node:sqlite"],
    ["B7", { "hosted/deps.ts": 'import "@oab/core/local/store/sqliteStore.js";\n' }, "@oab/core/local/store/sqliteStore.js"],
    ["B7", { "hosted/x.ts": 'import "../local/keyFiles.js";\n' }, "../local/keyFiles.js"],
    ["B7", { "hosted/x.ts": 'import "node:sqlite";\n' }, "node:sqlite"],
    ["B9", { "renderer/server.ts": 'import "../local/keyFiles.js";\n' }, "../local/keyFiles.js"],
    ["B9", { "server.ts": 'import "./local/start.js";\n' }, "./local/start.js"],
    ["B9", { "lib/x.ts": 'import "@oab/core/local/refusal.js";\n' }, "@oab/core/local/refusal.js"],
  ])("%s blocks %j", (rule, tree, specifier) => {
    const [file] = Object.keys(tree);
    expect(localViolations(tree)).toContainEqual({ rule, file, specifier });
  });

  it.each<[string, SourceTree]>([
    ["the store using node:sqlite", { "local/store/sqliteStore.ts": 'import { DatabaseSync } from "node:sqlite";\n' }],
    ["core using the local store", { "local/main.ts": 'import "./store/sqliteStore.js";\n' }],
    ["local using shared lib code", { "local/keyFiles.ts": 'import "../lib/secretFile.js";\n' }],
    ["the renderer using the shared secret file reader", { "renderer/server.ts": 'import "../lib/secretFile.js";\n' }],
    ["hosted names that only start like local", { "hosted/x.ts": 'import "@oab/core/localeTools.js";\n' }],
  ])("allows %s", (_name, tree) => {
    expect(localViolations(tree)).toEqual([]);
  });
});

describe("local store boundary on src/", () => {
  const tree = readSourceTree(SRC);

  it("has the store and no B7/B8/B9 violations", () => {
    expect(Object.keys(tree).filter((f) => f.startsWith("local/store/")).length).toBeGreaterThan(3);
    expect(localViolations(tree)).toEqual([]);
  });

  it("flags injected imports in real files without changing them", () => {
    const before = { chats: readFileSync(join(SRC, "http/chats.ts"), "utf8") };
    expect(localViolations(withAppended(tree, "http/chats.ts", 'import "node:sqlite";\n'))).toEqual([
      { rule: "B8", file: "http/chats.ts", specifier: "node:sqlite" },
    ]);
    expect(readFileSync(join(SRC, "http/chats.ts"), "utf8")).toBe(before.chats);
  });
});

describe("Biome enforces B7, B8 and B9", () => {
  const { lint, dispose } = biomeFixtures("local-boundary-");
  afterAll(dispose);
  const real = (file: string) => readFileSync(join(SRC, file), "utf8");

  it.each([
    ["src/http/chats.ts", 'import "node:sqlite";\n', SQLITE_MESSAGE],
    ["src/local/main.ts", 'import { DatabaseSync } from "node:sqlite";\nexport default DatabaseSync;\n', SQLITE_MESSAGE],
    ["src/hosted/deps.ts", 'import "@oab/core/local/store/sqliteStore.js";\n', LOCAL_ONLY_MESSAGE],
    ["src/hosted/x.ts", 'import { DatabaseSync } from "node:sqlite";\nexport default DatabaseSync;\n', SQLITE_MESSAGE],
    ["src/renderer/server.ts", 'import { refuse } from "../local/refusal.js";\nexport default refuse;\n', LOCAL_ONLY_MESSAGE],
    ["src/server.ts", 'import { startLocal } from "./local/start.js";\nexport default startLocal;\n', LOCAL_ONLY_MESSAGE],
  ])("blocks %s: %s", (file, code, message) => {
    const r = lint("core", file, code);
    expect(r.out).toContain(message);
    expect(r.status).not.toBe(0);
  });

  it("fails lint on the real files with an injected import", () => {
    const chats = lint("core", "src/http/chats.ts", `${real("http/chats.ts")}import "node:sqlite";\n`);
    expect(chats.out).toContain(SQLITE_MESSAGE);
    expect(chats.status).not.toBe(0);
  });

  it("allows node:sqlite inside src/local/store and the store from core", () => {
    for (const [file, code] of [
      ["src/local/store/db.ts", 'import { DatabaseSync } from "node:sqlite";\nexport default DatabaseSync;\n'],
      ["src/local/main.ts", 'import { openSqliteStore } from "./store/sqliteStore.js";\nexport default openSqliteStore;\n'],
    ] as const) {
      const r = lint("core", file, code);
      expect(r.out).not.toContain("noRestrictedImports");
      expect(r.status).toBe(0);
    }
  });

  it("still blocks hosted and cloud imports inside src/local/store", () => {
    const hosted = lint("core", "src/local/store/x.ts", 'import x from "../../hosted/store/client.js";\nexport default x;\n');
    expect(hosted.out).toContain("Core must not import hosted implementations.");
    const cloud = lint("core", "src/local/store/x.ts", 'import x from "../../../cloud/x.ts";\nexport default x;\n');
    expect(cloud.out).toContain("Nothing outside cloud/ may import from cloud/.");
  });
});
