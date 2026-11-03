import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideRoute, type RouteDecision } from "@/lib/routeRules";

type Row = { file: string; url: string; signedOut: string; user: string; admin: string };

const APP = resolve(__dirname, "../../app");
const TABLE = resolve(__dirname, "../fixtures/route-inventory.json");
const ENTRY = /^(page\.(tsx|ts|jsx|js)|route\.(ts|js))$/;

const sessions = {
  signedOut: { user: null, unavailable: false },
  user: { user: { id: "u1", email: "a@b.c", name: "", isAdmin: false }, unavailable: false },
  admin: { user: { id: "u2", email: "admin@b.c", name: "", isAdmin: true }, unavailable: false },
} as const;

function entries(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return entries(path);
    return ENTRY.test(d.name) ? [relative(APP, path)] : [];
  });
}

function patternFor(file: string): RegExp {
  const segments = file
    .split("/")
    .slice(0, -1)
    .filter((s) => !/^\(.+\)$/.test(s));
  const source = segments
    .map((s) => {
      if (/^\[\[\.\.\..+\]\]$/.test(s)) return "(?:/[^?#]+)?";
      if (/^\[\.\.\..+\]$/.test(s)) return "/[^?#]+";
      if (/^\[.+\]$/.test(s)) return "/[^/?#]+";
      return `/${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
    })
    .join("");
  return new RegExp(`^${source || "/"}$`);
}

const label = (d: RouteDecision) => (d.kind === "json" ? `json ${d.status}` : d.kind);

const table = JSON.parse(readFileSync(TABLE, "utf8")) as Row[];
const onDisk = entries(APP).sort();

describe("route inventory", () => {
  it("finds the app's pages and routes, including groups and catch-all segments", () => {
    expect(onDisk).toContain("(app)/[...missing]/page.tsx");
    expect(onDisk).toContain("api/copilotkit/[[...slug]]/route.ts");
    expect(onDisk.length).toBeGreaterThanOrEqual(28);
  });

  it("has a table row for every page and route under web/app, and no row for a missing file", () => {
    expect([...new Set(table.map((r) => r.file))].sort()).toEqual(onDisk);
  });

  it("uses a sample URL that the file actually serves", () => {
    for (const row of table) expect(row.url, row.file).toMatch(patternFor(row.file));
  });

  it("decides every sample URL as the table says for signed-out users, users and admins", () => {
    for (const row of table) {
      for (const who of ["signedOut", "user", "admin"] as const) {
        expect(`${row.url} ${who} ${label(decideRoute(row.url, sessions[who]))}`).toBe(`${row.url} ${who} ${row[who]}`);
      }
    }
  });
});
