export const REFUSAL_CODE = "local_stack_only";
export const PORT_MIN = 18700;
export const PORT_MAX = 18749;
export const FORBIDDEN_ENV = Object.freeze([
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_URL",
  "LIVE_DB_URL",
]);

export const inPortRange = (port) => /^\d+$/.test(String(port)) && Number(port) >= PORT_MIN && Number(port) <= PORT_MAX;

export function forbiddenEnvSet(env) {
  return FORBIDDEN_ENV.filter((k) => env[k] !== undefined && env[k] !== "");
}

export function localDbUrlProblem(raw, label) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return `${label} is not a URL`;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return `${label} must be a postgresql:// URL`;
  if (u.hostname !== "127.0.0.1") return `${label} host must be 127.0.0.1 (got ${u.hostname || "none"})`;
  if (!inPortRange(u.port)) return `${label} port must be ${PORT_MIN}-${PORT_MAX} (got ${u.port || "default"})`;
  const extra = [...new Set(u.searchParams.keys())].filter((k) => k !== "sslmode");
  if (extra.length) return `${label} may carry no query parameter but sslmode=disable (got ${extra.join(", ")})`;
  const ssl = u.searchParams.getAll("sslmode");
  if (ssl.length > 1 || (ssl.length === 1 && ssl[0] !== "disable")) return `${label} sslmode must be disable for a local stack`;
  if (u.hash) return `${label} must not carry a fragment`;
  return undefined;
}
