#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.OPEN_AGENT_PORT);
const version = process.env.FAKE_AGENT_VERSION ?? "0.0.0-fake";
const stackFile = process.env.FAKE_STACK_FILE;
const fakeHome = process.env.FAKE_HOME;
const fakeProject = process.env.FAKE_PROJECT;
let unhealthy = process.env.FAKE_UNHEALTHY === "1";
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  process.stderr.write("fake-agent: OPEN_AGENT_PORT must be a port\n");
  process.exit(2);
}

const REPORT_ID = "AbCdEfGhIjKl";
const other = port + 1;

function expectedToken() {
  if (process.env.OPEN_AGENT_LAUNCH_TOKEN) return process.env.OPEN_AGENT_LAUNCH_TOKEN;
  if (!stackFile) return undefined;
  try {
    return JSON.parse(readFileSync(stackFile, "utf8")).launchToken;
  } catch {
    return undefined;
  }
}

function cookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

const page = (title, body, script = "") => `<!doctype html>
<html id="fa-html" lang="en"><head id="fa-head"><meta id="fa-charset" charset="utf-8"><title id="fa-title">${title}</title></head>
<body id="fa-body">${body}${script ? `<script id="fa-script" src="${script}"></script>` : ""}</body></html>`;

const HOME = page(
  "Fake agent",
  `<h1 id="fa-heading">Fake agent on ${port}</h1>
<a id="fa-external-blank" href="https://example.com/oa-external" target="_blank">external (new window)</a>
<a id="fa-external-same" href="https://example.com/oa-external">external (same window)</a>
<a id="fa-localhost" href="http://localhost:${port}/">localhost</a>
<a id="fa-other-port" href="http://127.0.0.1:${other}/">other port</a>
<a id="fa-redirect" href="/redirect-other">redirect to other port</a>
<a id="fa-report" href="/api/artifacts/${REPORT_ID}" target="_blank">report</a>
<a id="fa-download" href="/download/report.pdf" download>download</a>
<a id="fa-download-data" href="data:text/plain,cross-origin" download="cross.txt">cross-origin download</a>
<button id="fa-window-open" type="button">window.open</button>
<button id="fa-open-loop" type="button">window.open x20</button>
<button id="fa-fw-fetch" type="button">fetch other port</button>
<button id="fa-fw-fetch-localhost" type="button">fetch localhost</button>
<button id="fa-fw-ws" type="button">websocket other port</button>
<button id="fa-fw-ws-localhost" type="button">websocket localhost</button>
<button id="fa-fw-img" type="button">img other port</button>
<button id="fa-fw-img-localhost" type="button">img localhost</button>
<button id="fa-hid" type="button">hid</button>
<button id="fa-serial" type="button">serial</button>
<button id="fa-usb" type="button">usb</button>
<button id="fa-bluetooth" type="button">bluetooth</button>
<button id="fa-display" type="button">display media</button>
<button id="fa-notify" type="button">notification</button>
<button id="fa-geo" type="button">geolocation</button>
<button id="fa-open-services" type="button">Services &amp; data</button>
<pre id="fa-out"></pre>`,
  "/fake.js",
);

const SCRIPT = `
const out = (k, v) => { window.__fa = { ...(window.__fa || {}), [k]: v }; document.getElementById("fa-out").textContent = JSON.stringify(window.__fa); };
const settle = async (k, f) => { try { out(k, { ok: true, value: String(await f()) }); } catch (e) { out(k, { ok: false, error: String(e && e.name || e) }); } };
const on = (id, f) => document.getElementById(id).addEventListener("click", f);
on("fa-window-open", () => out("windowOpen", window.open("/x") === null ? "null" : "window"));
on("fa-open-loop", () => { for (let i = 0; i < 20; i++) window.open("https://example.com/oa-loop"); out("loop", "done"); });
on("fa-fw-fetch", () => settle("fetch", () => fetch("http://127.0.0.1:${other}/hit-fetch").then((r) => r.status)));
on("fa-fw-fetch-localhost", () => settle("fetchLocalhost", () => fetch("http://localhost:${port}/health").then((r) => r.status)));
const ws = (k, url) => settle(k, () => new Promise((res, rej) => { const s = new WebSocket(url); s.onopen = () => res("open"); s.onerror = () => rej(new Error("ws_error")); }));
on("fa-fw-ws", () => ws("ws", "ws://127.0.0.1:${other}/hit-ws"));
on("fa-fw-ws-localhost", () => ws("wsLocalhost", "ws://localhost:${port}/hit-ws"));
const img = (k, url) => settle(k, () => new Promise((res, rej) => { const i = new Image(); i.id = "fa-img-" + k; i.onload = () => res("load"); i.onerror = () => rej(new Error("img_error")); i.src = url; document.body.append(i); }));
on("fa-fw-img", () => img("img", "http://127.0.0.1:${other}/hit-img.png"));
on("fa-fw-img-localhost", () => img("imgLocalhost", "http://localhost:${port}/hit-img.png"));
on("fa-hid", () => settle("hid", () => navigator.hid.requestDevice({ filters: [] }).then((d) => d.length)));
on("fa-serial", () => settle("serial", () => navigator.serial.requestPort()));
on("fa-usb", () => settle("usb", () => navigator.usb.requestDevice({ filters: [] })));
on("fa-bluetooth", () => settle("bluetooth", () => navigator.bluetooth.requestDevice({ acceptAllDevices: true })));
on("fa-display", () => settle("display", () => navigator.mediaDevices.getDisplayMedia({ video: true })));
on("fa-notify", () => settle("notify", () => Notification.requestPermission()));
on("fa-open-services", () => window.openAgentDesktop.openServices());
on("fa-geo", () => settle("geo", () => new Promise((res, rej) => navigator.geolocation.getCurrentPosition(() => res("granted"), (e) => rej(new Error("geo_" + e.code)), { timeout: 5000 }))));
`;

const REPORT = page(
  "Report",
  `<h1 id="fa-report-heading">Report ${REPORT_ID}</h1><a id="fa-report-external" href="https://example.com/oa-report-external">external</a>`,
);
const FRAME = page("Frame", `<p id="fa-frame-text">same-origin frame</p>`);

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const authed = () => {
    const expected = expectedToken();
    return expected !== undefined && cookie(req, "oa_launch") === expected;
  };
  switch (url.pathname) {
    case "/health":
      if (unhealthy) return send(res, 503, "application/json", JSON.stringify({ ok: false }));
      return send(res, 200, "application/json", JSON.stringify({ ok: true, app: "open-agent", version, schema: 1 }));
    case "/":
      return send(res, 200, "text/html; charset=utf-8", HOME);
    case "/fake.js":
      return send(res, 200, "text/javascript", SCRIPT);
    case "/frame":
      return send(res, 200, "text/html; charset=utf-8", FRAME);
    case "/x":
      return send(res, 200, "text/html; charset=utf-8", page("x", `<p id="fa-x">x</p>`));
    case "/redirect-other":
      res.writeHead(302, { location: `http://127.0.0.1:${other}/hit-redirect` });
      return res.end();
    case `/api/artifacts/${REPORT_ID}`:
      return send(res, 200, "text/html; charset=utf-8", REPORT);
    case "/download/report.pdf":
      return send(res, 200, "application/pdf", "%PDF-1.4 fake\n", { "content-disposition": 'attachment; filename="report.pdf"' });
    case "/api/whoami":
    case "/api/chats":
      if (!authed()) return send(res, 401, "application/json", JSON.stringify({ error: "launch_required" }));
      return send(
        res,
        200,
        "application/json",
        url.pathname === "/api/chats" ? JSON.stringify({ items: [] }) : JSON.stringify({ user: "local" }),
      );
    case "/api/flaky401":
      return send(res, 401, "text/plain", "nope");
    default:
      return send(res, 404, "text/plain", "not found");
  }
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`fake-agent listening ${port}\n`));

function updateAgent(patch, log) {
  if (!fakeHome || !fakeProject) return;
  const file = join(fakeHome, "state.json");
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    const agent = state.containers?.[fakeProject]?.agent;
    if (!agent) return;
    Object.assign(agent, patch);
    if (log) agent.logs = [...(agent.logs ?? []), log];
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 1));
    renameSync(tmp, file);
  } catch {}
}

const REFUSAL_LINES = {
  82: "[startup] refused code=kek_missing the credential key /keys/kek is missing but the database holds 1 saved model key sealed with it. Restore the keys volume, or start once with OPEN_AGENT_RESET_CREDENTIALS=1 to delete them and re-enter them in Models",
};

const after = process.env.FAKE_AFTER_READY;
if (after) {
  setTimeout(
    () => {
      if (after === "daemonDown") {
        if (fakeHome) writeFileSync(join(fakeHome, "daemon.txt"), "down");
        updateAgent({ status: "exited", exitCode: 0, health: "", pid: undefined });
        process.exit(0);
      } else if (after.startsWith("agentExit:")) {
        const code = Number(after.slice(10));
        updateAgent({ status: "exited", exitCode: code, health: "", pid: undefined }, REFUSAL_LINES[code] ?? `fatal: exiting with ${code}`);
        process.exit(code);
      } else if (after === "unhealthy") {
        unhealthy = true;
        updateAgent({ health: "unhealthy" });
      }
    },
    Number(process.env.FAKE_AFTER_MS ?? 2500),
  );
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));
