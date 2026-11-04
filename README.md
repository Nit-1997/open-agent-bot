# Open Agent

Open Agent is a research and planning agent that runs on your computer. You chat with it; it searches the web, reads pages and answers with widgets and reports you can save as PDFs. It uses your own model keys, or a local model through Ollama or LM Studio.

**Mac app.** Download `Open-Agent-1.0.0-arm64.dmg` (Apple silicon) or `Open-Agent-1.0.0-x64.dmg` (Intel) from the [latest release](https://github.com/Nit-1997/open-agent-bot/releases/latest), open it and drag "Open Agent" to Applications. It needs Docker Desktop, OrbStack or Colima. The app isn't signed with an Apple Developer ID, so macOS blocks the first open: click "Done", then System Settings → Privacy & Security → "Open Anyway". Every step, with download checks: [docs/INSTALL.md](docs/INSTALL.md).

**No Mac app** (any computer with Docker and Git):

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot
cd open-agent-bot
docker compose up -d --build
```

Then open http://127.0.0.1:3000. Prebuilt images, updates and removal: [section 9 of the install guide](docs/INSTALL.md#9-no-mac-app-any-os-with-docker).

**Security.** Everything stays on your computer: the app listens on 127.0.0.1 only, so other computers can't reach it, and there is no account and no telemetry. Residual risk: other programs that run as you (and, in the browser-only path, other user accounts on this computer) can call the local API and use your chats, reports and saved model keys. The Mac app's launch key keeps other user accounts out. Details: [SECURITY.md](SECURITY.md).

A hosted demo will be linked here later.

## How it works

```
browser or Mac app → agent on 127.0.0.1:<port> (UI + /api + chat stream; Node + pi SDK) → model providers you add in the app
                       ├─ search (SearXNG)
                       ├─ Chromium (guest-mode browsing, inside the agent)
                       └─ renderer (sandboxed Chromium: report thumbnails and PDFs, no secrets)
```

The Mac app (`apps/desktop`) is a thin shell: it starts this stack in your own Docker and shows the UI from 127.0.0.1. The agent never runs inside the app. Chats, reports and settings live in SQLite on a Docker volume.

- What we learned about the stack: `docs/findings.md`

## Run it on your computer

The Mac app and the browser-only path above run the same stack in Docker: no account, no login and no env files. In the browser-only path the first build takes several minutes; then open http://127.0.0.1:3000 and go through onboarding. The stack is the project `open-agent`: `agent` (the app on one port: UI, API and chat stream), `search` (SearXNG) and `renderer` (thumbnails and PDFs).

- **Models.** Add a cloud provider key in Models, or use a model server on this computer through `host.docker.internal`: Ollama `http://host.docker.internal:11434/v1`, LM Studio `http://host.docker.internal:1234/v1`, llama.cpp `http://host.docker.internal:8080/v1`.
- **Port.** `OPEN_AGENT_PORT=3100 docker compose up -d` serves http://127.0.0.1:3100 instead (1024–65535). The port is always bound to 127.0.0.1. `GET /health` answers `{"ok":true,"app":"open-agent","version":…,"schema":…}`.
- **Data.** Chats, reports and settings live in the Docker volume `open-agent-data` (a SQLite file plus a reports folder). The key that encrypts saved model keys lives in a second volume, `open-agent-keys`, mounted only into the agent. `docker compose down` keeps both; `docker compose down -v` deletes both, and with them everything.
- **Back up the keys volume separately.** A backup of `open-agent-data` alone can't decrypt saved model keys, and a backup of both together holds everything needed to use them.
- **Prebuilt images.** `OPEN_AGENT_IMAGE` and `OPEN_AGENT_SEARCH_IMAGE` select prebuilt images. Use them only with `docker compose up -d --no-build`: without `--no-build`, compose builds from source and tags the result with that name.

### Security of the local stack

- The port is published on 127.0.0.1 only, so other computers can't reach it.
- Websites open in your browser can't use it. Every request must name `127.0.0.1:<port>` or `localhost:<port>` as its `Host` (which refuses DNS rebinding), writes must come from that origin, and requests a browser marks as cross-site or same-site are refused. No response carries CORS headers.
- **Any program, and any other user account, on this computer can use the API** by calling the port directly. They get the same access as you: your chats, your reports, and your saved model keys (used, never shown). This is the same trade-off as other local developer tools. The Mac app adds a launch token that keeps out other user accounts and programs that can't use Docker.
- With `OPEN_AGENT_LAUNCH_TOKEN` set (the Mac app sets it), every `/api` request needs the matching `oa_launch` cookie. Opening `http://127.0.0.1:<port>` in a plain browser then still loads the pages, but every API call gets 401 `launch_required`, so the UI there stops working. Unset the variable to use a browser.
- The `search` and `renderer` containers can reach the agent inside Docker. Both run images this stack pins, and neither runs your or the model's code outside Chromium's sandbox, so they are trusted.

### Reset saved model keys

If the key file in `open-agent-keys` is missing while the database still holds saved model keys, the agent refuses to start with `kek_missing`, because it never creates a new key over keys it can't read. Restore the keys volume, or delete the saved keys and re-enter them in Models:

```bash
OPEN_AGENT_RESET_CREDENTIALS=1 docker compose up -d
```

The variable acts only while the key file is missing, so leaving it set does nothing afterwards. A **wrong** keys volume (for example from another install) is present but can't decrypt the saved keys; reset doesn't apply, because the key file isn't missing. Saved keys then fail when used: remove and re-add each one in Models.

### Startup errors

When the agent can't start safely it prints one line, `[startup] refused code=<code> <message>`, and exits with a fixed code. It retries three times and then stays stopped. See it with `docker compose ps -a`, `docker compose logs agent | grep 'startup] refused'` or `docker inspect -f '{{.State.ExitCode}}' open-agent-agent-1`.

| Code | Exit | What to do |
| --- | --- | --- |
| `config` | 78 | A setting is invalid, or a setting of the hosted deployment is set. Fix or unset the variable the message names |
| `db_corrupt` | 79 | The database failed its integrity check. Restore `open-agent-data` from a backup |
| `db_newer` | 80 | A newer Open Agent wrote the database. Run that version or newer |
| `db_migration` | 81 | An upgrade failed and was rolled back; the message names the backup in `/data/backups`. Report the line as a bug |
| `kek_missing` | 82 | The key file is missing while saved model keys exist. Restore `open-agent-keys`, or reset as above |
| `keyfile_invalid` | 83 | A key file is a symlink, not a regular file, readable by others, owned by someone else or malformed. Fix the path the message names (for example `chmod 600`); it is never replaced on its own |
| `ui_missing` | 84 | The image has no UI build. Rebuild with `docker compose build` |
| `identity` | 85 | Internal wiring error. Report it as a bug |
| `listen` | 86 | Only when the entry runs outside compose (`OPEN_AGENT_LISTEN_PORT`, the Mac app): the port is in use or can't be opened. Free it or pick another. Under compose a busy host port fails earlier, when Docker publishes the port (`docker compose up` reports `port is already allocated` or `address already in use`), and the agent never starts; pick another `OPEN_AGENT_PORT` |

## Search and pictures

- Web search goes through SearXNG. Some engines rate-limit or CAPTCHA a home IP; Yahoo, Bing, Google, Qwant, Mojeek and Startpage are enabled so one working engine is enough.
- Optional fallback: add a Brave Search API key in the app (Models → Web search; free tier at brave.com/search/api) and it is used whenever SearXNG returns nothing.
- Pictures come from the pages the agent reads (`images:` section), `image_search` (SearXNG images), `music` (iTunes Search: album and song art, Apple Music links) and `wikipedia` (places, people, topics). No keys needed.
- Cards show an image or link only if a tool returned it; otherwise the image is dropped and a placeholder is shown.

## Skills, Jev and codemode

- **Follow-ups**: the model ends its answer with `<followups>a | b</followups>`; the agent turns that line into the buttons under the reply.
- **Skills** live in `packages/core/skills/<name>/SKILL.md` (frontmatter `name`, `description`, then a playbook). The core prompt lists them and the agent loads one with `load_skill`. A new use case is a new folder; no code change.
- **Jev** (TypeSafe's calibrated classifier) judges product matches in `shop`, hotel brand/area/vibe wishes in `stays`, music cover art, which search hits to read, and research claims. It uses whichever key you added in the app: TypeSafe first, then OpenRouter. If Jev is unreachable, every feature falls back to its non-Jev behavior.
- **Codemode**: Claude Sonnet models (from any provider) can write one script that runs many lookups and does the maths in code. A failed script turns codemode off for the rest of that chat.
- **Workspace and chats**: Chats and their messages are saved in the local database, and a chat continues after a restart. Carts, trips, events and shortlists are working state for the conversation: they live in the agent's session only. Cards from earlier sessions stay in the chat, read-only and dated; ask again for fresh prices. The app shell has a sidebar of chats (Today, This week, Earlier), and its own views for **Reports** (every report, with PDF download) and **Search** (chat titles, message text and report titles). Every view has a URL. A report shows in the chat as a card with a thumbnail and opens in a resizable panel beside the chat (an overlay on tablets, a full-screen viewer on phones), with previous/next, PDF and a new-tab link; the open report is in the URL, and the agent knows which report is open, so "what's the cheapest option in this report?" just works.
- **Your agent**: users name their agent, pick its look and how it talks (brief, warm or thorough) in the first onboarding step or the profile drawer. The name and tone go into the system prompt as a quoted name under the hard rules.

Results: `docs/findings.md`.

## Develop

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks, the code layout, the Mac app, tests and evals on the local stack, and how to add a tool.
- [docs/RELEASING.md](docs/RELEASING.md): how a release is made (owner only).
- [cloud/README.md](cloud/README.md): the invite-only hosted deployment (Supabase, Vercel, EC2), its end-to-end checks and evals.
- Report security issues as described in [SECURITY.md](SECURITY.md).

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.
- Thumbnails and PDFs are made by the `renderer` service: a non-root, read-only container with Chromium's sandbox on (Playwright's seccomp profile, `cap_drop: ALL` plus `SYS_CHROOT` for the sandbox), no secrets but `RENDERER_SECRET`, and only the agent can reach it (an internal `render` network). Its Chromium resolves only `fonts.googleapis.com` and `fonts.gstatic.com`, aborts every other request, and the report's resource hints, speculation rules and `meta refresh` are stripped first.

## License

[MIT](LICENSE)
