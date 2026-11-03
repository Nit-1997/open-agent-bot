import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildZip } from "./zip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFUSAL_EXIT = {
  config: 78,
  db_corrupt: 79,
  db_newer: 80,
  db_migration: 81,
  kek_missing: 82,
  keyfile_invalid: 83,
  ui_missing: 84,
  identity: 85,
  listen: 86,
};
export const REFUSAL_MESSAGES = JSON.parse(readFileSync(join(HERE, "refusal-messages.json"), "utf8"));
const SERVICES = ["search", "agent", "renderer"];

const fp = (t) => (t ? createHash("sha256").update(t).digest("hex").slice(0, 12) : undefined);
const hex = (s, n = 64) => createHash("sha256").update(s).digest("hex").slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, path);
}

export function paths(home) {
  return {
    scenario: join(home, "scenario.json"),
    state: join(home, "state.json"),
    daemon: join(home, "daemon.txt"),
    calls: join(home, "calls.jsonl"),
    socket: join(home, "d.sock"),
  };
}

const DEFAULTS = {
  clientVersion: "29.3.1",
  composeVersion: "5.1.1",
  serverOs: "linux",
  serverArch: "arm64",
  engine: { OperatingSystem: "Docker Desktop", Name: "docker-desktop" },
  memTotal: 12528578560,
  context: "desktop-linux",
  endpoint: "local",
  foreignSocketPath: "/var/run/mDNSResponder",
  pull: { layers: 4, msPerLayer: 120 },
  agent: "healthy",
  resetHeals: false,
  versions: { agent: "0.0.0-fake", search: "0.0.0-fake" },
  afterReadyMs: 2500,
  slow: {},
  portBind: "127.0.0.1",
  upFailMs: 1500,
};

export function scenarioOf(home) {
  const s = { ...DEFAULTS, ...readJson(paths(home).scenario, {}) };
  return { ...s, pull: { ...DEFAULTS.pull, ...s.pull }, versions: { ...DEFAULTS.versions, ...s.versions }, slow: { ...s.slow } };
}

const daemonUp = (home, sc) => {
  const p = paths(home).daemon;
  const v = existsSync(p) ? readFileSync(p, "utf8").trim() : (sc.daemon ?? "up");
  return v !== "down";
};

const alive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killPid = (pid) => {
  if (!alive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
};

function parseCompose(argv) {
  const o = { project: undefined, file: undefined, dir: undefined, envFile: undefined, ansi: undefined, sub: [] };
  let i = 1;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p") o.project = argv[++i];
    else if (a === "-f") o.file = argv[++i];
    else if (a === "--project-directory") o.dir = argv[++i];
    else if (a === "--env-file") o.envFile = argv[++i];
    else if (a === "--ansi") o.ansi = argv[++i];
    else break;
  }
  o.sub = argv.slice(i);
  return o;
}

function containerJson(c) {
  return {
    ID: c.id.slice(0, 12),
    Name: c.name,
    Names: c.name,
    Service: c.service,
    Project: c.project,
    State: c.status,
    Health: c.status === "running" ? (c.health ?? "") : "",
    ExitCode: c.exitCode ?? 0,
    Image: c.image,
    Status: c.status === "running" ? `Up 1 second${c.health ? ` (${c.health})` : ""}` : `Exited (${c.exitCode ?? 0}) 1 second ago`,
    Publishers:
      c.service === "agent" && c.status === "running"
        ? [{ URL: "127.0.0.1", TargetPort: 3000, PublishedPort: c.port, Protocol: "tcp" }]
        : [],
    Labels: `com.docker.compose.project=${c.project},com.docker.compose.service=${c.service}`,
  };
}

function inspectJson(c) {
  const env = [
    `OPEN_AGENT_PORT=${c.port ?? 3000}`,
    `OPEN_AGENT_LAUNCH_TOKEN=${c.token ?? ""}`,
    `OPEN_AGENT_RESET_CREDENTIALS=${c.reset ? "1" : ""}`,
    "COPILOTKIT_TELEMETRY_DISABLED=true",
  ];
  return {
    Id: c.id,
    Created: c.created,
    Name: `/${c.name}`,
    Image: c.imageId,
    RestartCount: 0,
    State: {
      Status: c.status,
      Running: c.status === "running",
      ExitCode: c.exitCode ?? 0,
      StartedAt: c.startedAt ?? "0001-01-01T00:00:00Z",
      ...(c.health && c.status === "running" ? { Health: { Status: c.health } } : {}),
    },
    Config: {
      Image: c.image,
      Env: c.service === "agent" ? env : ["PATH=/usr/bin"],
      Labels: {
        "com.docker.compose.project": c.project,
        "com.docker.compose.service": c.service,
        "com.docker.compose.project.config_files": c.configFiles,
        "com.docker.compose.project.working_dir": c.workingDir,
        "org.opencontainers.image.version": c.version,
      },
    },
    Mounts:
      c.service === "agent"
        ? [
            { Type: "volume", Name: c.dataVolume, Destination: "/data" },
            { Type: "volume", Name: c.keysVolume, Destination: "/keys" },
          ]
        : [],
  };
}

function waitListening(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = connect({ port, host: "127.0.0.1" }, () => {
        s.destroy();
        resolve(true);
      });
      s.on("error", () => {
        s.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tryOnce, 50);
      });
    };
    tryOnce();
  });
}

function spawnAgent(home, c, extra) {
  const child = spawn(process.execPath, [join(HERE, "fake-agent.mjs")], {
    detached: true,
    stdio: "ignore",
    env: {
      OPEN_AGENT_PORT: String(c.port),
      OPEN_AGENT_LAUNCH_TOKEN: extra.tokenOverride ?? c.token ?? "",
      FAKE_AGENT_VERSION: c.version,
      FAKE_HOME: home,
      FAKE_PROJECT: c.project,
      ...(extra.afterReady ? { FAKE_AFTER_READY: extra.afterReady, FAKE_AFTER_MS: String(extra.afterMs) } : {}),
      ...(extra.unhealthy ? { FAKE_UNHEALTHY: "1" } : {}),
    },
  });
  child.unref();
  return child.pid;
}

const out = (s) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
const err = (s) => process.stderr.write(s.endsWith("\n") ? s : `${s}\n`);

function refusalBehaviour(sc, reset) {
  const a = String(sc.agent);
  if (a.startsWith("refuse:")) {
    const code = a.slice(7);
    if (code === "kek_missing" && sc.resetHeals && reset) return { kind: "healthy" };
    return { kind: "refuse", code, exit: sc.refuseExit ?? REFUSAL_EXIT[code] ?? 1 };
  }
  if (a.startsWith("crash:")) return { kind: "crash", exit: Number(a.slice(6)) };
  if (a === "unhealthy" || a === "mismatch" || a === "portInUse") return { kind: a };
  return { kind: "healthy" };
}

const DEPS_DONE = { search: "running", agent: "running", renderer: "running" };

async function composeCmd(home, sc, state, c, env, rec) {
  const project = c.project;
  state.containers[project] ??= {};
  const mine = state.containers[project];
  const sub = c.sub[0];
  const save = () => writeJson(paths(home).state, state);
  const imageFor = (svc) => (svc === "search" ? env.OPEN_AGENT_SEARCH_IMAGE : env.OPEN_AGENT_IMAGE);
  const versionFor = (svc) => sc.refVersions?.[imageFor(svc)] ?? (svc === "search" ? sc.versions.search : sc.versions.agent);

  if (sub === "version") {
    out(c.sub.includes("--short") ? sc.composeVersion : `Docker Compose version v${sc.composeVersion}`);
    return 0;
  }
  if (!daemonUp(home, sc)) {
    err("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
    return 1;
  }
  switch (sub) {
    case "ps": {
      for (const svc of SERVICES) if (mine[svc]) out(JSON.stringify(containerJson(mine[svc])));
      return 0;
    }
    case "up": {
      const force = c.sub.includes("--force-recreate");
      const reset = env.OPEN_AGENT_RESET_CREDENTIALS === "1";
      rec.reset = reset;
      if (sc.noSpace === "up") {
        err("Error response from daemon: failed to create task: write /var/lib/docker/overlay2/x: no space left on device");
        return 1;
      }
      const behaviour = refusalBehaviour(sc, reset);
      if (behaviour.kind === "portInUse") {
        err(
          `Error response from daemon: driver failed programming external connectivity on endpoint ${project}-agent-1: Bind for 127.0.0.1:${env.OPEN_AGENT_PORT} failed: port is already allocated`,
        );
        return 1;
      }
      for (const svc of SERVICES) {
        const prev = mine[svc];
        if (prev?.pid) killPid(prev.pid);
        const same =
          prev &&
          !force &&
          prev.configFiles === c.file &&
          prev.image === imageFor(svc) &&
          prev.token === (svc === "agent" ? env.OPEN_AGENT_LAUNCH_TOKEN : prev.token);
        const now = new Date().toISOString();
        mine[svc] = {
          ...(same ? prev : {}),
          id: same ? prev.id : hex(`${project}-${svc}-${randomBytes(8).toString("hex")}`),
          name: `${project}-${svc}-1`,
          service: svc,
          project,
          image: imageFor(svc),
          imageId: state.images[imageFor(svc)] ?? `sha256:${hex(imageFor(svc))}`,
          configFiles: c.file,
          workingDir: c.dir,
          version: versionFor(svc),
          created: same ? prev.created : now,
          startedAt: now,
          status: "running",
          health: "healthy",
          exitCode: 0,
          pid: undefined,
          logs: [...(same ? (prev.logs ?? []) : []), `${svc} starting`],
          ...(svc === "agent"
            ? {
                token: env.OPEN_AGENT_LAUNCH_TOKEN,
                port: Number(env.OPEN_AGENT_PORT),
                reset,
                dataVolume: env.OPEN_AGENT_DATA_VOLUME,
                keysVolume: env.OPEN_AGENT_KEYS_VOLUME,
              }
            : {}),
        };
      }
      if (sc.slow.upMs) {
        for (const svc of SERVICES) {
          mine[svc].status = "created";
          mine[svc].health = "";
        }
        save();
        await sleep(sc.slow.upMs);
        for (const svc of SERVICES) mine[svc].status = "running";
      }
      const agent = mine.agent;
      if (behaviour.kind === "refuse" || behaviour.kind === "crash") {
        agent.status = "exited";
        agent.health = "";
        agent.exitCode = behaviour.exit;
        agent.logs.push(
          behaviour.kind === "refuse"
            ? `[startup] refused code=${behaviour.code} ${REFUSAL_MESSAGES[behaviour.code] ?? "unknown refusal"}`
            : `Error: boom (env OPEN_AGENT_LAUNCH_TOKEN=${agent.token})`,
        );
        mine.renderer.status = "created";
        mine.renderer.health = "";
        save();
        await sleep(sc.upFailMs);
        err(`dependency failed to start: container ${agent.name} exited (${behaviour.exit})`);
        return 1;
      }
      const afterReady = sc.afterReady && sc.afterReady !== "none" && !state.afterReadyDone ? sc.afterReady : undefined;
      if (afterReady) state.afterReadyDone = true;
      agent.pid = spawnAgent(home, agent, {
        afterReady,
        afterMs: sc.afterReadyMs,
        unhealthy: behaviour.kind === "unhealthy",
        tokenOverride: behaviour.kind === "mismatch" ? randomBytes(32).toString("hex") : undefined,
      });
      if (behaviour.kind === "unhealthy") agent.health = "unhealthy";
      agent.logs.push("[local] listening on 0.0.0.0:3000", "[http] GET /health 200");
      save();
      const up = await waitListening(agent.port, 8000);
      if (!up) {
        err("fake docker: the fake agent did not start");
        return 1;
      }
      if (behaviour.kind === "unhealthy") {
        await sleep(sc.upFailMs);
        err(`dependency failed to start: container ${agent.name} is unhealthy`);
        return 1;
      }
      for (const svc of SERVICES) mine[svc].status = DEPS_DONE[svc];
      save();
      return 0;
    }
    case "start": {
      if (!mine.agent) {
        err("no containers to start");
        return 1;
      }
      const behaviour = refusalBehaviour(sc, false);
      const now = new Date().toISOString();
      for (const svc of SERVICES) {
        if (!mine[svc]) continue;
        mine[svc].status = "running";
        mine[svc].health = "healthy";
        mine[svc].startedAt = now;
        mine[svc].exitCode = 0;
      }
      const agent = mine.agent;
      if (behaviour.kind === "refuse" || behaviour.kind === "crash") {
        agent.status = "exited";
        agent.health = "";
        agent.exitCode = behaviour.exit;
        agent.logs.push(
          behaviour.kind === "refuse" ? `[startup] refused code=${behaviour.code} ${REFUSAL_MESSAGES[behaviour.code]}` : "Error: boom",
        );
        save();
        return 0;
      }
      if (agent.pid) killPid(agent.pid);
      agent.pid = spawnAgent(home, agent, {});
      save();
      await waitListening(agent.port, 8000);
      return 0;
    }
    case "stop": {
      const which = c.sub.slice(1).filter((a) => !a.startsWith("-"));
      for (const svc of which.length ? which : SERVICES) {
        const x = mine[svc];
        if (!x) continue;
        if (x.pid) killPid(x.pid);
        x.pid = undefined;
        if (x.status === "running") x.exitCode = 0;
        x.status = "exited";
        x.health = "";
      }
      save();
      return 0;
    }
    case "down": {
      for (const svc of SERVICES) if (mine[svc]?.pid) killPid(mine[svc].pid);
      if (c.sub.includes("-v"))
        state.removedVolumes = [...(state.removedVolumes ?? []), env.OPEN_AGENT_DATA_VOLUME, env.OPEN_AGENT_KEYS_VOLUME];
      delete state.containers[project];
      save();
      return 0;
    }
    case "logs": {
      const args = c.sub.slice(1);
      const stamps = args.includes("--timestamps");
      const tailAt = args.indexOf("--tail");
      const tail = tailAt >= 0 ? Number(args[tailAt + 1]) : 1000;
      const svcs = args.filter((a, i) => !a.startsWith("-") && !(tailAt >= 0 && i === tailAt + 1));
      for (const svc of svcs.length ? svcs : SERVICES) {
        const x = mine[svc];
        if (!x) continue;
        for (const l of (x.logs ?? []).slice(-tail)) out(`${svc}-1  | ${stamps ? "2026-11-03T10:00:00.000000000Z " : ""}${l}`);
      }
      return 0;
    }
    case "port": {
      const a = mine.agent;
      if (a?.status !== "running") {
        err('service "agent" is not running');
        return 1;
      }
      out(`${sc.portBind}:${a.port}`);
      return 0;
    }
    default:
      err(`fake docker: compose ${sub} is not emulated`);
      return 64;
  }
}

const DEFAULT_STATS = { schema: 1, dbBytes: 3 * 1024 * 1024, reports: 2, chats: 5, reportBytes: 40960 };

async function fakeDb(home, withCredentials) {
  const { DatabaseSync } = await import("node:sqlite");
  const file = join(home, `export-${process.pid}.db`);
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT); CREATE TABLE provider_credentials (provider TEXT, ciphertext BLOB); PRAGMA user_version = 1;",
  );
  db.prepare("INSERT INTO chats (id, title) VALUES (?, ?)").run("c1", "Fake chat");
  if (withCredentials)
    db.prepare("INSERT INTO provider_credentials (provider, ciphertext) VALUES (?, ?)").run("openrouter", Buffer.from("CIPHER"));
  db.close();
  const bytes = readFileSync(file);
  rmSync(file, { force: true });
  return bytes;
}

async function runCmd(home, sc, argv, rec) {
  const at = argv.indexOf("dist/local/dataTools.js");
  if (at < 0 || !argv.includes("--network") || argv[argv.indexOf("--network") + 1] !== "none") {
    err("fake docker: only the no-network dataTools run is emulated");
    return 64;
  }
  const cmd = argv[at + 1];
  rec.dataTools = cmd;
  if (cmd === "stats") {
    out(JSON.stringify(sc.stats ?? DEFAULT_STATS));
    return 0;
  }
  if (cmd === "check") {
    const mount = argv[argv.indexOf("-v") + 1] ?? "";
    const host = mount.replace(/:\/check\/open-agent\.db:ro$/, "");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(host, { readOnly: true });
    const n = db.prepare("SELECT count(*) AS n FROM provider_credentials").get().n;
    const schema = db.prepare("PRAGMA user_version").get().user_version;
    db.close();
    out(JSON.stringify({ credentials: n, schema }));
    return 0;
  }
  if (cmd !== "export") {
    err(`fake docker: dataTools ${cmd} is not emulated`);
    return 64;
  }
  if (sc.noSpace === "export") {
    err("[export] disk full: database or disk is full");
    return 3;
  }
  const mode = sc.export ?? "ok";
  const entries = [
    {
      name: "export.json",
      data: Buffer.from(JSON.stringify({ app: "open-agent", version: sc.versions.agent, schema: 1, kind: "snapshot" })),
    },
    { name: "open-agent.db", data: await fakeDb(home, mode === "withCredentials") },
    { name: "reports/00000000-0000-4000-8000-000000000001/AbCdEfGhIjKl.html", data: Buffer.from("<p id='r'>report</p>") },
  ];
  if (mode === "evil") entries.push({ name: "keys/kek", data: Buffer.from("KEK") });
  const zip = buildZip(entries);
  const write = (b) => new Promise((resolve) => process.stdout.write(b, resolve));
  if (sc.slow.exportMs) {
    await write(zip.subarray(0, 64));
    await sleep(sc.slow.exportMs);
    await write(zip.subarray(64));
  } else await write(zip);
  return 0;
}

function finish(home, rec) {
  appendFileSync(paths(home).calls, `${JSON.stringify(rec)}\n`);
}

export async function main(home, argv) {
  const sc = scenarioOf(home);
  const state = readJson(paths(home).state, {});
  state.containers ??= {};
  state.images ??= {};
  const env = process.env;
  const rec = {
    argv,
    envNames: Object.keys(env).sort(),
    pid: process.pid,
    ...(env.OPEN_AGENT_PORT ? { port: Number(env.OPEN_AGENT_PORT) } : {}),
    ...(env.OPEN_AGENT_LAUNCH_TOKEN ? { tokenFp: fp(env.OPEN_AGENT_LAUNCH_TOKEN) } : {}),
    ...(env.OPEN_AGENT_IMAGE ? { images: { agent: env.OPEN_AGENT_IMAGE, search: env.OPEN_AGENT_SEARCH_IMAGE } } : {}),
  };
  appendFileSync(paths(home).calls, `${JSON.stringify({ ...rec, phase: "start" })}\n`);
  process.on("SIGTERM", () => {
    rec.exitCode = 143;
    rec.signal = "SIGTERM";
    finish(home, rec);
    process.exit(143);
  });
  let code;
  try {
    code = await dispatch(home, sc, state, argv, env, rec);
  } catch (e) {
    err(`fake docker crashed: ${e?.stack ?? e}`);
    code = 70;
  }
  rec.exitCode = code;
  finish(home, rec);
  process.exit(code);
}

async function dispatch(home, sc, state, argv, env, rec) {
  const up = daemonUp(home, sc);
  const cmd = argv[0];
  const down = () => {
    err("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
    return 1;
  };
  switch (cmd) {
    case "version": {
      const client = { Version: sc.clientVersion, Os: "darwin", Arch: "arm64", Context: sc.context };
      if (!up) {
        out(JSON.stringify({ Client: client, Server: null }));
        return down();
      }
      out(JSON.stringify({ Client: client, Server: { Version: sc.clientVersion, Os: sc.serverOs, Arch: sc.serverArch } }));
      return 0;
    }
    case "info":
      if (!up) return down();
      out(JSON.stringify({ ...sc.engine, MemTotal: sc.memTotal, OSType: "linux", Architecture: "aarch64" }));
      return 0;
    case "context":
      if (argv[1] === "show") {
        out(sc.context);
        return 0;
      }
      if (argv[1] === "inspect") {
        const host =
          sc.endpoint === "tcp"
            ? "tcp://192.168.64.2:2376"
            : sc.endpoint === "foreignSocket"
              ? `unix://${sc.foreignSocketPath}`
              : sc.endpoint === "missing"
                ? `unix://${join(home, "missing.sock")}`
                : `unix://${paths(home).socket}`;
        out(JSON.stringify(host));
        return 0;
      }
      return 64;
    case "compose":
      return composeCmd(home, sc, state, parseCompose(argv), env, rec);
    case "image": {
      if (!up) return down();
      if (argv[1] !== "inspect") return 64;
      const ref = argv[argv.length - 1];
      const id = state.images[ref];
      if (!id) {
        err(`Error response from daemon: No such image: ${ref}`);
        return 1;
      }
      const format = argv[argv.indexOf("-f") + 1] ?? "";
      const label = sc.refVersions?.[ref] ?? (ref.includes("search") ? sc.versions.search : sc.versions.agent);
      out(format.includes("image.version") ? label : id);
      return 0;
    }
    case "manifest": {
      const ref = argv[argv.length - 1];
      const layers = Array.from({ length: sc.pull.layers }, (_, i) => ({
        mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        digest: `sha256:${hex(`${ref}-${i}`)}`,
        size: (i + 1) * 50 * 1024 * 1024,
      }));
      const entry = (arch, ls) => ({
        Ref: ref,
        Descriptor: {
          mediaType: "application/vnd.oci.image.manifest.v1+json",
          digest: `sha256:${hex(`${ref}-${arch}`)}`,
          size: 600,
          platform: { architecture: arch, os: arch === "unknown" ? "unknown" : "linux" },
        },
        OCIManifest: { schemaVersion: 2, layers: ls },
      });
      out(
        JSON.stringify(
          [entry("amd64", layers.slice(0, 1)), entry("unknown", [{ digest: `sha256:${hex("att")}`, size: 1000 }]), entry("arm64", layers)],
          null,
          1,
        ),
      );
      return 0;
    }
    case "pull": {
      if (!up) return down();
      const ref = argv[1];
      out(`${ref.split("@")[0].split("/").pop()}: Pulling from ${ref.split("@")[0]}`);
      if (state.images[ref] || sc.pull.alreadyPresent) {
        out(`Digest: sha256:${hex(ref)}`);
        out(`Status: Image is up to date for ${ref}`);
        return 0;
      }
      const ids = Array.from({ length: sc.pull.layers }, (_, i) => hex(`${ref}-${i}`, 12));
      for (const id of ids) out(`${id}: Pulling fs layer`);
      if (sc.slow.pullMs) await sleep(sc.slow.pullMs);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (sc.noSpace === "pull" && i === 1) {
          err(`failed to register layer: write /var/lib/docker/overlay2/${id}/diff/x: no space left on device`);
          return 1;
        }
        if (sc.pull.failAt === i) {
          err(`error pulling image configuration: download failed after attempts=6: dial tcp: lookup registry: no such host`);
          return 1;
        }
        out(`${id}: Downloading [=====>     ]  ${i + 1}MB/${(i + 1) * 2}MB`);
        await sleep(sc.pull.msPerLayer);
        out(`${id}: Verifying Checksum`);
        out(`${id}: Download complete`);
        out(`${id}: Extracting [==========>]  ${(i + 1) * 2}MB/${(i + 1) * 2}MB`);
        out(`${id}: Pull complete`);
      }
      state.images[ref] = `sha256:${hex(`image-${ref}`)}`;
      writeJson(paths(home).state, state);
      out(`Digest: sha256:${hex(ref)}`);
      out(`Status: Downloaded newer image for ${ref}`);
      out(ref);
      return 0;
    }
    case "inspect": {
      if (!up) return down();
      const all = Object.values(state.containers).flatMap((p) => Object.values(p));
      const found = argv
        .slice(1)
        .map((id) => all.find((c) => c.id.startsWith(id)))
        .filter(Boolean);
      out(JSON.stringify(found.map(inspectJson), null, 1));
      return found.length === argv.length - 1 ? 0 : 1;
    }
    case "run":
      if (!up) return down();
      return runCmd(home, sc, argv, rec);
    case "volume": {
      if (!up) return down();
      if (argv[1] !== "rm") return 64;
      state.removedVolumes = [...(state.removedVolumes ?? []), ...argv.slice(2)];
      writeJson(paths(home).state, state);
      for (const v of argv.slice(2)) out(v);
      return 0;
    }
    default:
      err(`fake docker: '${cmd ?? ""}' is not emulated`);
      return 64;
  }
}
