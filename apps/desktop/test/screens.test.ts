import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellAction } from "../src/shared/actions.ts";
import { buildManifest, resolveScreenRequest, SHELL_CSP, validateAction } from "../src/main/screens.ts";

describe("SHELL_CSP", () => {
  it("is the D6 policy, exactly", () => {
    expect(SHELL_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
  });
});

describe("screen manifest", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oab-screens-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html>");
    writeFileSync(join(dir, "screens.js"), "1");
    writeFileSync(join(dir, "screens.css"), "a{}");
    writeFileSync(join(dir, "notes.txt"), "x");
    mkdirSync(join(dir, "img"));
    writeFileSync(join(dir, "img/logo.svg"), "<svg/>");
    writeFileSync(join(dir, "outside.html"), "secret");
    symlinkSync(join(dir, "outside.html"), join(dir, "link.html"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("holds only the screen file types, read once, symlinks skipped", () => {
    const m = buildManifest(dir);
    expect([...m.keys()].sort()).toEqual(["/img/logo.svg", "/index.html", "/outside.html", "/screens.css", "/screens.js"]);
  });

  it("serves a known file with the CSP, nosniff and no-store", () => {
    const r = resolveScreenRequest(buildManifest(dir), "oa-shell://screens/index.html");
    expect(r.status).toBe(200);
    expect(r.headers).toEqual({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": SHELL_CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    expect(Buffer.from(r.body).toString()).toBe("<!doctype html>");
    expect(resolveScreenRequest(buildManifest(dir), "oa-shell://screens/screens.js").headers["content-type"]).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(resolveScreenRequest(buildManifest(dir), "oa-shell://screens/screens.css").headers["content-type"]).toBe(
      "text/css; charset=utf-8",
    );
  });

  const notFound = [
    "oa-shell://screens/../index.html",
    "oa-shell://screens/%2e%2e/index.html",
    "oa-shell://screens/..%2findex.html",
    "oa-shell://screens/img/../index.html",
    "oa-shell://screens//index.html",
    "oa-shell://screens/notes.txt",
    "oa-shell://screens/link.html",
    "oa-shell://screens/",
    "oa-shell://screens/missing.html",
    "oa-shell://other/index.html",
    "oa-shell://screens/index.html?x=1",
    "http://screens/index.html",
    "not a url",
  ];
  for (const url of notFound) {
    it(`refuses ${url}`, () => {
      const r = resolveScreenRequest(buildManifest(dir), url);
      expect(r.status).toBe(404);
      expect(r.headers["content-security-policy"]).toBe(SHELL_CSP);
    });
  }
});

describe("validateAction (D7)", () => {
  const members: ShellAction[] = [
    { type: "retry" },
    { type: "quit" },
    { type: "openDockerApp", app: "docker-desktop" },
    { type: "openDockerApp", app: "orbstack" },
    ...(["get-docker-desktop", "get-orbstack", "get-colima", "install-guide", "github", "release-page", "startup-errors"] as const).map(
      (link) => ({ type: "openLink", link }) as const,
    ),
    { type: "useAppStack" },
    { type: "pickAnotherPort" },
    { type: "resetCredentials", confirm: "reset" },
    { type: "restartServices" },
    { type: "updateServices" },
    { type: "cancelPull" },
    { type: "setStopOnQuit", value: true },
    { type: "setStopOnQuit", value: false },
    { type: "setPort", port: 41100 },
    { type: "setCheckForUpdates", value: false },
    { type: "checkForUpdates" },
    { type: "downloadUpdate" },
    { type: "dismissUpdate" },
    { type: "moveToApplications" },
    { type: "keepHere" },
    { type: "showLogs" },
    { type: "saveLogs" },
    { type: "exportData" },
    { type: "deleteData", confirm: "delete" },
    { type: "closeServices" },
  ];
  for (const a of members) it(`accepts ${JSON.stringify(a)}`, () => expect(validateAction(structuredClone(a))).toEqual(a));

  const bad: unknown[] = [
    undefined,
    null,
    "quit",
    42,
    [],
    {},
    { type: "nope" },
    { type: "quit", extra: 1 },
    { type: "retry", type2: "x" },
    { type: "openDockerApp" },
    { type: "openDockerApp", app: "colima" },
    { type: "openLink", link: "https://evil.example/" },
    { type: "openLink", link: "github", url: "https://evil.example/" },
    { type: "resetCredentials" },
    { type: "resetCredentials", confirm: "RESET" },
    { type: "deleteData", confirm: "yes" },
    { type: "deleteData" },
    { type: "setStopOnQuit", value: "true" },
    { type: "setStopOnQuit" },
    { type: "setPort", port: "41100" },
    { type: "setPort", port: 1023 },
    { type: "setPort", port: 65536 },
    { type: "setPort", port: 41100.5 },
    { type: "setPort", port: Number.NaN },
    { type: "setCheckForUpdates", value: 1 },
    { type: "toString" },
    { type: "__proto__" },
    Object.assign(Object.create({ type: "quit" }), {}),
  ];
  for (const v of bad) it(`refuses ${JSON.stringify(v) ?? String(v)}`, () => expect(validateAction(v)).toBeUndefined());
});
