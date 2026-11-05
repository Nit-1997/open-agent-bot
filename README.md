# Open Agent

Open Agent is a research and planning agent that runs on your computer. You chat with it; it searches the web, reads pages and answers with widgets and reports you can save as PDFs. It uses your own model keys, or a local model through Ollama or LM Studio.

**You see every step.** Every search, every page it reads, and every claim it checks shows up live in the chat, so you can tell where an answer came from. MIT licensed, no account, no telemetry.

**Mac app.** Download `Open-Agent-1.0.0-arm64.dmg` (Apple silicon) from the [latest release](https://github.com/Nit-1997/open-agent-bot/releases/latest), open it and drag "Open Agent" to Applications. It needs Docker Desktop, OrbStack or Colima. The app isn't signed with an Apple Developer ID, so macOS blocks the first open: click "Done", then System Settings → Privacy & Security → "Open Anyway". Every step, with download checks: [docs/INSTALL.md](docs/INSTALL.md). Intel Macs aren't supported by the Mac app; use the Docker Compose path below.

**No Mac app** (any computer with Docker and Git):

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot
cd open-agent-bot
docker compose up -d --build
```

Then open http://127.0.0.1:3000. Prebuilt images, updates and removal: [section 9 of the install guide](docs/INSTALL.md#9-no-mac-app-any-os-with-docker).

**Security.** Everything stays on your computer: the app listens on 127.0.0.1 only, so other computers can't reach it, and there is no account and no telemetry. Residual risk: other programs that run as you (and, in the browser-only path, other user accounts on this computer) can call the local API and use your chats, reports and saved model keys. The Mac app's launch key keeps other user accounts out. Details: [SECURITY.md](SECURITY.md).

A hosted demo will be linked here later.

## Start here

| You are | You want | Go to |
| --- | --- | --- |
| **Someone who wants a research assistant** | Answers you can check, trip and shopping plans, one-page reports, on your own computer | [What it does](#what-it-does), then the Mac app above |
| **Someone who cares where their data goes** | A local agent with no account, your own keys, or a model that never leaves your machine | [Run it on your computer](#run-it-on-your-computer) |
| **An engineer building agents** | A working agent harness: tools, skills, a checked research workflow, live UI over AG-UI | [The agent harness](#the-agent-harness) and [Architecture](#architecture) |
| **A contributor** | Add a tool, a skill or a store, run the tests and evals | [Develop](#develop) |

## What it does

- **Research with checked claims.** Ask a question that needs sources and it runs a research workflow: it searches, reads the best hits, writes a report, then checks every claim against the pages it read. Claims it can't support are removed or flagged, and the chat says how many ("Checked 32 claims · 30 supported · 2 removed").
- **Reports you keep.** Reports open in a panel next to the chat, with thumbnails, previous/next, a PDF download and a link to open them in a new tab. A Reports view lists every report you've made.
- **Plans, not just text.** Trips (flights, stays, weather, drive times), dinners out, parties, gifts, grocery runs and music picks come back as cards and widgets you can act on.
- **Watch it work.** Searches, pages and tool calls stream into the chat as they happen.
- **Any model.** A ChatGPT plan, API keys for OpenAI, Anthropic, OpenRouter, Google Gemini, Groq, Together AI or TypeSafe, or a local model through Ollama, LM Studio, llama.cpp, LiteLLM or any OpenAI-compatible server.
- **Your agent.** Name it, pick its look and how it talks (brief, warm or thorough). Chats are saved and searchable, and continue after a restart.
- **Read-only on the web.** The browser works as a guest and refuses checkout, payment, login, sign-up and booking steps: it hands you the link instead.

## Architecture

```
browser or Mac app → agent on 127.0.0.1:<port> (UI + /api + chat stream; Node + pi SDK) → model providers you add in the app
                       ├─ search (SearXNG)
                       ├─ Chromium (guest-mode browsing, inside the agent)
                       └─ renderer (sandboxed Chromium: report thumbnails and PDFs, no secrets)
```

The Mac app (`apps/desktop`) is a thin shell: it starts this stack in your own Docker and shows the UI from 127.0.0.1. The agent never runs inside the app. Chats, reports and settings live in SQLite on a Docker volume.

Three containers, in the Docker project `open-agent`:

| Container | Role |
| --- | --- |
| `agent` | The whole app on one port: the UI, the `/api` routes, the chat stream and the agent itself. Runs guest-mode Chromium for the browser tool. Holds the database and the encrypted model keys |
| `search` | [SearXNG](https://github.com/searxng/searxng), a metasearch engine. No search API key needed |
| `renderer` | Sandboxed Chromium that turns reports into thumbnails and PDFs. Holds no secrets and only the agent can reach it |

The code is an npm workspace:

| Path | What it is |
| --- | --- |
| `packages/core` | The agent: harness, tools, skills, research workflow, model providers, SQLite store, HTTP server |
| `packages/ui` | The React chat UI: chats, cards and widgets, reports, models, onboarding |
| `packages/bff` | The `/api` handlers and the chat stream proxy, shared by the local app and the hosted web app |
| `packages/shared` | Types and rules shared by the agent and the UI |
| `packages/local-web` | The Vite build of the UI that the agent serves on 127.0.0.1 |
| `apps/desktop` | The Electron Mac shell |
| `cloud/` | The hosted sandbox only. The local app never imports it |

More on what we learned building it, with measurements: `docs/findings.md`.

## The agent harness

The agent runs on the [pi](https://github.com/earendil-works/pi) agent SDK (`@earendil-works/pi-coding-agent`) and streams to the UI over [AG-UI](https://docs.ag-ui.com/) through the [CopilotKit](https://www.copilotkit.ai/) runtime, which runs inside the agent at `/copilotkit`.

**Tools.** The model calls these; each one has a per-reply budget so a single answer can't loop forever.

| Tool | What it does |
| --- | --- |
| `web_search`, `image_search` | Search through SearXNG, with Brave Search as an optional fallback |
| `fetch_page` | Read a page as clean text, with its images |
| `browse` | Drive a guest-mode Chromium tab for pages that need clicking. Refuses checkout, login and booking |
| `research` | The checked research workflow: search, read, write, verify every claim, publish a report |
| `create_artifact` | Publish a report or page, shown sandboxed |
| `show_ui` | Show a card or widget in the chat |
| `shop`, `stays`, `flights` | Product, hotel and flight search across the sources registry |
| `weather`, `wikipedia`, `music` | Forecasts, places and people, album and song art with Apple Music links |
| `plan`, `ask_user` | Keep the chat's trips, events and shortlists; show a short form to confirm dates, guests or budget before searching |
| `load_skill` | Load a skill's playbook when the task needs it |

**Skills.** A skill is a folder, `packages/core/skills/<name>/SKILL.md`, with a `name`, a `description` and a playbook. The prompt lists them and the agent loads one with `load_skill`. Today: research, trip planning, dining out, party planning, gift ideas, grocery runs, music, and judging (maths and comparisons in codemode). A new use case is a new folder; no code change.

**Codemode.** Claude Sonnet models (from any provider) can write one script that runs many lookups and does the maths in code, instead of one tool call at a time. On a 12-lookup fan-out test it got 8 of 8 right, about 30% cheaper and 3 seconds faster than one call at a time (`docs/findings.md`). A failed script turns codemode off for the rest of that chat.

**Jev.** TypeSafe's calibrated classifier judges which search hits to read, research claims, product matches in `shop`, hotel wishes in `stays` and music cover art. It uses whichever key you added: TypeSafe first, then OpenRouter. If Jev is unreachable, every feature falls back to its non-Jev behaviour.

**Follow-ups.** The model ends its answer with `<followups>a | b</followups>`; the agent turns that line into the buttons under the reply.

**Workspace.** Chats and messages are saved in the local database. Carts, trips, events and shortlists are working state for the conversation and live in the agent's session only. Cards from earlier sessions stay in the chat, read-only and dated; ask again for fresh prices. The agent knows which report is open, so "what's the cheapest option in this report?" just works.

**Your agent.** The name and tone you pick in onboarding go into the system prompt as a quoted name under the hard rules.

## Run it on your computer

The Mac app and the browser-only path above run the same stack in Docker: no account, no login and no env files. In the browser-only path the first build takes several minutes; then open http://127.0.0.1:3000 and go through onboarding. The stack is the project `open-agent`: `agent` (the app on one port: UI, API and chat stream), `search` (SearXNG) and `renderer` (thumbnails and PDFs).

- **Models.** Add a cloud provider key in Models, or use a model server on this computer through `host.docker.internal`: Ollama `http://host.docker.internal:11434/v1`, LM Studio `http://host.docker.internal:1234/v1`, llama.cpp `http://host.docker.internal:8080/v1`.
- **Port.** `OPEN_AGENT_PORT=3100 docker compose up -d` serves http://127.0.0.1:3100 instead (1024–65535). The port is always bound to 127.0.0.1. `GET /health` answers `{"ok":true,"app":"open-agent","version":…,"schema":…}`.
- **Data.** Chats, reports and settings live in the Docker volume `open-agent-data` (a SQLite file plus a reports folder). The key that encrypts saved model keys lives in a second volume, `open-agent-keys`, mounted only into the agent. `docker compose down` keeps both; `docker compose down -v` deletes both, and with them everything.
- **Back up the keys volume separately.** A backup of `open-agent-data` alone can't decrypt saved model keys, and a backup of both together holds everything needed to use them.
- **Prebuilt images.** `OPEN_AGENT_IMAGE` and `OPEN_AGENT_SEARCH_IMAGE` select prebuilt images. Use them only with `docker compose up -d --no-build`: without `--no-build`, compose builds from source and tags the result with that name.

### Search and pictures

- Web search goes through SearXNG. Some engines rate-limit or CAPTCHA a home IP; Yahoo, Bing, Google, Qwant, Mojeek and Startpage are enabled so one working engine is enough.
- Optional fallback: add a Brave Search API key in the app (Models → Web search; free tier at brave.com/search/api) and it is used whenever SearXNG returns nothing.
- Pictures come from the pages the agent reads (`images:` section), `image_search` (SearXNG images), `music` (iTunes Search: album and song art, Apple Music links) and `wikipedia` (places, people, topics). No keys needed.
- Cards show an image or link only if a tool returned it; otherwise the image is dropped and a placeholder is shown.

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

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.
- Thumbnails and PDFs are made by the `renderer` service: a non-root, read-only container with Chromium's sandbox on (Playwright's seccomp profile, `cap_drop: ALL` plus `SYS_CHROOT` for the sandbox), no secrets but `RENDERER_SECRET`, and only the agent can reach it (an internal `render` network). Its Chromium resolves only `fonts.googleapis.com` and `fonts.gstatic.com`, aborts every other request, and the report's resource hints, speculation rules and `meta refresh` are stripped first.

## Develop

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks, the code layout, the Mac app, tests and evals on the local stack, and how to add a tool, a skill or a source.
- [docs/RELEASING.md](docs/RELEASING.md): how a release is made (owner only).
- `make run app` builds the Mac app from this checkout and opens it (Docker must be running); `make run web` runs the hosted stack on this machine at http://localhost:18300 (it needs the hosted env files described in cloud/README.md); `make stop` stops both; `make help` lists them.
- [cloud/README.md](cloud/README.md): the hosted sandbox (Supabase, Vercel, EC2), its limits, end-to-end checks and evals.
- Report security issues as described in [SECURITY.md](SECURITY.md).

## Documentation

| Guide | Covers |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | Installing the Mac app or the Docker stack, checking downloads, updates and removal |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability, verifying a download, what the local stack and the Mac app protect |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Layout, conventions, tests, evals, adding tools and sources |
| [docs/findings.md](docs/findings.md) | What we measured and learned building the agent |
| [docs/RELEASING.md](docs/RELEASING.md) | The release runbook |

## License

[MIT](LICENSE)
