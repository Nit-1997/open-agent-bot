import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { anon, cleanup, closeHarness, connectAs, invite, localEnv, sql, testEmail, track } from "./harness.js";

const SUPABASE = resolve(import.meta.dirname, "../../../supabase");
const INVITE_ONLY = { error: { http_code: 403, message: "Open Agent is invite-only. Request access first." } };
const GOOGLE_ONLY = { error: { http_code: 403, message: "Create your account with Google." } };
const THROWAWAY = { error: { http_code: 403, message: "Use a permanent email address." } };
const PAUSED = { error: { http_code: 429, message: "Sign-ups are paused for a bit. Try again later." } };

type Settings = { mode: string; signups_per_hour: number; signups_per_day: number; signups_per_ip_day: number };
type HookEvent = { user: { email?: string; app_metadata?: { provider?: string } }; metadata?: { ip_address?: string } };

let saved: Settings;
let auth: pg.Client;

const event = (email: string, provider?: string, ip?: string): HookEvent => ({
  user: { email, ...(provider !== undefined && { app_metadata: { provider } }) },
  ...(ip && { metadata: { ip_address: ip } }),
});

async function setSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...saved, ...patch };
  await sql("update public.signup_settings set mode = $1, signups_per_hour = $2, signups_per_day = $3, signups_per_ip_day = $4 where id", [
    next.mode,
    next.signups_per_hour,
    next.signups_per_day,
    next.signups_per_ip_day,
  ]);
}

async function hookOn(client: pg.Client, e: HookEvent): Promise<unknown> {
  return (await client.query<{ r: unknown }>("select private.before_user_created($1::jsonb) as r", [JSON.stringify(e)])).rows[0]!.r;
}

async function inRolledBack<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

const hook = (e: HookEvent) => inRolledBack(auth, () => hookOn(auth, e));

const recent = async (interval: string) =>
  Number((await sql<{ n: string }>(`select count(*) as n from private.signups where at > now() - interval '${interval}'`))[0]!.n);

beforeAll(async () => {
  [saved] = await sql<Settings>("select mode, signups_per_hour, signups_per_day, signups_per_ip_day from public.signup_settings where id");
  auth = await connectAs("supabase_auth_admin");
});

afterEach(async () => {
  await setSettings({});
});

afterAll(async () => {
  try {
    await auth?.end();
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

describe("signup modes migration", () => {
  it("ships one settings row in waitlist with the 20/h, 100/day, 3/IP/day caps", async () => {
    expect(await sql("select mode, signups_per_hour, signups_per_day, signups_per_ip_day from public.signup_settings")).toEqual([
      { mode: "waitlist", signups_per_hour: 20, signups_per_day: 100, signups_per_ip_day: 3 },
    ]);
    await expect(sql("insert into public.signup_settings (id) values (false)")).rejects.toThrow();
    await expect(sql("update public.signup_settings set mode = 'everyone'")).rejects.toThrow();
  });

  it("marks the hook with its version comment and makes it volatile", async () => {
    expect(
      await sql(
        "select obj_description('private.before_user_created(jsonb)'::regprocedure, 'pg_proc') as v, provolatile from pg_proc where oid = 'private.before_user_created(jsonb)'::regprocedure",
      ),
    ).toEqual([{ v: "oab:m7-signup-modes:v1", provolatile: "v" }]);
  });

  it("lets supabase_auth_admin read the settings, the domains, the invites and the pepper, and write the signup log", async () => {
    await inRolledBack(auth, async () => {
      expect((await auth.query("select mode from public.signup_settings")).rows).toEqual([{ mode: "waitlist" }]);
      await auth.query("select count(*) from public.blocked_email_domains");
      await auth.query("select count(*) from public.invited_emails");
      expect((await auth.query("select octet_length(pepper) as n from private.signup_pepper")).rows).toEqual([{ n: 32 }]);
      await auth.query("insert into private.signups (ip_hash) values (null)");
      await auth.query("delete from private.signups where ip_hash is null and at = now()");
      await expect(auth.query("update public.signup_settings set mode = 'open'")).rejects.toThrow(/permission denied/);
    });
  });

  it("keeps the tables and the stats away from the API roles; only service_role reaches the two functions", async () => {
    const pub = anon();
    for (const table of ["signup_settings", "blocked_email_domains"]) {
      const { data, error } = await pub.from(table).select("*");
      expect(error?.code ?? (data?.length === 0 ? "empty" : "rows"), table).not.toBe("rows");
    }
    for (const fn of ["signup_settings_get", "signup_stats"]) {
      const { error } = await pub.rpc(fn);
      expect(error, fn).not.toBeNull();
    }
    const service = (await import("@supabase/supabase-js")).createClient(localEnv().apiUrl, localEnv().secretKey, {
      auth: { persistSession: false },
    });
    expect((await service.rpc("signup_settings_get")).data).toEqual([
      { mode: "waitlist", signups_per_hour: 20, signups_per_day: 100, signups_per_ip_day: 3 },
    ]);
    const stats = await service.rpc("signup_stats");
    expect(stats.error).toBeNull();
    expect(stats.data[0]).toMatchObject({ cap_hour: 20, cap_day: 100 });
    for (const table of ["signup_settings", "blocked_email_domains"]) {
      const { error } = await service.from(table).select("*");
      expect(error?.code, table).toBe("42501");
    }
    const grants = await sql<{ role: string; table: string }>(
      `select r.rolname as role, t.relname as table from pg_class t, pg_roles r
       where t.oid in ('private.signups'::regclass, 'private.signup_pepper'::regclass, 'public.signup_settings'::regclass, 'public.blocked_email_domains'::regclass)
         and r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
         and has_table_privilege(r.oid, t.oid, 'select')`,
    );
    expect(grants).toEqual([]);
  });
});

describe("before_user_created: modes × providers × invited (direct calls as supabase_auth_admin)", () => {
  const providers = ["google", "email", "phone", "github", "", undefined];

  it("allows an invited email in every mode with any provider, and logs nothing for it", async () => {
    const email = testEmail("inv");
    await invite(email);
    for (const mode of ["invite", "waitlist", "open"]) {
      await setSettings({ mode });
      for (const p of providers) expect(await hook(event(email, p)), `${mode}/${p}`).toEqual({});
    }
    await inRolledBack(auth, async () => {
      const before = Number((await auth.query("select count(*) as n from private.signups")).rows[0].n);
      await hookOn(auth, event(email, "google", "203.0.113.7"));
      expect(Number((await auth.query("select count(*) as n from private.signups")).rows[0].n)).toBe(before);
    });
  });

  it("refuses a new email outside open with today's invite-only error, whatever the provider", async () => {
    for (const mode of ["invite", "waitlist"]) {
      await setSettings({ mode });
      for (const p of providers) expect(await hook(event(testEmail("new"), p)), `${mode}/${p}`).toEqual(INVITE_ONLY);
    }
  });

  it("in open, admits a new email only through Google; every other or missing provider is told to use Google", async () => {
    await setSettings({ mode: "open" });
    expect(await hook(event(testEmail("g"), "google"))).toEqual({});
    for (const p of providers.filter((x) => x !== "google")) expect(await hook(event(testEmail("ng"), p)), String(p)).toEqual(GOOGLE_ONLY);
    expect(await hook({ user: { email: testEmail("nm"), app_metadata: {} } })).toEqual(GOOGLE_ONLY);
  });

  it("refuses the request when the settings row is gone (fail closed)", async () => {
    await setSettings({ mode: "open" });
    const owner = new pg.Client({ connectionString: localEnv().dbUrl });
    await owner.connect();
    try {
      await inRolledBack(owner, async () => {
        await owner.query("delete from public.signup_settings");
        expect(await hookOn(owner, event(testEmail("gone"), "google"))).toEqual(INVITE_ONLY);
      });
    } finally {
      await owner.end();
    }
  });
});

describe("throwaway domains", () => {
  const script = resolve(SUPABASE, "scripts/blocked-domains.mjs");
  const loader = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args, "--local"], {
      env: { PATH: process.env.PATH, OAB_SB_DB_URL: localEnv().dbUrl },
      encoding: "utf8",
    });

  it("loads the vendored list with blocked-domains.mjs --apply --local, removes unlisted rows, and --check then passes", async () => {
    await sql("insert into public.blocked_email_domains (domain) values ('not-listed.example') on conflict do nothing");
    const apply = loader("--apply");
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toMatch(/blocked domains: applied \(\d+ in the database\)/);
    expect(await sql("select 1 from public.blocked_email_domains where domain = 'not-listed.example'")).toEqual([]);
    const lines = readFileSync(resolve(SUPABASE, "data/disposable-domains.txt"), "utf8").trim().split("\n").length;
    expect(Number((await sql<{ n: string }>("select count(*) as n from public.blocked_email_domains"))[0]!.n)).toBe(lines);
    const check = loader("--check");
    expect(check.status, check.stdout).toBe(0);
    expect(check.stdout).toContain("0 missing, 0 extra");
  });

  it("refuses mailinator.com and any subdomain in open, but lets a similar-looking or invited address through", async () => {
    await setSettings({ mode: "open" });
    for (const email of ["oab-m7+x@mailinator.com", "oab-m7+x@x.mailinator.com", "oab-m7+x@a.b.mailinator.com", "OAB-M7+X@Mailinator.COM"])
      expect(await hook(event(email, "google")), email).toEqual(THROWAWAY);
    expect(await hook(event("oab-m7+x@mailinator-lookalike.example.test", "google"))).toEqual({});
    expect(await hook(event("oab-m7+x@mailinator.com.example.test", "google"))).toEqual({});
    await sql("insert into public.invited_emails (email) values ('oab-m7+invited@mailinator.com') on conflict do nothing");
    try {
      expect(await hook(event("oab-m7+invited@mailinator.com", "google"))).toEqual({});
    } finally {
      await sql("delete from public.invited_emails where email = 'oab-m7+invited@mailinator.com'");
    }
  });
});

describe("signup caps from private.signups", () => {
  it("refuses the 3rd allowed Google signup in the hour with signups_per_hour = 2 (counted from the log)", async () => {
    await setSettings({ mode: "open", signups_per_hour: (await recent("1 hour")) + 2 });
    await inRolledBack(auth, async () => {
      expect(await hookOn(auth, event(testEmail("c1"), "google"))).toEqual({});
      expect(await hookOn(auth, event(testEmail("c2"), "google"))).toEqual({});
      expect(await hookOn(auth, event(testEmail("c3"), "google"))).toEqual(PAUSED);
    });
  });

  it("applies the daily cap the same way", async () => {
    await setSettings({ mode: "open", signups_per_day: (await recent("1 day")) + 1 });
    await inRolledBack(auth, async () => {
      expect(await hookOn(auth, event(testEmail("d1"), "google"))).toEqual({});
      expect(await hookOn(auth, event(testEmail("d2"), "google"))).toEqual(PAUSED);
    });
  });

  it("allows 3 per IP per day, stores only the peppered hash, and counts other IPs separately", async () => {
    await setSettings({ mode: "open" });
    const ip = `198.18.${randomInt(256)}.${randomInt(256)}`;
    await inRolledBack(auth, async () => {
      for (let i = 0; i < 3; i++) expect(await hookOn(auth, event(testEmail(`ip${i}`), "google", ip)), `ip${i}`).toEqual({});
      expect(await hookOn(auth, event(testEmail("ip3"), "google", ip))).toEqual(PAUSED);
      expect(await hookOn(auth, event(testEmail("ip4"), "google", "198.51.100.20"))).toEqual({});
      const pepper = (await auth.query<{ p: Buffer }>("select pepper as p from private.signup_pepper")).rows[0]!.p;
      const want = createHash("sha256")
        .update(Buffer.concat([Buffer.from(ip), pepper]))
        .digest();
      const rows = (await auth.query<{ h: Buffer }>("select ip_hash as h from private.signups where at = now() and ip_hash is not null"))
        .rows;
      expect(rows.filter((r) => r.h.equals(want))).toHaveLength(3);
      const text = JSON.stringify((await auth.query("select * from private.signups where at = now()")).rows);
      expect(text).not.toContain(ip);
    });
  });

  it("never lets parallel signups past the hourly cap (advisory lock)", async () => {
    const before = Number((await sql<{ id: string }>("select coalesce(max(id), 0) as id from private.signups"))[0]!.id);
    await setSettings({ mode: "open", signups_per_hour: (await recent("1 hour")) + 3, signups_per_ip_day: 1000 });
    const clients = await Promise.all(Array.from({ length: 10 }, () => connectAs("supabase_auth_admin")));
    try {
      const results = await Promise.all(clients.map((c, i) => hookOn(c, event(testEmail(`par${i}`), "google"))));
      expect(
        results.filter((r) => JSON.stringify(r) === "{}"),
        JSON.stringify(results),
      ).toHaveLength(3);
      expect(results.filter((r) => JSON.stringify(r) !== "{}")).toEqual(Array(7).fill(PAUSED));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
      await sql("delete from private.signups where id > $1", [before]);
    }
  });

  it("reports the counts and caps through signup_stats", async () => {
    await setSettings({ signups_per_hour: 7, signups_per_day: 70 });
    const [s] = await sql<{ last_hour: number; last_day: number; cap_hour: number; cap_day: number }>(
      "select * from public.signup_stats()",
    );
    expect(s).toMatchObject({ cap_hour: 7, cap_day: 70, last_hour: await recent("1 hour"), last_day: await recent("1 day") });
  });
});

describe("real GoTrue paths", () => {
  it("in open, refuses OTP, password and phone signups for a new address", async () => {
    await setSettings({ mode: "open" });
    const otp = await anon().auth.signInWithOtp({ email: track(testEmail("otp")), options: { shouldCreateUser: true } });
    expect(otp.error?.message).toBe("Create your account with Google.");
    const pwEmail = track(testEmail("pw"));
    const pw = await anon().auth.signUp({ email: pwEmail, password: `Pw-${pwEmail}` });
    expect(pw.error?.message).toBe("Create your account with Google.");
    const phone = await anon().auth.signUp({ phone: "+15555550123", password: "Pw-phone-signup-1" });
    expect(phone.error).not.toBeNull();
    expect(await sql("select 1 from auth.users where email = any($1) or phone = '15555550123'", [[pwEmail]])).toEqual([]);
  });

  it("in open, still lets an invited email sign up by email link", async () => {
    await setSettings({ mode: "open" });
    const email = testEmail("otp-inv");
    await invite(email);
    const { error } = await anon().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(error).toBeNull();
    expect(await sql("select 1 from auth.users where email = $1", [email])).toHaveLength(1);
  });

  it("in waitlist, refuses a non-invited OTP signup with today's exact message", async () => {
    const otp = await anon().auth.signInWithOtp({ email: track(testEmail("wl")), options: { shouldCreateUser: true } });
    expect(otp.error?.message).toBe("Open Agent is invite-only. Request access first.");
  });
});

describe("live safety of the replaced hook (AC 23)", () => {
  const rollback = readFileSync(resolve(SUPABASE, "rollback/m7.sql"), "utf8");
  const oldHook = /create or replace function private\.before_user_created\(event jsonb\)[\s\S]*?\$\$;/.exec(rollback)![0];

  it("answers byte-identically to the pre-M7 function in waitlist and invite for invited/not × google/email/empty", async () => {
    const owner = new pg.Client({ connectionString: localEnv().dbUrl });
    await owner.connect();
    const invited = testEmail("ac23");
    await invite(invited);
    try {
      await inRolledBack(owner, async () => {
        await owner.query(oldHook.replace("private.before_user_created(", "private.before_user_created_m6("));
        for (const mode of ["waitlist", "invite"]) {
          await owner.query("update public.signup_settings set mode = $1", [mode]);
          for (const email of [invited, testEmail("ac23-new")])
            for (const provider of ["google", "email", ""]) {
              const e = JSON.stringify(event(email, provider));
              const { rows } = await owner.query<{ a: string; b: string }>(
                "select private.before_user_created($1::jsonb)::text as a, private.before_user_created_m6($1::jsonb)::text as b",
                [e],
              );
              expect(rows[0]!.a, `${mode} ${email} ${provider}`).toBe(rows[0]!.b);
            }
          const empty = await owner.query<{ a: string; b: string }>(
            "select private.before_user_created('{}'::jsonb)::text as a, private.before_user_created_m6('{}'::jsonb)::text as b",
          );
          expect(empty.rows[0]!.a).toBe(empty.rows[0]!.b);
        }
      });
    } finally {
      await owner.end();
    }
  });

  it("restores the pre-M7 hook body and clears the version comment with rollback/m7.sql", async () => {
    const owner = new pg.Client({ connectionString: localEnv().dbUrl });
    await owner.connect();
    const access = readFileSync(resolve(SUPABASE, "migrations/20261101060633_access.sql"), "utf8");
    const body = (src: string) => /create function private\.before_user_created\(event jsonb\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(src)![1];
    try {
      await inRolledBack(owner, async () => {
        await owner.query(rollback);
        const { rows } = await owner.query<{ src: string; v: string | null; vol: string }>(
          "select prosrc as src, obj_description(oid, 'pg_proc') as v, provolatile as vol from pg_proc where oid = 'private.before_user_created(jsonb)'::regprocedure",
        );
        expect(rows[0]).toEqual({ src: body(access), v: null, vol: "s" });
      });
      expect(
        (await owner.query("select obj_description('private.before_user_created(jsonb)'::regprocedure, 'pg_proc') as v")).rows[0].v,
      ).toBe("oab:m7-signup-modes:v1");
    } finally {
      await owner.end();
    }
  });
});
