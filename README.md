# Open Agent Bot

Personal, read-only research and planning agent: chat, widgets, and HTML artifacts.

```
web (Next.js + @oab/ui) → @oab/bff (/api) → agent /copilotkit (CopilotKit runtime) → AG-UI run (Node + pi SDK) → model providers you add in the app
                                        ├─ search (SearXNG)
                                        ├─ Chromium (guest-mode browsing)
                                        └─ renderer (sandboxed Chromium: report thumbnails and PDFs, no secrets)
```

- Design: `docs/superpowers/specs/2026-10-27-open-agent-bot-design.md`
- What we learned about the stack: `docs/findings.md`

## Run it on your computer

You need Docker and nothing else: no account, no login and no env files.

```bash
docker compose up -d --build
```

Then open http://127.0.0.1:3000 and go through onboarding. The first build takes several minutes. The stack is the project `open-agent`: `agent` (the app on one port: UI, API and chat stream), `search` (SearXNG) and `renderer` (thumbnails and PDFs).

- **Models.** Add a cloud provider key in Models, or use a model server on this computer through `host.docker.internal`: Ollama `http://host.docker.internal:11434/v1`, LM Studio `http://host.docker.internal:1234/v1`, llama.cpp `http://host.docker.internal:8080/v1`.
- **Port.** `OPEN_AGENT_PORT=3100 docker compose up -d` serves http://127.0.0.1:3100 instead. The port is always bound to 127.0.0.1.
- **Data.** Chats, reports and settings live in the Docker volume `open-agent-data` (a SQLite file plus a reports folder). The key that encrypts saved model keys lives in a second volume, `open-agent-keys`, mounted only into the agent. `docker compose down` keeps both; `docker compose down -v` deletes both, and with them everything.
- **Back up the keys volume separately.** A backup of `open-agent-data` alone can't decrypt saved model keys, and a backup of both together holds everything needed to use them.
- **Prebuilt images.** `OPEN_AGENT_IMAGE` and `OPEN_AGENT_SEARCH_IMAGE` select prebuilt images. Use them only with `docker compose up -d --no-build`: without `--no-build`, compose builds from source and tags the result with that name.

### Security of the local stack

- The port is published on 127.0.0.1 only, so other computers can't reach it.
- Websites open in your browser can't use it. Every request must name `127.0.0.1:<port>` or `localhost:<port>` as its `Host` (which refuses DNS rebinding), writes must come from that origin, and requests a browser marks as cross-site or same-site are refused. No response carries CORS headers.
- **Any program, and any other user account, on this computer can use the API** by calling the port directly. They get the same access as you: your chats, your reports, and your saved model keys (used, never shown). This is the same trade-off as other local developer tools. The Mac app adds a launch token that keeps out other user accounts and programs that can't use Docker.
- With `OPEN_AGENT_LAUNCH_TOKEN` set (the Mac app sets it), every `/api` request needs the matching `oa_launch` cookie. Opening http://127.0.0.1:<port> in a plain browser then still loads the pages, but every API call gets 401 `launch_required`, so the UI there stops working. Unset the variable to use a browser.
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
| `config` | 78 | A setting is invalid, or a hosted setting (`SUPABASE_*`, `AGENT_SERVICE_SECRET`, `CREDENTIAL_KEYS`) is set. Fix or unset the variable the message names |
| `db_corrupt` | 79 | The database failed its integrity check. Restore `open-agent-data` from a backup |
| `db_newer` | 80 | A newer Open Agent wrote the database. Run that version or newer |
| `db_migration` | 81 | An upgrade failed and was rolled back; the message names the backup in `/data/backups`. Report the line as a bug |
| `kek_missing` | 82 | The key file is missing while saved model keys exist. Restore `open-agent-keys`, or reset as above |
| `keyfile_invalid` | 83 | A key file is a symlink, not a regular file, readable by others, owned by someone else or malformed. Fix the path the message names (for example `chmod 600`); it is never replaced on its own |
| `ui_missing` | 84 | The image has no UI build. Rebuild with `docker compose build` |
| `identity` | 85 | Internal wiring error. Report it as a bug |

## Run the hosted stack

> **Warning.** The root `docker-compose.yml` is the local stack (project `open-agent`). Every hosted command needs `-f compose.hosted.yml`: bare `docker compose ps`, `logs`, `down`, `restart` and `up` target the local project, not the hosted one. `compose.hosted.yml` pins the project name `open-agent-bot`, so the existing containers and volumes are reused.

Open Agent is invite-only. Accounts, sessions and every user's data live in one Supabase project; the agent and the web app keep nothing on disk.

1. Install Docker, Node 22 and `jq` (the preview preflight uses it).
2. Fill in the env files (git-ignored; templates with names only are in `deploy-config/env.examples/`):
   - `deploy-config/.env-agent`: Supabase URL and keys, `AGENT_SERVICE_SECRET` (`openssl rand -hex 32`), `CREDENTIAL_KEYS` (`v1:` + `openssl rand -base64 32`), `ACCESS_REQUEST_PEPPER` (`openssl rand -base64 32`), `APP_ORIGIN=https://app.localhost`.
   - `deploy-config/.env-renderer`: only `RENDERER_SECRET` (`openssl rand -hex 32`); put the same value in `.env-agent`.
   - `deploy-config/.env-nextjs`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, and the same `AGENT_SERVICE_SECRET`.
   - `deploy-config/env-files/.env-supabase-admin` (owner's machine only): the Management API token, the `admin_scripts` secret key, Google OAuth client, Resend key.
3. Set up Supabase once: apply `supabase/migrations/` in order, then `set -a; . deploy-config/env-files/.env-supabase-admin; set +a; node supabase/scripts/configure-auth.mjs --apply` and `node supabase/scripts/bootstrap-admin.mjs <your email>`.
4. `docker compose -f compose.hosted.yml --env-file deploy-config/.env-nextjs --profile local up -d --build` (the env file feeds the web image's `NEXT_PUBLIC_*` build args).
5. Trust Caddy's local CA once: `docker compose -f compose.hosted.yml cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`.
6. Open https://app.localhost and sign in with Google using the bootstrapped email. The agent is at https://agent.localhost (it needs the service secret and a user token).

Visitors ask for access at `/request-access`; the admin approves them at `/admin`, which sends the invite email. Users add their own model keys in the app; keys are encrypted by the agent and never sent back to the browser.

To run a preview beside a running stack, work in a second checkout or worktree, never the one that runs the stack. In that checkout, first create a git-ignored root `.env` containing `COMPOSE_PROJECT_NAME=oab-<name>` (`printf 'COMPOSE_PROJECT_NAME=oab-guard\n' > .env`), so unqualified compose commands there never reach the live project; `docker compose config --format json | jq -r .name` must print that name. Then use another project name and the preview override: `. scripts/preview-preflight.sh`, `P="docker compose -p oab-preview --env-file .env --env-file deploy-config/.env-nextjs -f compose.hosted.yml -f deploy-config/compose.preview.yml --profile local"`, `preflight $P && $P up -d --build search renderer agent web` (agent on 127.0.0.1:18800, web on http://localhost:18300). `preflight` returns 1 unless the project name starts with `oab-`, every published port is on 127.0.0.1 and at 18000 or above, and any `PREVIEW_AGENT_PORT` / `PREVIEW_WEB_PORT` is in 18000–19999; scripts call it as `preflight … || exit 1`. For a second local stack, use `-p oab-<name>` with `OPEN_AGENT_PORT` in 18000–19999 and `OPEN_AGENT_DATA_VOLUME` / `OPEN_AGENT_KEYS_VOLUME` starting with `oab-`; `preflight` refuses any volume name that doesn't start with `oab-`.

Ports bound to 127.0.0.1: Caddy 80/443 and the agent's 8000 for debugging (LiteLLM 4000 and Ollama 11434 when turned on). SearXNG is reachable only from the agent.

The agent refuses to start if a provider key such as `OPENAI_API_KEY` is set in its environment, because it would serve every user. The operator LiteLLM gateway (`LLM_API_KEY`) and private-network model servers are available to the admin only.

### Deploy

The web app runs on Vercel (Root Directory `web`, "Include files outside the root directory" on, Production env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `AGENT_URL=https://<AGENT_HOST>`, `AGENT_SERVICE_SECRET`; nothing for Preview). The agent, SearXNG and Caddy run on EC2: create `deploy-config/.env-agent` (same `CREDENTIAL_KEYS` and pepper as local, `APP_ORIGIN=https://<APP_HOST>`, a new `RENDERER_SECRET`), `deploy-config/.env-renderer` (that `RENDERER_SECRET` only) and `deploy-config/.env-caddy` (`AGENT_HOST`, `ACME_EMAIL`), then `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose -f compose.hosted.yml up -d --build`. Require IMDSv2 with hop limit 1, open 80/443 only, and set `PROD_ORIGIN`/`SITE_URL` in `.env-supabase-admin` before rerunning `configure-auth.mjs --apply`. The renderer runs Chromium with its sandbox, which needs unprivileged user namespaces: Amazon Linux 2023 allows them; on Ubuntu 23.10 or later, check `sysctl kernel.apparmor_restrict_unprivileged_userns` is `0` (or give Docker an AppArmor profile that allows `userns`). If the sandbox can't start, the renderer exits and stays unhealthy, and cards show the plain fallback until it's fixed; the agent keeps working. Runs end at `RUN_TIME_LIMIT_SECONDS` (default 280) to stay inside Vercel's `maxDuration = 300`. The full checklist is in the design spec's "Rollout and deploy".

### Optional: Ollama in Docker

`docker compose -f compose.hosted.yml --profile ollama up -d` runs Ollama on port 11434. As the admin, add it in the app: Models → Ollama → Connect (`http://host.docker.internal:11434/v1`).

### Optional: LiteLLM gateway

The gateway is an opt-in profile and is offered to the admin only. Create `deploy-config/.env-llm` with `LITELLM_MASTER_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_OPENAI_BASE_URL` and `OLLAMA_CHAT_MODEL` for the models in `deploy-config/litellm/config.yaml`, and set `LLM_API_KEY` in `deploy-config/.env-agent` to the same master key. Then add the `litellm` profile to the compose command.

### Settings reference

Agent settings live in `deploy-config/.env-agent` (git-ignored).

| Variable | Default | What it does |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | required | The Supabase project; the secret key is the agent's own `sb_secret_…` key |
| `AGENT_SERVICE_SECRET` | required | 64 hex chars shared with the web app |
| `CREDENTIAL_KEYS` | required | Master keys for stored provider keys, `v2:<base64>,v1:<base64>`, first is current. Rotate with `docker compose -f compose.hosted.yml exec agent node dist/scripts/rotateCredentials.js` |
| `ACCESS_REQUEST_PEPPER` | required | Base64 of 32 bytes; hashes visitor IPs |
| `APP_ORIGIN` | required | The web app's origin, used for email links |
| `RUN_TIME_LIMIT_SECONDS` | `280` | A run ends cleanly after this long |
| `RENDERER_SECRET` | required | 64 hex chars shared with the renderer (`deploy-config/.env-renderer`); must differ from `AGENT_SERVICE_SECRET` |
| `RENDERER_URL` | `http://renderer:8100` | Where the renderer is |
| `LLM_API_KEY` | unset | Turns on the LiteLLM gateway provider for the admin (with the `litellm` profile) |
| `LLM_BASE_URL` | `http://llm:4000/v1` | Where the gateway is |
| `AGENT_MODELS` | all gateway models | Gateway models to offer: `id=Label=note\|id2=Label` |
| `AGENT_MODEL_CAPS` | Sonnet models get `codemode` | Per-model capabilities: `provider/model=codemode\|other=none` |
| `JEV_MODEL` | `typesafe/jev-latest`, then `openrouter/typesafe/jev-1.14` | Pin the Jev classifier to one provider/model |
| `JEV_CONCURRENCY` | `64` | Jev requests in flight across all chats |
| `COPILOTKIT_TELEMETRY_DISABLED` | required, `true` | The agent refuses to start without it, so CopilotKit never sends telemetry. The agent image sets it; set it for a host-run agent, scripts and evals |
| `COPILOT_CONNECTS_PER_USER` | `8` | Open `/copilotkit` connect streams per user (1–100); over the cap answers 429 `too_many_connections` |
| `COPILOT_CONNECT_MAX_MS` | `1800000` (30 min) | Longest a connect stream stays open (60000–86400000 ms) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs prompts, tool arguments and the profile |

## Search and pictures

- Web search goes through SearXNG. Some engines rate-limit or CAPTCHA a home IP; Yahoo, Bing, Google, Qwant, Mojeek and Startpage are enabled so one working engine is enough.
- Optional fallback: add a Brave Search API key in the app (Models → Web search; free tier at brave.com/search/api) and it is used whenever SearXNG returns nothing.
- Pictures come from the pages the agent reads (`images:` section), `image_search` (SearXNG images), `music` (iTunes Search: album and song art, Apple Music links) and `wikipedia` (places, people, topics). No keys needed.
- Cards show an image or link only if a tool returned it; otherwise the image is dropped and a placeholder is shown.

## Skills, Jev and codemode

- **Follow-ups**: the model ends its answer with `<followups>a | b</followups>`; the agent turns that line into the buttons under the reply.
- **Skills** live in `packages/core/skills/<name>/SKILL.md` (frontmatter `name`, `description`, then a playbook). The core prompt lists them and the agent loads one with `load_skill`. A new use case is a new folder; no code change.
- **Jev** (TypeSafe's calibrated classifier) judges product matches in `shop`, hotel brand/area/vibe wishes in `stays`, music cover art, which search hits to read, and research claims. It uses whichever key you added in the app: TypeSafe first, then OpenRouter (`JEV_MODEL` pins one). If Jev is unreachable, every feature falls back to its non-Jev behavior.
- **Codemode**: Claude Sonnet models (from any provider), or models tagged `codemode` in `AGENT_MODEL_CAPS`, can write one script that runs many lookups and does the maths in code. A failed script turns codemode off for the rest of that chat.
- **Workspace and chats**: Chats and their messages are saved in Supabase, and a chat continues after an agent restart. Carts, trips, events and shortlists are working state for the conversation: they live in the agent's session only. Cards from earlier sessions stay in the chat, read-only and dated; ask again for fresh prices. The app shell has a sidebar of chats (Today, This week, Earlier), and its own views for **Reports** (every report, with PDF download) and **Search** (chat titles, message text and report titles). Every view has a URL. A report shows in the chat as a card with a thumbnail and opens in a resizable panel beside the chat (an overlay on tablets, a full-screen viewer on phones), with previous/next, PDF and a new-tab link; the open report is in the URL, and the agent knows which report is open, so "what's the cheapest option in this report?" just works.
- **Your agent**: users name their agent, pick its look and how it talks (brief, warm or thorough) in the first onboarding step or the profile drawer. The name and tone go into the system prompt as a quoted name under the hard rules.

Design and results: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`, `docs/findings.md`.

## End-to-end demo

`e2e/` drives a preview stack with Playwright on desktop, tablet and phone sizes. It creates `oab-e2e+shell@example.test` and `oab-e2e+other@example.test`, seeds chats, reports and saved cards, and removes them afterwards with `supabase/scripts/cleanup-e2e.mjs`. It reads `deploy-config/env-files/.env-supabase-admin` and needs `E2E_OPENROUTER_KEY` in `deploy-config/env-files/.env-e2e` (saved through the app's API, never typed or logged; the run uses DeepSeek V4 Flash).

Every Playwright project (`desktop`, `tablet`, `phone`, `smoke`, `preview-m1`, `preview-m2`) needs `APP_ORIGIN` set on the command, and refuses anything but `http://localhost` or `http://127.0.0.1` on a port in 18000–19999. `APP_ORIGIN` and the opt-in below are never read from the env files. To target any other origin on purpose, also set `E2E_ALLOW_LIVE=1` on the command.

```bash
npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w e2e
```

`make-demo.mjs` needs `ffmpeg` and joins the recordings into `~/Downloads/app-shell-demo.mp4`.

The `smoke` project (`e2e/preview-smoke.spec.ts`) runs on its own against a fresh preview: `APP_ORIGIN=http://localhost:18300 npm run smoke -w e2e` signs in, completes onboarding, and checks that a reply streams and that Stop ends a run. `APP_ORIGIN=http://localhost:18300 npm run m1 -w e2e` runs the M1 preview checks.

## Evals

- `cd packages/core && npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `packages/core/evals/scenarios/` against the running agent and writes `packages/core/evals/results/<date>-<label>-<model>/report.md`, diffed against `packages/core/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. Evals sign in as `EVAL_USER_EMAIL` (default `oab-eval@example.test`, created once with `bootstrap-admin.mjs oab-eval@example.test --user` and given a provider key in the app), reading `deploy-config/.env-agent` and `.env-supabase-admin`.
- `npx tsx evals/run.ts --target local --origin http://127.0.0.1:3000 --openrouter-key-env OPENROUTER_API_KEY --model openrouter/deepseek/deepseek-v4-flash` runs the same scenarios against the local stack with no Supabase: it saves the key from the named variable through the app, then posts each run to `/api/copilotkit/agent/openagent/run`. `--target hosted` (the default) keeps the signed-in path above.
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.

## Develop

- Install once from the repo root with `npm ci` (one workspace, one `package-lock.json`); `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` checks every package.
- Agent: `npm run lint -w @oab/core && npm run format:check -w @oab/core && npm run typecheck -w @oab/core && npm test -w @oab/core && npm run build -w @oab/core` (live pi test: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npm test -w @oab/core`; Supabase integration tests against the real project: `npm run test:supabase -w @oab/core`)
- Web: `npm run lint -w web && npm run format:check -w web && npm run typecheck -w web && npm test -w web && npm run build -w web`
- Shared UI and API handler: the same five commands with `-w @oab/ui` (no build; consumed as source) and `-w @oab/bff`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, how to add a tool, and conventions. Report security issues as described in [SECURITY.md](SECURITY.md).

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.
- Thumbnails and PDFs are made by the `renderer` service: a non-root, read-only container with Chromium's sandbox on (Playwright's seccomp profile, `cap_drop: ALL` plus `SYS_CHROOT` for the sandbox), no secrets but `RENDERER_SECRET`, and only the agent can reach it (an internal `render` network); it isn't behind Caddy. Its Chromium resolves only `fonts.googleapis.com` and `fonts.gstatic.com`, aborts every other request, and the report's resource hints, speculation rules and `meta refresh` are stripped first.

## License

[MIT](LICENSE)
