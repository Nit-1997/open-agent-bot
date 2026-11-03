import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forbiddenEnv, rendererStartup } from "../../src/renderer/server.js";

const SECRET = "c".repeat(64);

let root: string;
let file: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "oa-renderer-")));
  mkdirSync(join(root, "renderer"), { mode: 0o700 });
  file = join(root, "renderer", "secret");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeSecret = (content: string, mode = 0o600) => {
  writeFileSync(file, content, { mode });
  chmodSync(file, mode);
};

describe("rendererStartup", () => {
  it("starts with only RENDERER_SECRET_FILE pointing at a valid 0600 file", () => {
    writeSecret(`${SECRET}\n`);
    expect(rendererStartup({ RENDERER_SECRET_FILE: file, PATH: "/bin" })).toEqual({ ok: true, secret: SECRET });
  });

  it("refuses when both RENDERER_SECRET and RENDERER_SECRET_FILE are set", () => {
    writeSecret(`${SECRET}\n`);
    const out = rendererStartup({ RENDERER_SECRET: SECRET, RENDERER_SECRET_FILE: file });
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/either RENDERER_SECRET or RENDERER_SECRET_FILE/) });
  });

  it("refuses a group-readable secret file", () => {
    writeSecret(`${SECRET}\n`, 0o640);
    const out = rendererStartup({ RENDERER_SECRET_FILE: file });
    expect(out).toEqual({ ok: false, message: expect.stringContaining(`chmod 600 ${file}`) });
  });

  it.each([
    ["short", "abc\n"],
    ["uppercase", `${"C".repeat(64)}\n`],
    ["empty", ""],
    ["prefixed", `RENDERER_SECRET=${SECRET}\n`],
  ])("refuses malformed file content: %s", (_name, content) => {
    writeSecret(content);
    const out = rendererStartup({ RENDERER_SECRET_FILE: file });
    expect(out).toEqual({ ok: false, message: expect.stringMatching(/malformed/) });
    if (!out.ok) expect(out.message).not.toMatch(/c{64}|C{64}/);
  });

  it("refuses a missing file and a symlinked file", () => {
    expect(rendererStartup({ RENDERER_SECRET_FILE: file })).toMatchObject({ ok: false, message: expect.stringContaining(file) });
    writeFileSync(join(root, "real"), `${SECRET}\n`, { mode: 0o600 });
    symlinkSync(join(root, "real"), file);
    expect(rendererStartup({ RENDERER_SECRET_FILE: file })).toMatchObject({ ok: false, message: expect.stringMatching(/symlink/) });
  });

  it("still refuses any other secret-like env next to RENDERER_SECRET_FILE", () => {
    writeSecret(`${SECRET}\n`);
    const out = rendererStartup({ RENDERER_SECRET_FILE: file, OPENAI_API_KEY: "sk-x" });
    expect(out).toEqual({ ok: false, message: expect.stringContaining("OPENAI_API_KEY") });
  });

  it("keeps hosted's RENDERER_SECRET path unchanged", () => {
    expect(rendererStartup({ RENDERER_SECRET: SECRET, PATH: "/bin" })).toEqual({ ok: true, secret: SECRET });
    expect(rendererStartup({ RENDERER_SECRET: ` ${SECRET} ` })).toEqual({ ok: true, secret: SECRET });
    expect(rendererStartup({ RENDERER_SECRET: "abc" })).toEqual({ ok: false, message: "RENDERER_SECRET must be 64 hex characters" });
    expect(rendererStartup({})).toEqual({ ok: false, message: "RENDERER_SECRET must be 64 hex characters" });
    expect(rendererStartup({ RENDERER_SECRET: SECRET, CREDENTIAL_KEYS: "v1:x" })).toEqual({
      ok: false,
      message: "refusing to start: the renderer must hold no other secrets (CREDENTIAL_KEYS)",
    });
  });
});

describe("forbiddenEnv", () => {
  it("exempts exactly RENDERER_SECRET and RENDERER_SECRET_FILE", () => {
    expect(forbiddenEnv({ RENDERER_SECRET: SECRET, RENDERER_SECRET_FILE: "/x", PATH: "/bin" })).toEqual([]);
    expect(forbiddenEnv({ RENDERER_SECRET_FILES: "/x", RENDERER_SECRET_FILE_2: "/y", MY_RENDERER_SECRET_FILE: "/z" })).toEqual([
      "MY_RENDERER_SECRET_FILE",
      "RENDERER_SECRET_FILES",
      "RENDERER_SECRET_FILE_2",
    ]);
    expect(forbiddenEnv({ RENDERER_SECRET_FILE: "/x", OPENAI_API_KEY: "sk-x" })).toEqual(["OPENAI_API_KEY"]);
  });
});
