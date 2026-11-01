import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forUser } from "../../src/db/users.js";
import { anon, createTestUser, deleteCreatedUsers, enabled, managementQuery, remainingRows, service, type TestUser } from "./helpers.js";

const TABLES = [
  "profiles",
  "access_requests",
  "invited_emails",
  "chats",
  "chat_messages",
  "workspace_entities",
  "artifacts",
  "provider_settings",
  "provider_credentials",
];

const denied = (r: { data: unknown; error: { code?: string } | null }) =>
  !!r.error || (Array.isArray(r.data) && r.data.length === 0) || r.data === null;

describe.skipIf(!enabled)("RLS and grants (live project)", () => {
  let a: TestUser;
  let b: TestUser;
  let clients: Array<[string, SupabaseClient]>;

  beforeAll(async () => {
    [a, b] = await Promise.all([createTestUser(), createTestUser()]);
    const ra = forUser(service(), a.id);
    const chat = randomUUID();
    await ra.chats.claim(chat, {});
    await ra.messages.append(chat, "r", [{ role: "user", content: "secret", status: "complete" }]);
    await ra.providerSettings.get();
    clients = [
      ["anon", anon()],
      ["A", a.client],
      ["B", b.client],
    ];
  }, 60_000);

  afterAll(async () => {
    expect(await remainingRows(await deleteCreatedUsers())).toBe(0);
  }, 60_000);

  it("lets nobody read any table through PostgREST, not even their own rows", async () => {
    for (const [who, c] of clients) {
      for (const t of TABLES) {
        const r = await c.from(t).select("*").limit(5);
        expect(denied(r), `${who} select ${t}`).toBe(true);
      }
    }
  });

  it("denies every insert, update and delete", async () => {
    for (const [who, c] of clients) {
      for (const t of TABLES) {
        const ins = await c.from(t).insert({ user_id: a.id }).select();
        const upd = await c.from(t).update({ created_at: new Date().toISOString() }).neq("created_at", "1970-01-01").select();
        const del = await c.from(t).delete().neq("created_at", "1970-01-01").select();
        expect(!!ins.error, `${who} insert ${t}`).toBe(true);
        expect(denied(upd), `${who} update ${t}`).toBe(true);
        expect(denied(del), `${who} delete ${t}`).toBe(true);
      }
    }
    const { count } = await service().from("chat_messages").select("*", { count: "exact", head: true }).eq("user_id", a.id);
    expect(count).toBe(1);
  });

  it("denies the agent-only functions", async () => {
    for (const [who, c] of clients) {
      const put = await c.rpc("workspace_put", {
        p_user: a.id,
        p_chat: randomUUID(),
        p_kind: "cart",
        p_id: "main",
        p_value: {},
        p_expected: null,
      });
      const submit = await c.rpc("access_request_submit", {
        p_name: "x",
        p_email: "x@example.test",
        p_note: "",
        p_ip_hash: `\\x${"00".repeat(32)}`,
      });
      expect(put.error, `${who} workspace_put`).not.toBeNull();
      expect(submit.error, `${who} access_request_submit`).not.toBeNull();
    }
  });

  it("keeps the artifacts bucket closed to user clients", async () => {
    for (const [who, c] of clients) {
      const list = await c.storage.from("artifacts").list(a.id);
      expect(denied({ data: list.data, error: list.error }), `${who} list`).toBe(true);
      expect((await c.storage.from("artifacts").download(`${a.id}/x.html`)).error, `${who} download`).not.toBeNull();
      expect(
        (await c.storage.from("artifacts").upload(`${a.id}/x.html`, "<p/>", { contentType: "text/html" })).error,
        `${who} upload`,
      ).not.toBeNull();
    }
  });

  it("has RLS on every public table, one policy, and no grants for anon or authenticated", async () => {
    const tables = await managementQuery<{ relname: string; rls: boolean }>(
      "select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    expect(tables.map((t) => t.relname).sort()).toEqual([...TABLES].sort());
    expect(tables.every((t) => t.rls)).toBe(true);
    const policies = await managementQuery<{ policyname: string }>("select policyname from pg_policies where schemaname = 'public'");
    expect(policies.map((p) => p.policyname)).toEqual(["invited_emails_auth_admin_read"]);
    const grants = await managementQuery<{ n: number }>(
      "select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace cross join (values ('anon'), ('authenticated')) r(role) where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r.role, c.oid, 'select,insert,update,delete')",
    );
    expect(grants[0].n).toBe(0);
    const fns = await managementQuery<{ n: number }>(
      "select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace cross join (values ('anon'), ('authenticated')) r(role) where s.nspname = 'public' and has_function_privilege(r.role, p.oid, 'execute')",
    );
    expect(fns[0].n).toBe(0);
  });
});
