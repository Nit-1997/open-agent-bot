#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLOUD_DIR = resolve(HERE, "..", "..");
export const MIGRATIONS_DIR = join(CLOUD_DIR, "supabase", "migrations");
export const TEMPLATE = join(CLOUD_DIR, "supabase", "local", "config.template.toml");
export const PLATFORM = join(CLOUD_DIR, "supabase", "local", "platform.sql");

export const NAME_RE = /^oab-m7-[a-z0-9-]{1,20}$/;
export const PORT_MIN = 18700;
export const PORT_MAX = 18749;
export const PORT_SPAN = 5;
export const FORBIDDEN_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_PASSWORD", "SUPABASE_DB_URL"];
export const LINKED_STATE = ["project-ref", "pooler-url", "postgres-version", "rest-version", "gotrue-version", "storage-version"];
export const COMMANDS = ["start", "stop", "status", "reset", "env", "push-dry-run", "push"];
export const DEFAULT_SITE_URL = "http://localhost:18721";
const SITE_RE = /^http:\/\/(localhost|127\.0\.0\.1):(\d{5})$/;
const VALUE_RE = /^[A-Za-z0-9_.:/@=+-]+$/;

export const REFUSAL_CODE = "local_stack_only";

export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = "Refusal";
    this.code = REFUSAL_CODE;
  }
}

const inRange = (p) => Number.isInteger(p) && p >= PORT_MIN && p <= PORT_MAX;

export function portsFor(base) {
  const b = Number(base);
  if (!/^\d+$/.test(String(base)) || !inRange(b) || !inRange(b + PORT_SPAN - 1))
    throw new Refusal(
      `--ports must be a base from ${PORT_MIN} to ${PORT_MAX - PORT_SPAN + 1} (it uses ${PORT_SPAN} ports up to ${PORT_MAX})`,
    );
  return { base: b, shadow: b, api: b + 1, db: b + 2, spare: b + 3, mail: b + 4 };
}

export function checkName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name))
    throw new Refusal(`--name must match ${NAME_RE} (got ${JSON.stringify(name ?? "")})`);
  return name;
}

export function checkSiteUrl(raw) {
  const m = SITE_RE.exec(raw ?? "");
  if (!m || !inRange(Number(m[2])))
    throw new Refusal(`--site-url must be http://localhost:<${PORT_MIN}-${PORT_MAX}> or http://127.0.0.1:<port>`);
  return raw;
}

export function checkDbUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Refusal("--db-url is not a URL");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Refusal("--db-url must be a postgresql:// URL");
  if (u.hostname !== "127.0.0.1") throw new Refusal(`refusing --db-url: the host must be 127.0.0.1 (got ${u.hostname || "none"})`);
  if (!inRange(Number(u.port))) throw new Refusal(`refusing --db-url: the port must be ${PORT_MIN}-${PORT_MAX}`);
  return raw;
}

export function refuseEnv(env) {
  const set = FORBIDDEN_ENV.filter((k) => env[k] !== undefined && env[k] !== "");
  if (set.length) throw new Refusal(`refusing to run with ${set.join(", ")} set: this script only drives a local stack (unset them first)`);
}

export function refuseLinkedState(dirs) {
  for (const dir of dirs) {
    for (const file of LINKED_STATE) {
      if (existsSync(join(dir, file)))
        throw new Refusal(`refusing: linked-project state found at ${join(dir, file)} (remove ${dir} first)`);
    }
  }
}

export function migrationVersions(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export function selectMigrations(until, dir = MIGRATIONS_DIR) {
  const files = migrationVersions(dir);
  if (until === undefined) return files;
  const i = files.findIndex((f) => f.split("_")[0] === until);
  if (!/^\d{14}$/.test(until) || i === -1)
    throw new Refusal(`--migrations-until ${JSON.stringify(until)} is not a migration version in ${dir}`);
  return files.slice(0, i + 1);
}

export function renderConfig(template, { name, ports, siteUrl }) {
  const values = {
    PROJECT_ID: checkName(name),
    API_PORT: ports.api,
    DB_PORT: ports.db,
    SHADOW_PORT: ports.shadow,
    SPARE_PORT: ports.spare,
    MAIL_PORT: ports.mail,
    API_URL: `http://127.0.0.1:${ports.api}`,
    SITE_URL: checkSiteUrl(siteUrl),
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
    if (!(key in values)) throw new Refusal(`unknown template placeholder ${m}`);
    return String(values[key]);
  });
}

const SHAPES = [
  (a) => a.length === 1 && a[0] === "start",
  (a) => a.length === 2 && a[0] === "stop" && a[1] === "--no-backup",
  (a) => a.length === 3 && a[0] === "status" && a[1] === "-o" && a[2] === "env",
  (a) => a.length === 4 && a[0] === "gen" && a[1] === "signing-key" && a[2] === "--algorithm" && a[3] === "ES256",
  (a) =>
    (a.length === 4 || (a.length === 5 && a[4] === "--dry-run")) &&
    a[0] === "db" &&
    a[1] === "push" &&
    a[2] === "--db-url" &&
    checkDbUrl(a[3]) === a[3],
];

export function assertAllowedCli(args) {
  if (!Array.isArray(args) || args.length < 3) throw new Refusal("refusing an empty supabase command");
  const [flag, workdir, ...rest] = args;
  if (flag !== "--workdir" || typeof workdir !== "string" || !workdir) throw new Refusal("every supabase command needs --workdir first");
  if (args.some((a) => a === "--linked" || a === "--project-ref" || a.startsWith("--project-ref=") || a === "--all"))
    throw new Refusal(`refusing supabase ${rest.join(" ")}: linked or machine-wide flags are never allowed`);
  const ok = SHAPES.some((shape) => shape(rest));
  if (!ok) throw new Refusal(`refusing supabase ${rest.join(" ")}: not one of the allowed local commands`);
  return args;
}

export function parseStatusEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(?:"([^"]*)"|(\S*))$/.exec(line.trim());
    if (m) out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

export function envLines(status, ports) {
  const pick = (key) => {
    const v = status[key];
    if (!v || !VALUE_RE.test(v)) throw new Refusal(`supabase status did not report a usable ${key}`);
    return v;
  };
  const vars = {
    OAB_SB_API_URL: `http://127.0.0.1:${ports.api}`,
    OAB_SB_DB_URL: `postgresql://postgres:postgres@127.0.0.1:${ports.db}/postgres`,
    OAB_SB_PUBLISHABLE_KEY: pick("PUBLISHABLE_KEY"),
    OAB_SB_SECRET_KEY: pick("SECRET_KEY"),
    OAB_SB_MAIL_URL: `http://127.0.0.1:${ports.mail}`,
  };
  const api = status.API_URL;
  if (api && api.replace(/\/$/, "") !== vars.OAB_SB_API_URL)
    throw new Refusal(`supabase status reports API_URL ${api}, expected ${vars.OAB_SB_API_URL}`);
  return Object.entries(vars).map(([k, v]) => `export ${k}='${v}'`);
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new Refusal(`usage: local-stack.mjs <${COMMANDS.join("|")}> --name oab-m7-<x> [--ports <base>]`);
  const opts = { command };
  const flags = {
    "--name": "name",
    "--ports": "ports",
    "--migrations-until": "migrationsUntil",
    "--db-url": "dbUrl",
    "--site-url": "siteUrl",
  };
  for (let i = 0; i < rest.length; i++) {
    const key = flags[rest[i]];
    if (!key || rest[i + 1] === undefined) throw new Refusal(`unknown or incomplete option ${JSON.stringify(rest[i])}`);
    if (opts[key] !== undefined) throw new Refusal(`${rest[i]} given twice`);
    opts[key] = rest[++i];
  }
  checkName(opts.name);
  if (opts.ports !== undefined) opts.ports = portsFor(opts.ports);
  if (opts.migrationsUntil !== undefined && command !== "start") throw new Refusal("--migrations-until applies to start only");
  if (opts.dbUrl !== undefined && !command.startsWith("push")) throw new Refusal("--db-url applies to push-dry-run and push only");
  if (opts.dbUrl !== undefined) checkDbUrl(opts.dbUrl);
  if (opts.siteUrl !== undefined && command !== "start") throw new Refusal("--site-url applies to start only");
  if (opts.siteUrl !== undefined) checkSiteUrl(opts.siteUrl);
  if (command === "start" && !opts.ports) throw new Refusal("start needs --ports <base>");
  return opts;
}

export function portFree(port, host) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once("error", () => done(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => done(true)));
  });
}

export async function refuseBusyPorts(ports, free = portFree) {
  for (let p = ports.base; p < ports.base + PORT_SPAN; p++) {
    if (!(await free(p, "127.0.0.1")) || !(await free(p, "0.0.0.0")))
      throw new Refusal(`port ${p} is in use (the stack needs ${ports.base}-${ports.base + PORT_SPAN - 1} free)`);
  }
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

export const workdirFor = (name, tmp = tmpdir()) => resolve(tmp, `oab-sb-${checkName(name)}`);

export const KEY_LINE =
  /(PUBLISHABLE_KEY|SECRET_KEY|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|S3_PROTOCOL_ACCESS_KEY|sb_secret_|sb_publishable_|eyJ)/;

export function safeLines(text) {
  return text.split("\n").filter((l) => l.trim() && !KEY_LINE.test(l));
}

function runCli(args, { capture = false, env = process.env, bin = "supabase" } = {}) {
  assertAllowedCli(args);
  return new Promise((done, fail) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
    });
    const chunks = { stdout: "", stderr: "" };
    const relay = (name, stream) => (data) => {
      chunks[name] += data;
      if (!capture) for (const l of safeLines(String(data))) stream.write(`${l}\n`);
    };
    child.stdout.on("data", relay("stdout", process.stdout));
    child.stderr.on("data", relay("stderr", process.stderr));
    child.on("error", (e) => fail(new Refusal(`could not run supabase: ${e.message}`)));
    child.on("close", (code) => done({ status: code ?? 1, ...chunks }));
  });
}

function docker(args) {
  const res = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (res.error || res.status !== 0) throw new Refusal(`docker ${args[0]} ${args[1]} failed (${res.error?.message ?? res.stderr.trim()})`);
  return res.stdout.split("\n").filter(Boolean);
}

export function leftovers(name, list = docker) {
  const mine = (n) => n.endsWith(`_${name}`);
  return [
    ...list(["ps", "-a", "--format", "{{.Names}}"])
      .filter(mine)
      .map((n) => `container ${n}`),
    ...list(["volume", "ls", "--format", "{{.Name}}"])
      .filter(mine)
      .map((n) => `volume ${n}`),
    ...list(["network", "ls", "--format", "{{.Name}}"])
      .filter(mine)
      .map((n) => `network ${n}`),
  ];
}

const STATE = "oab-stack.json";

function readState(work) {
  try {
    return JSON.parse(readFileSync(join(work, STATE), "utf8"));
  } catch {
    return undefined;
  }
}

function prepare(work, opts, migrations) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "supabase", "migrations"), { recursive: true, mode: 0o700 });
  chmodSync(work, 0o700);
  const config = renderConfig(readFileSync(TEMPLATE, "utf8"), {
    name: opts.name,
    ports: opts.ports,
    siteUrl: opts.siteUrl ?? DEFAULT_SITE_URL,
  });
  writeFileSync(join(work, "supabase", "config.toml"), config, { mode: 0o600 });
  copyFileSync(PLATFORM, join(work, "supabase", "roles.sql"));
  for (const f of migrations) {
    const dest = join(work, "supabase", "migrations", f);
    copyFileSync(join(MIGRATIONS_DIR, f), dest);
    if (sha256(dest) !== sha256(join(MIGRATIONS_DIR, f))) throw new Refusal(`migration copy differs: ${f}`);
  }
  const state = { name: opts.name, base: opts.ports.base, migrationsUntil: opts.migrationsUntil, siteUrl: opts.siteUrl, migrations };
  writeFileSync(join(work, STATE), `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = deps.err ?? ((s) => process.stderr.write(`${s}\n`));
  const cli = deps.cli ?? ((args, o) => runCli(args, { ...o, env }));
  const free = deps.portFree ?? portFree;
  const list = deps.docker ?? docker;
  const opts = parseArgs(argv);
  refuseEnv(env);
  const work = workdirFor(opts.name, deps.tmp);
  const linkedDirs = [join(CLOUD_DIR, "supabase", ".temp"), join(work, "supabase", ".temp")];
  refuseLinkedState(linkedDirs);
  const state = readState(work);
  const ports = opts.ports ?? (state ? portsFor(state.base) : undefined);
  const wd = ["--workdir", work];
  const must = (res, what) => {
    if (res.status !== 0) {
      const last = safeLines(res.stderr).at(-1);
      throw new Refusal(`${what} failed with exit ${res.status}${last ? `: ${last}` : ""}`);
    }
    return res;
  };

  const start = async (o) => {
    await refuseBusyPorts(o.ports, free);
    const migrations = selectMigrations(o.migrationsUntil);
    prepare(work, o, migrations);
    const keyFile = join(work, "supabase", "signing_keys.json");
    writeFileSync(keyFile, "[]\n", { mode: 0o600 });
    must(await cli([...wd, "gen", "signing-key", "--algorithm", "ES256"], { capture: true }), "supabase gen signing-key");
    chmodSync(keyFile, 0o600);
    const keys = JSON.parse(readFileSync(keyFile, "utf8"));
    if (!Array.isArray(keys) || keys.length !== 1 || keys[0].alg !== "ES256" || keys[0].kty !== "EC")
      throw new Refusal("supabase gen signing-key did not write one ES256 key");
    const started = Date.now();
    must(await cli([...wd, "start"]), "supabase start");
    const span = `${o.ports.base}-${o.ports.base + PORT_SPAN - 1}`;
    out(
      `[local-stack] ${o.name} started on 127.0.0.1:${span} with ${migrations.length} migrations in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    return 0;
  };

  const stop = async (o) => {
    if (!existsSync(join(work, "supabase", "config.toml"))) prepare(work, o, []);
    must(await cli([...wd, "stop", "--no-backup"]), "supabase stop");
    rmSync(work, { recursive: true, force: true });
    const left = leftovers(o.name, list);
    if (left.length) {
      err(`[local-stack] ${o.name} left behind: ${left.join(", ")}`);
      return 1;
    }
    out(`[local-stack] ${o.name} stopped; no containers, volumes or networks remain`);
    return 0;
  };

  if (opts.command === "start") return start({ ...opts, ports });
  if (!ports) throw new Refusal(`no stack state for ${opts.name} in ${work}: pass --ports <base>`);
  if (opts.command === "stop") return stop({ ...opts, ports });
  if (opts.command === "reset") {
    if (!state) throw new Refusal(`no stack state for ${opts.name} in ${work}: reset needs a stack started by this script`);
    const again = { name: opts.name, ports, migrationsUntil: state.migrationsUntil, siteUrl: state.siteUrl };
    const stopped = await stop(again);
    return stopped === 0 ? start(again) : stopped;
  }

  if (opts.command === "status" || opts.command === "env") {
    const status = parseStatusEnv(must(await cli([...wd, "status", "-o", "env"], { capture: true }), "supabase status").stdout);
    const lines = envLines(status, ports);
    if (opts.command === "env") for (const l of lines) out(l);
    else
      out(
        `[local-stack] ${opts.name} running: api http://127.0.0.1:${ports.api} db 127.0.0.1:${ports.db} mail http://127.0.0.1:${ports.mail}`,
      );
    return 0;
  }

  const dbUrl = checkDbUrl(opts.dbUrl ?? `postgresql://postgres:postgres@127.0.0.1:${ports.db}/postgres?sslmode=disable`);
  const temp = join(CLOUD_DIR, "supabase", ".temp");
  const hadTemp = existsSync(temp);
  try {
    const args = ["--workdir", CLOUD_DIR, "db", "push", "--db-url", dbUrl, ...(opts.command === "push-dry-run" ? ["--dry-run"] : [])];
    return must(await cli(args), `supabase ${opts.command} (local)`).status;
  } finally {
    if (!hadTemp) rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${e instanceof Refusal ? `${REFUSAL_CODE}: ` : "local-stack: unexpected error: "}${e.message}\n`);
      process.exit(e instanceof Refusal ? 2 : 1);
    },
  );
}
