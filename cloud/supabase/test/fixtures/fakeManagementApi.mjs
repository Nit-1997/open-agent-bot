import { createServer } from "node:http";

export const REF = "abcdefghijklmnopqrst";

export function fakeAuthConfig(over = {}) {
  return {
    site_url: "https://app.example",
    uri_allow_list: "https://app.localhost/auth/callback,https://app.localhost/auth/confirm",
    disable_signup: true,
    external_email_enabled: true,
    external_google_enabled: true,
    external_github_enabled: false,
    external_apple_enabled: false,
    external_phone_enabled: false,
    external_anonymous_users_enabled: false,
    saml_enabled: false,
    ...over,
  };
}

export function fakeDatabase(over = {}) {
  return {
    m7Functions: true,
    hooks: true,
    settingsRows: 1,
    mode: "waitlist",
    hookVersion: "oab:m7-signup-modes:v1",
    blockedDomains: 10123,
    ...over,
  };
}

function answer(db, query, log) {
  if (/^update public\.signup_settings set mode = '(\w+)'/.test(query)) {
    if (db.settingsRows !== 1) throw Object.assign(new Error("relation missing"), { status: 400 });
    db.mode = /mode = '(\w+)'/.exec(query)[1];
    log.push(`SQL update mode=${db.mode}`);
    return [];
  }
  if (query.startsWith("select obj_description")) return [{ v: db.hookVersion }];
  if (query.includes("to_regprocedure('public.request_admit")) return [{ ok: db.m7Functions }];
  if (query.includes("to_regprocedure('private.")) return [{ ok: db.hooks }];
  if (query.startsWith("select mode from public.signup_settings")) {
    if (db.settingsRows === 0) throw Object.assign(new Error("relation missing"), { status: 400 });
    return [{ mode: db.mode }];
  }
  if (query.startsWith("select count(*)::int as n from public.signup_settings")) {
    if (db.settingsRows === 0) throw Object.assign(new Error("relation missing"), { status: 400 });
    return [{ n: db.settingsRows }];
  }
  if (query.startsWith("select count(*)::int as n from public.blocked_email_domains")) return [{ n: db.blockedDomains }];
  throw Object.assign(new Error(`unexpected query: ${query.slice(0, 80)}`), { status: 500 });
}

export async function startFakeManagementApi({ auth = fakeAuthConfig(), db = fakeDatabase(), ports = [18730, 18739] } = {}) {
  const state = { auth, db, log: [], hosts: new Set() };
  const server = createServer((req, res) => {
    let text = "";
    req.on("data", (c) => {
      text += c;
    });
    req.on("end", () => {
      state.hosts.add(req.headers.host);
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };
      const base = `/v1/projects/${REF}`;
      if (req.headers.authorization !== "Bearer sbp_fake_token" || !req.url.startsWith(base)) return send(401, { message: "bad auth" });
      const path = req.url.slice(base.length);
      const body = text ? JSON.parse(text) : undefined;
      try {
        if (req.method === "GET" && path === "/config/auth") return send(200, state.auth);
        if (req.method === "PATCH" && path === "/config/auth") {
          state.log.push(
            `PATCH auth ${Object.keys(body).sort().join(",")}${"disable_signup" in body ? ` disable_signup=${body.disable_signup}` : ""}`,
          );
          Object.assign(state.auth, body);
          return send(200, state.auth);
        }
        if (req.method === "GET" && path === "/config/auth/signing-keys")
          return send(200, [{ id: "k1", algorithm: "ES256", status: "in_use" }]);
        if (req.method === "GET" && path === "/api-keys?reveal=false")
          return send(200, [
            { type: "secret", name: "agent" },
            { type: "secret", name: "admin_scripts" },
          ]);
        if (req.method === "GET" && path === "/api-keys/legacy") return send(200, { enabled: false });
        if (req.method === "POST" && (path === "/database/query/read-only" || path === "/database/query")) {
          if (path.endsWith("read-only") && !/^select\b/.test(body.query)) return send(400, { message: "read-only" });
          return send(200, answer(state.db, body.query, state.log));
        }
        return send(404, { message: `no route ${req.method} ${path}` });
      } catch (err) {
        return send(err.status ?? 500, { message: err.message });
      }
    });
  });
  let port;
  for (let p = ports[0]; p <= ports[1] && !port; p++) {
    port = await new Promise((resolve) => {
      server.once("error", () => resolve(undefined));
      server.listen(p, "127.0.0.1", () => resolve(p));
    });
  }
  if (!port) throw new Error(`no free port in ${ports.join("-")}`);
  return {
    state,
    base: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
