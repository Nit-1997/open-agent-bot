const required = (name) => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name} (load deploy-config/env-files/.env-supabase-admin)`);
  return v;
};

export function adminEnv() {
  return { url: required("SUPABASE_URL"), key: required("SUPABASE_ADMIN_SECRET_KEY"), appOrigin: process.env.APP_ORIGIN?.trim() || "https://app.localhost" };
}

export function createAdmin({ url, key }) {
  async function call(method, path, body, headers = {}) {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { apikey: key, "content-type": "application/json", ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const code = data?.error_code ?? data?.code ?? data?.error ?? res.status;
      throw new Error(`${method} ${path.split("?")[0]} failed: ${code} ${data?.msg ?? data?.message ?? ""}`.trim());
    }
    return data;
  }

  const rest = (method, path, body, prefer) => call(method, `/rest/v1/${path}`, body, prefer ? { prefer } : {});

  return {
    async inviteEmail(email) {
      await rest("POST", "invited_emails?on_conflict=email", { email }, "resolution=ignore-duplicates,return=minimal");
    },
    async profileByEmail(email) {
      const rows = await rest("GET", `profiles?select=user_id,email&email=eq.${encodeURIComponent(email)}`);
      return rows[0];
    },
    async profilesLike(pattern) {
      return rest("GET", `profiles?select=user_id,email&email=like.${encodeURIComponent(pattern)}`);
    },
    async countUsers() {
      const res = await fetch(`${url}/rest/v1/profiles?select=user_id`, { method: "HEAD", headers: { apikey: key, prefer: "count=exact" } });
      return Number(res.headers.get("content-range")?.split("/")[1] ?? Number.NaN);
    },
    getUser: (id) => call("GET", `/auth/v1/admin/users/${id}`),
    createUser: (attrs) => call("POST", "/auth/v1/admin/users", attrs),
    updateUser: (id, attrs) => call("PUT", `/auth/v1/admin/users/${id}`, attrs),
    generateLink: (attrs) => call("POST", "/auth/v1/admin/generate_link", attrs),
    async deleteUser(id, email) {
      for (;;) {
        const objects = await call("POST", "/storage/v1/object/list/artifacts", { prefix: id, limit: 100, offset: 0 });
        if (!objects?.length) break;
        await call("DELETE", "/storage/v1/object/artifacts", { prefixes: objects.map((o) => `${id}/${o.name}`) });
      }
      await rest("DELETE", `access_requests?email=eq.${encodeURIComponent(email)}`, undefined, "return=minimal");
      await rest("DELETE", `invited_emails?email=eq.${encodeURIComponent(email)}`, undefined, "return=minimal");
      await call("DELETE", `/auth/v1/admin/users/${id}`);
    },
    async deleteRequestsLike(pattern) {
      await rest("DELETE", `access_requests?email=like.${encodeURIComponent(pattern)}`, undefined, "return=minimal");
      await rest("DELETE", `invited_emails?email=like.${encodeURIComponent(pattern)}`, undefined, "return=minimal");
    },
  };
}

export const normalizeEmail = (raw) => {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`not an email: ${raw ?? ""}`);
  return email;
};

export async function run(main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
