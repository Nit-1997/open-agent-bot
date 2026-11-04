export const API = "https://api.supabase.com/v1";
export const LOCAL_API_RE = /^http:\/\/127\.0\.0\.1:(187[0-4]\d)\/v1$/;

export function apiBaseFrom(argv) {
  const i = argv.indexOf("--api-base");
  if (i < 0) return { base: API, fake: false };
  const value = argv[i + 1];
  if (!LOCAL_API_RE.test(value ?? ""))
    throw new Error("--api-base accepts only http://127.0.0.1:<18700-18749>/v1 (a fake Management API for tests)");
  return { base: value, fake: true };
}

export function managementApi({ base, ref, token }) {
  async function api(method, path, body) {
    const res = await fetch(`${base}/projects/${ref}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      redirect: "error",
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    api,
    read: (query) => api("POST", "/database/query/read-only", { query }),
    write: (query) => api("POST", "/database/query", { query }),
  };
}
