import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fakeAuthConfig, fakeDatabase, REF, startFakeManagementApi } from "./fixtures/fakeManagementApi.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../scripts/configure-auth.mjs");

let legal;
let api;

before(() => {
  legal = mkdtempSync(join(tmpdir(), "oab-legal-"));
  writeFileSync(join(legal, "terms.md"), "# Terms\n\nApproved.\n");
  writeFileSync(join(legal, "privacy.md"), "# Privacy\n\nApproved.\n");
});
after(() => rmSync(legal, { recursive: true, force: true }));
afterEach(async () => {
  await api?.close();
  api = undefined;
});

function run(args, { mode, legalDir = legal } = {}) {
  const env = {
    PATH: process.env.PATH,
    SUPABASE_PROJECT_REF: REF,
    SUPABASE_ACCESS_TOKEN: "sbp_fake_token",
    SITE_URL: "https://app.example",
    GOOGLE_CLIENT_ID: "fake-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "fake-google-secret",
    RESEND_API_KEY: "re_fake",
    SMTP_SENDER_EMAIL: "noreply@example.test",
    ...(mode && { SIGNUP_MODE: mode }),
  };
  const child = spawn(process.execPath, [SCRIPT, ...args, "--api-base", api.base, "--legal-dir", legalDir], { env });
  let out = "";
  child.stdout.on("data", (d) => {
    out += d;
  });
  child.stderr.on("data", (d) => {
    out += d;
  });
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

const synced = (over = {}) => fakeAuthConfig(over);

async function inSync(mode, dbOver = {}, authOver = {}) {
  api = await startFakeManagementApi({ db: fakeDatabase({ mode, ...dbOver }), auth: synced(authOver) });
  const r = await run(["--apply"], { mode: mode === "open" ? "waitlist" : mode });
  assert.equal(r.code, 0, r.out);
  api.state.db.mode = mode;
  api.state.auth.disable_signup = mode !== "open";
  api.state.log.length = 0;
}

describe("configure-auth.mjs against a fake Management API", () => {
  it("refuses an --api-base that isn't 127.0.0.1 on a factory port, and --legal-dir without it", () => {
    for (const base of ["https://api.supabase.com/v1", "http://127.0.0.1:5432/v1", "http://localhost:18730/v1", "http://127.0.0.1:18730"]) {
      const r = spawnSync(process.execPath, [SCRIPT, "--check", "--api-base", base], { env: { PATH: process.env.PATH }, encoding: "utf8" });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /--api-base accepts only http:\/\/127\.0\.0\.1:<18700-18749>\/v1/);
    }
    const r = spawnSync(process.execPath, [SCRIPT, "--check", "--legal-dir", "/tmp"], {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--legal-dir is accepted only with --api-base/);
  });

  it("refuses an unknown SIGNUP_MODE", async () => {
    api = await startFakeManagementApi();
    const r = await run(["--check"], { mode: "everyone" });
    assert.equal(r.code, 1);
    assert.match(r.out, /SIGNUP_MODE must be one of invite, waitlist, open/);
  });

  it("--check reports the mode row drift and passes once it matches (default waitlist)", async () => {
    await inSync("waitlist");
    let r = await run(["--check"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /signup mode: waitlist, no drift/);
    api.state.db.mode = "invite";
    r = await run(["--check"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /drift: signup mode invite → waitlist/);
  });

  it("--check in open reports disable_signup, the row and every provider other than Google and email, plus SAML", async () => {
    await inSync("waitlist", {}, { external_github_enabled: true, external_phone_enabled: true, saml_enabled: true });
    api.state.auth.external_github_enabled = true;
    api.state.auth.saml_enabled = true;
    const r = await run(["--check"], { mode: "open" });
    assert.equal(r.code, 1);
    assert.match(r.out, /disable_signup: true → false/);
    assert.match(r.out, /drift: signup mode waitlist → open/);
    assert.match(r.out, /drift: provider github is on/);
    assert.match(r.out, /drift: SAML is on/);
    assert.doesNotMatch(r.out, /provider (google|email) is on/);
  });

  it("notes a pre-M7 database (no signup_settings) in waitlist without failing the check", async () => {
    await inSync("waitlist");
    api.state.db.settingsRows = 0;
    const r = await run(["--check"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /public\.signup_settings missing \(pre-M7 database/);
  });

  const preconditions = [
    ["(a)", { m7Functions: false }, /\(a\) the M7 usage functions are missing/],
    ["(b)", { settingsRows: 0 }, /\(b\) public\.signup_settings is missing/],
    ["(c)", { hookVersion: null }, /\(c\) private\.before_user_created isn't the oab:m7-signup-modes:v1 hook/],
    ["(d)", { blockedDomains: 999 }, /\(d\) blocked_email_domains holds 999 rows, fewer than 1000/],
  ];
  for (const [label, dbOver, message] of preconditions)
    it(`--apply open refuses without precondition ${label} and writes nothing`, async () => {
      await inSync("waitlist");
      Object.assign(api.state.db, dbOver);
      const r = await run(["--apply", "--i-confirm-open-signups"], { mode: "open" });
      assert.equal(r.code, 1);
      assert.match(r.out, /refusing to open signups/);
      assert.match(r.out, message);
      assert.deepEqual(api.state.log, []);
      assert.equal(api.state.auth.disable_signup, true);
    });

  it("--apply open refuses while Terms or Privacy is missing or still a draft (e)", async () => {
    await inSync("waitlist");
    const draft = mkdtempSync(join(tmpdir(), "oab-legal-draft-"));
    try {
      writeFileSync(join(draft, "terms.md"), "<!-- DRAFT-NOT-REVIEWED -->\n# Terms\n");
      let r = await run(["--apply", "--i-confirm-open-signups"], { mode: "open", legalDir: draft });
      assert.equal(r.code, 1);
      assert.match(r.out, /\(e\) cloud\/web\/content\/terms\.md is still marked DRAFT-NOT-REVIEWED/);
      assert.match(r.out, /\(e\) cloud\/web\/content\/privacy\.md is missing/);
      writeFileSync(join(draft, "privacy.md"), "# Privacy\n");
      writeFileSync(join(draft, "terms.md"), "# Terms\n");
      r = await run(["--apply", "--i-confirm-open-signups"], { mode: "open", legalDir: draft });
      assert.equal(r.code, 0, r.out);
    } finally {
      rmSync(draft, { recursive: true, force: true });
    }
  });

  it("--apply open refuses without --i-confirm-open-signups (f)", async () => {
    await inSync("waitlist");
    const r = await run(["--apply"], { mode: "open" });
    assert.equal(r.code, 1);
    assert.match(r.out, /\(f\) pass --i-confirm-open-signups/);
    assert.deepEqual(api.state.log, []);
  });

  it("--apply open refuses while another provider or SAML is on", async () => {
    await inSync("waitlist");
    api.state.auth.external_apple_enabled = true;
    api.state.auth.saml_enabled = true;
    const r = await run(["--apply", "--i-confirm-open-signups"], { mode: "open" });
    assert.equal(r.code, 1);
    assert.match(r.out, /provider apple is on/);
    assert.match(r.out, /SAML is on/);
    assert.deepEqual(api.state.log, []);
  });

  it("--apply open writes the mode row before disable_signup:false", async () => {
    await inSync("waitlist");
    const r = await run(["--apply", "--i-confirm-open-signups"], { mode: "open" });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(api.state.log, ["SQL update mode=open", "PATCH auth disable_signup disable_signup=false"]);
    assert.equal((await run(["--check"], { mode: "open" })).code, 0);
  });

  it("--apply waitlist (closing) writes disable_signup:true before the mode row", async () => {
    await inSync("open");
    const r = await run(["--apply"], { mode: "waitlist" });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(api.state.log, ["PATCH auth disable_signup disable_signup=true", "SQL update mode=waitlist"]);
  });

  it("--apply invite from waitlist only writes the row (signups stay closed)", async () => {
    await inSync("waitlist");
    const r = await run(["--apply"], { mode: "invite" });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(api.state.log, ["SQL update mode=invite"]);
  });

  it("sends every request to the fake API only", async () => {
    await inSync("waitlist");
    await run(["--apply", "--i-confirm-open-signups"], { mode: "open" });
    assert.deepEqual([...api.state.hosts], [new URL(api.base).host]);
  });
});
