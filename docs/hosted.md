# Hosted deployment

This is the invite-only hosted deployment. It moves to `cloud/README.md` in M6.

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

## End-to-end demo

`e2e/` drives a preview stack with Playwright on desktop, tablet and phone sizes. It creates `oab-e2e+shell@example.test` and `oab-e2e+other@example.test`, seeds chats, reports and saved cards, and removes them afterwards with `supabase/scripts/cleanup-e2e.mjs`. It reads `deploy-config/env-files/.env-supabase-admin` and needs `E2E_OPENROUTER_KEY` in `deploy-config/env-files/.env-e2e` (saved through the app's API, never typed or logged; the run uses DeepSeek V4 Flash).

Every Playwright project (`desktop`, `tablet`, `phone`, `smoke`, `preview-m1`, `preview-m2`) needs `APP_ORIGIN` set on the command, and refuses anything but `http://localhost` or `http://127.0.0.1` on a port in 18000–19999. `APP_ORIGIN` and the opt-in below are never read from the env files. To target any other origin on purpose, also set `E2E_ALLOW_LIVE=1` on the command.

```bash
npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w e2e
```

`make-demo.mjs` needs `ffmpeg` and joins the recordings into `~/Downloads/app-shell-demo.mp4`.

The `smoke` project (`e2e/preview-smoke.spec.ts`) runs on its own against a fresh preview: `APP_ORIGIN=http://localhost:18300 npm run smoke -w e2e` signs in, completes onboarding, and checks that a reply streams and that Stop ends a run. `APP_ORIGIN=http://localhost:18300 npm run m1 -w e2e` runs the M1 preview checks.

## Evals

- `cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `packages/core/evals/scenarios/` against the running agent and writes `packages/core/evals/results/<date>-<label>-<model>/report.md`, diffed against `packages/core/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. Evals sign in as `EVAL_USER_EMAIL` (default `oab-eval@example.test`, created once with `bootstrap-admin.mjs oab-eval@example.test --user` and given a provider key in the app), reading `deploy-config/.env-agent` and `.env-supabase-admin`.
- `npx tsx evals/run.ts --target local --origin http://127.0.0.1:3000 --openrouter-key-env OPENROUTER_API_KEY --model openrouter/deepseek/deepseek-v4-flash` (from `packages/core`, where `local` is the default and only target) runs the same scenarios against the local stack with no Supabase: it saves the key from the named variable through the app, then posts each run to `/api/copilotkit/agent/openagent/run`. The signed-in path above runs from `cloud/agent`, whose `evals/run.ts` registers `--target hosted` (its default) on top of core's runner.
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.
