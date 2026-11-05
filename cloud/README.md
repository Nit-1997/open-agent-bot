# Hosted deployment

The invite-only hosted deployment. Everything in `cloud/` is hosted-only; the open-source app builds and runs without this folder.

## Run the hosted stack

> **Warning.** The root `docker-compose.yml` is the local stack (project `open-agent`). Every hosted command needs `-f cloud/deploy-config/compose.hosted.yml`: bare `docker compose ps`, `logs`, `down`, `restart` and `up` target the local project, not the hosted one. `cloud/deploy-config/compose.hosted.yml` pins the project name `open-agent-bot`, so the existing containers and volumes are reused.

Open Agent is invite-only until Gate 9 opens signups (see "Signup modes"). Accounts, sessions and every user's data live in one Supabase project; the agent and the web app keep nothing on disk.

1. Install Docker, Node 22 and `jq` (the preview preflight uses it).
2. Fill in the three env files. Each folder in `cloud/deploy-config/env-files/` holds a tracked `.env.example` with the names only; copy it to `.env` in the same folder (git-ignored) and fill in the values:
   - `cloud/deploy-config/env-files/backend/.env`: every backend container's settings. Compose hands each service only its own names (the `environment:` lists in `cloud/deploy-config/compose.hosted.yml`): the agent gets the Supabase URL and keys, `AGENT_SERVICE_SECRET` (`openssl rand -hex 32`), `CREDENTIAL_KEYS` (`v1:` + `openssl rand -base64 32`), `ACCESS_REQUEST_PEPPER` (`openssl rand -base64 32`), `APP_ORIGIN=https://app.localhost`, `RENDERER_SECRET` (`openssl rand -hex 32`) and its optional settings; the renderer gets only `RENDERER_SECRET`; Caddy only `AGENT_HOST` and `ACME_EMAIL`; the LiteLLM gateway only its own keys; SearXNG nothing.
   - `cloud/deploy-config/env-files/frontend/.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, and the same `AGENT_SERVICE_SECRET`. The web container reads this file, and its `NEXT_PUBLIC_*` names are the web image's build args.
   - `cloud/deploy-config/env-files/ops/.env` (owner's machine only; no container reads it): the Management API token, the `admin_scripts` secret key, Google OAuth client, Resend key, the e2e OpenRouter key and the eval user.
   - From an older checkout: `node cloud/deploy-config/scripts/env-files.mjs --from <that checkout>/cloud/deploy --to cloud/deploy-config/env-files --copy` merges its `.env-*` and `env-files/.env-*` files into these three (`--from <that checkout>/deploy-config` for the pre-M6 layout). Add `--dry-run` first. It prints names, modes, sizes and key names only, refuses a key set to two different values, creates each file `0600` in a `0700` folder and never overwrites one.

   Every hosted compose command passes `--env-file cloud/deploy-config/env-files/backend/.env` (Compose refuses without `RENDERER_SECRET`); commands that build or run the local web container also pass `--env-file cloud/deploy-config/env-files/frontend/.env`. A name set in your shell wins over the file, so don't export these names in the shell you run Compose from (`make web` runs Compose with a clean environment).
3. Set up Supabase once: apply `cloud/supabase/migrations/` in order, then `set -a; . cloud/deploy-config/env-files/ops/.env; set +a; node cloud/supabase/scripts/configure-auth.mjs --apply` and `node cloud/supabase/scripts/bootstrap-admin.mjs <your email>`. If you use the Supabase CLI, run it as `supabase --workdir cloud …`.
4. `docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env --profile local up -d --build`.
5. Trust Caddy's local CA once: `docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`.
6. Open https://app.localhost and sign in with Google using the bootstrapped email. The agent is at https://agent.localhost (it needs the service secret and a user token).

`make web` runs the standard preview of this stack (agent, web, SearXNG, renderer under project `oab-preview`, web on http://localhost:18300, agent on 127.0.0.1:18800) after checking that the backend and frontend files have every required name; `make stop` takes it down and keeps its volumes.

Visitors ask for access at `/request-access`; the admin approves them at `/admin`, which sends the invite email. Users add their own model keys in the app; keys are encrypted by the agent and never sent back to the browser.

To run a preview beside a running stack, work in a second checkout or worktree, never the one that runs the stack. In that checkout, first create a git-ignored `.env` containing `COMPOSE_PROJECT_NAME=oab-<name>` at the root and in `cloud/deploy-config/` (`printf 'COMPOSE_PROJECT_NAME=oab-guard\n' | tee .env cloud/deploy-config/.env`; Compose reads `.env` from the compose file's folder), so unqualified compose commands there never reach the live project; `docker compose config --format json | jq -r .name` and `docker compose -f cloud/deploy-config/compose.hosted.yml config --format json | jq -r .name` must both print that name (the second needs `RENDERER_SECRET` from the shell for this check only: prefix it with `RENDERER_SECRET=x`). Then use another project name and the preview override: `. scripts/preview-preflight.sh`, `P="docker compose -p oab-preview --env-file .env --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env -f cloud/deploy-config/compose.hosted.yml -f cloud/deploy-config/compose.preview.yml --profile local"`, `preflight $P && $P up -d --build search renderer agent web` (agent on 127.0.0.1:18800, web on http://localhost:18300). `preflight` returns 1 unless the project name starts with `oab-`, every published port is on 127.0.0.1 and at 18000 or above, and any `PREVIEW_AGENT_PORT` / `PREVIEW_WEB_PORT` is in 18000–19999; scripts call it as `preflight … || exit 1`. For a second local stack, use `-p oab-<name>` with `OPEN_AGENT_PORT` in 18000–19999 and `OPEN_AGENT_DATA_VOLUME` / `OPEN_AGENT_KEYS_VOLUME` starting with `oab-`; `preflight` refuses any volume name that doesn't start with `oab-`.

Ports bound to 127.0.0.1: Caddy 80/443 and the agent's 8000 for debugging (LiteLLM 4000 and Ollama 11434 when turned on). SearXNG is reachable only from the agent.

The agent refuses to start if a provider key such as `OPENAI_API_KEY` is set in its environment, because it would serve every user. The operator LiteLLM gateway (`LLM_API_KEY`) and private-network model servers are available to the admin only.

### Deploy

The web app runs on Vercel (Root Directory `cloud/web`, "Include files outside the root directory" on, Production env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `AGENT_URL=https://<AGENT_HOST>`, `AGENT_SERVICE_SECRET`; nothing for Preview). The agent, SearXNG and Caddy run on EC2: create `cloud/deploy-config/env-files/backend/.env` there (same `CREDENTIAL_KEYS` and pepper as local, `APP_ORIGIN=https://<APP_HOST>`, a new `RENDERER_SECRET`, and Caddy's `AGENT_HOST` and `ACME_EMAIL`; no frontend file, the web app is on Vercel), then `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env up -d --build`. Require IMDSv2 with hop limit 1, open 80/443 only, and set `PROD_ORIGIN`/`SITE_URL` in `cloud/deploy-config/env-files/ops/.env` before rerunning `configure-auth.mjs --apply`. The renderer runs Chromium with its sandbox, which needs unprivileged user namespaces: Amazon Linux 2023 allows them; on Ubuntu 23.10 or later, check `sysctl kernel.apparmor_restrict_unprivileged_userns` is `0` (or give Docker an AppArmor profile that allows `userns`). If the sandbox can't start, the renderer exits and stays unhealthy, and cards show the plain fallback until it's fixed; the agent keeps working. Runs end at `RUN_TIME_LIMIT_SECONDS` (default 280) to stay inside Vercel's `maxDuration = 300`.

### Optional: Ollama in Docker

`docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --profile ollama up -d` runs Ollama on port 11434. As the admin, add it in the app: Models → Ollama → Connect (`http://host.docker.internal:11434/v1`).

### Optional: LiteLLM gateway

The gateway is an opt-in profile and is offered to the admin only. Set `LITELLM_MASTER_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_OPENAI_BASE_URL` and `OLLAMA_CHAT_MODEL` in `cloud/deploy-config/env-files/backend/.env` for the models in `cloud/deploy-config/litellm/config.yaml` (only the gateway receives them; the agent refuses to start with a provider key in its environment), and set `LLM_API_KEY` in the same file to the same master key. Then add the `litellm` profile to the compose command.

### Settings reference

Agent settings live in `cloud/deploy-config/env-files/backend/.env` (git-ignored); the agent receives only the names in its `environment:` list in `cloud/deploy-config/compose.hosted.yml`, so a new setting needs a line there too.

| Variable | Default | What it does |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | required | The Supabase project; the secret key is the agent's own `sb_secret_…` key |
| `AGENT_SERVICE_SECRET` | required | 64 hex chars shared with the web app |
| `CREDENTIAL_KEYS` | required | Master keys for stored provider keys, `v2:<base64>,v1:<base64>`, first is current. Rotate with `docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env exec agent node dist/scripts/rotateCredentials.js` |
| `ACCESS_REQUEST_PEPPER` | required | Base64 of 32 bytes; hashes visitor IPs |
| `APP_ORIGIN` | required | The web app's origin, used for email links |
| `RUN_TIME_LIMIT_SECONDS` | `280` | A run ends cleanly after this long |
| `RENDERER_SECRET` | required | 64 hex chars shared with the renderer (Compose gives the renderer this one name from the same file); must differ from `AGENT_SERVICE_SECRET` |
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
| `LIMIT_RUNNING_PER_USER` | `1` | Runs one user may have open at once, across all chats (1–10); over it a run answers 429 `limit_running` |
| `LIMIT_REQUESTS_PER_HOUR` | `10` | Counted runs per user in any rolling hour (1–1000); 429 `limit_hourly` |
| `LIMIT_REQUESTS_PER_MONTH` | `50` | Counted runs per user per UTC calendar month (1–100000); 429 `limit_monthly` |
| `LIMIT_RUNNING_SERVER` | `8` | Runs open at once on the whole agent (1–200, at least `LIMIT_RUNNING_PER_USER`); 429 `server_busy` |
| `TURNSTILE_SECRET_KEY` | unset | Cloudflare Turnstile secret for the one-time human check in `open` signup mode; without it `open` mode answers 503 `human_check_unavailable` (Gate 9) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs prompts, tool arguments and the profile |

## Develop the hosted stack

To work on one side of the hosted stack, run the other in Docker and point at it:

- Agent: `cd cloud/agent && npm run build && set -a && . ../deploy-config/env-files/backend/.env && set +a && COPILOTKIT_TELEMETRY_DISABLED=true npm start` (`tsc -b` builds `@oab/shared`, `@oab/bff` and `@oab/core` and then the hosted agent into `cloud/agent/dist/`; settings in the reference table above). The agent refuses to start unless `COPILOTKIT_TELEMETRY_DISABLED=true`; set it for every host-run agent, script and eval. The agent image sets it already. Sourcing the whole backend file also loads the gateway's keys if you set them; leave those out of a host-run agent's shell, or it refuses to start.
- Web: `cd cloud/web && set -a && . ../deploy-config/env-files/frontend/.env && set +a && AGENT_URL=http://localhost:8000 npm run dev`

The request limits (`LIMIT_*`) count runs in the database, so the agent refuses to start until the M7 usage functions exist there (`refusing to start: the M7 usage functions are missing or not executable (apply the migrations first: Gate 8)`). Until the owner runs Gate 8, a hosted preview or the hosted e2e against the production project can't start on M7 code; the preview override (`compose.preview.yml`) sets high limits (4 running per user, 1000 per hour, 100000 per month, 50 on the server) so test runs are never throttled once it can.

Both need the same `AGENT_SERVICE_SECRET` and a Supabase project (see "Run the hosted stack" above). Sign-in cookies are `Secure`, so use the Caddy stack at https://app.localhost for anything that needs a session. The checks for the cloud workspaces are in CONTRIBUTING's checks table; the cloud boundary (nothing outside `cloud/` imports or builds from it) is in CONTRIBUTING's "Cloud boundary".

## Run M7 locally

`make run web-local` (or `make web-local`) runs the hosted app with the request limits, usage meter, Usage tab and signup modes on your machine, with no env files and no Supabase project. It needs Docker running, the Supabase CLI (it prints the install command if the CLI is missing) and `npm ci`. It starts a local Supabase stack `oab-m7-dev` on 127.0.0.1:18700–18704 with every migration in `cloud/supabase/migrations/`, writes a fresh 0600 env to `.web-local/env` (git-ignored: the local stack's keys, new secrets, Cloudflare's always-pass Turnstile test keys and the `LIMIT_*` defaults from `cloud/deploy-config/env-files/backend/.env.example`), creates the admin `owner@local.test` and the member `member@local.test`, builds `cloud/agent` and `cloud/web`, and runs the agent on 18720, the web app at http://localhost:18721 and the demos' stub model on 18722 in the background (pid files and logs in `.web-local/`). It prints a one-click sign-in link for each user and the Mailpit inbox (http://127.0.0.1:18704) for email-link sign-in.

- Limits: set any `LIMIT_*` on the command, e.g. `LIMIT_REQUESTS_PER_MONTH=5 make run web-local`.
- Model: as the admin, pick Custom server in onboarding or Settings → Models with URL `http://127.0.0.1:18722/v1`, key `oab-e2e-stub-key` and model `stub-1`. Private-network servers are admin-only, so the member needs a real provider key (Settings → Models; it stays in the local stack). `WEB_LOCAL_STUB=0` skips the stub.
- Signup mode: `bash scripts/make/web-local.sh mode open` (or `invite`, `waitlist`; the agent and web cache it 60 s). `configure-auth.mjs` is for production only. New sign-in links: `bash scripts/make/web-local.sh links`.
- Stop: `make stop` stops the processes, removes `oab-m7-dev` with its volumes, and deletes `.web-local/`. Web search and report cards are off (no SearXNG or renderer).

## End-to-end demo

`cloud/e2e/` drives a preview stack with Playwright on desktop, tablet and phone sizes. It creates `oab-e2e+shell@example.test` and `oab-e2e+other@example.test`, seeds chats, reports and saved cards, and removes them afterwards with `cloud/supabase/scripts/cleanup-e2e.mjs`. It reads `cloud/deploy-config/env-files/ops/.env`, which needs `SUPABASE_URL`, `SUPABASE_ADMIN_SECRET_KEY` and `E2E_OPENROUTER_KEY` (saved through the app's API, never typed or logged; the run uses DeepSeek V4 Flash).

Every Playwright project (`desktop`, `tablet`, `phone`, `smoke`, `preview-m1`, `preview-m2`) needs `APP_ORIGIN` set on the command, and refuses anything but `http://localhost` or `http://127.0.0.1` on a port in 18000–19999. `APP_ORIGIN` and the opt-in below are never read from the env files. To target any other origin on purpose, also set `E2E_ALLOW_LIVE=1` on the command.

```bash
npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w @oab/cloud-e2e
```

`make-demo.mjs` needs `ffmpeg` and joins the recordings into `~/Downloads/app-shell-demo.mp4`.

The `smoke` project (`cloud/e2e/preview-smoke.spec.ts`) runs on its own against a fresh preview: `APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e` signs in, completes onboarding, and checks that a reply streams and that Stop ends a run. `APP_ORIGIN=http://localhost:18300 npm run m1 -w @oab/cloud-e2e` runs the M1 preview checks.

## Evals

- `cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `packages/core/evals/scenarios/` against the running agent and writes `packages/core/evals/results/<date>-<label>-<model>/report.md`, diffed against `packages/core/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. Evals sign in as `EVAL_USER_EMAIL` (default `oab-eval@example.test`, created once with `bootstrap-admin.mjs oab-eval@example.test --user` and given a provider key in the app), reading `cloud/deploy-config/env-files/backend/.env` and `cloud/deploy-config/env-files/ops/.env`.
- `npx tsx evals/run.ts --target local --origin http://127.0.0.1:3000 --openrouter-key-env OPENROUTER_API_KEY --model openrouter/deepseek/deepseek-v4-flash` (from `packages/core`, where `local` is the default and only target) runs the same scenarios against the local stack with no Supabase: it saves the key from the named variable through the app, then posts each run to `/api/copilotkit/agent/openagent/run`. The signed-in path above runs from `cloud/agent`, whose `evals/run.ts` registers `--target hosted` (its default) on top of core's runner.
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.

## Request limits

Every run is admitted once before it starts, and the same limits apply to every account, admins included. The agent holds the running caps in its own process (`LIMIT_RUNNING_PER_USER`, `LIMIT_RUNNING_SERVER`); Postgres counts the hourly and monthly runs per user (`LIMIT_REQUESTS_PER_HOUR`, `LIMIT_REQUESTS_PER_MONTH`, UTC calendar month) through `public.request_admit`. The defaults are in the settings reference above. A refused run answers 429 with a code (`limit_running`, `server_busy`, `limit_hourly`, `limit_attempts`, `limit_monthly`) and the web app shows a notice instead of the red error banner; a database error answers 503 `usage_unavailable` and admits nothing. A run the agent refuses before it starts is refunded; a run that fails after it started stays counted. Each user sees their month in the sidebar meter, and the admin's Usage tab (`/admin`) shows the totals, the running count and the users nearest their limit.

The running slots live in one agent process, which is right for the one hosted agent container. Running more than one agent would need database leases with a heartbeat instead.

## Signup modes

`public.signup_settings` holds one mode, changed only with `configure-auth.mjs` (`SIGNUP_MODE`, default `waitlist`):

| Mode | Who can create an account |
| --- | --- |
| `invite` | Only invited emails; `/request-access` says it isn't taking requests |
| `waitlist` | Only invited emails; visitors ask at `/request-access` and the admin approves them |
| `open` | Anyone with a Google account whose email domain isn't on the throwaway list, within the signup caps (`signups_per_hour`, `signups_per_day`, `signups_per_ip_day` in the same row); email links stay sign-in only |

In `open` mode every account, invited ones included, passes a one-time Cloudflare Turnstile check before its first counted run, and the email-link form needs it too. If a mode lookup fails the agent keeps the last mode it read; if it has never read one it treats the mode as `open` for the check, and the web app shows `waitlist` with the check on the email-link form, so neither side fails open. The email-link check guards the app's own form only: GoTrue's `/auth/v1/otp` endpoint can be called directly with the publishable key and no captcha (see [SECURITY.md](SECURITY.md#accepted-risks)). Deleting an account keeps a peppered hash of the email with that month's count and the human check for up to two months, so deleting and signing up again doesn't reset either.

## Switch-over after M6 (owner only)

M6 moved everything hosted into `cloud/`. Two owner steps put production on the new layout: Gate 6 points Vercel at `cloud/web`, and Gate 7 moves the live agent stack to `cloud/deploy-config`. The live stack runs commit `c1c0f4e` from the old checkout (`$OLD` below): its root `docker-compose.yml` has no `name:` (the project is `open-agent-bot` from the folder name), the agent and renderer build from `agent/Dockerfile`, the web from `web/Dockerfile`, and its containers bind files from that checkout's `deploy-config/`.

Do both gates in **one sitting**, in this order. The web app and the agent must come from compatible commits: the post-revamp web app reaches the agent's `/copilotkit`, which the `c1c0f4e` agent doesn't have, while the new agent still serves the `/agui` route the old web app uses. So the agent switches first and Vercel goes live right after it.

1. **Before the first merge** (any day before): the Vercel checks in Gate 6 step 1, and turn off production auto-assignment (Gate 6 step 2), so no merge to `main` can put a new web app in front of the old agent.
2. **Merge** the M6 branches to `main` and update the required checks (Gate 6 step 3). The live agent is not affected: it runs from the old checkout.
3. **Prepare** Gate 7 steps 1 to 5: a fresh checkout, the settings files, the config check, a preview on spare ports, the names check and the rollback point. Nothing live changes yet.
4. **Root Directory** `cloud/web` on Vercel (Gate 6 step 4), a setting only.
5. **Switch the agent** (Gate 7 step 6): a few seconds of agent downtime; the old web app keeps working against the new agent.
6. **Web live** (Gate 6 step 5): promote the latest `main` deployment.
7. **Verify** (Gate 7 step 7). If something is wrong, roll back the web app and the agent together (Gate 7 step 8).
8. **Burn-in**, then clean up (Gate 7 step 9).

If the live agent was already redeployed from the post-revamp layout (`compose.hosted.yml` at the root of the old checkout, started with `-f compose.hosted.yml --env-file deploy-config/.env-nextjs --profile local`) before M6 merges, the gates can run apart: web and agent are compatible on both sides of the switch. Use the same steps; only the rollback command (Gate 7 step 8) differs.

## Vercel (Gate 6)

1. Checks, before anything merges:
   - Settings → Git → "Git Fork Protection" is on.
   - Settings → Environment Variables: Production holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `AGENT_URL` and `AGENT_SERVICE_SECRET`; no server secret (`AGENT_SERVICE_SECRET`, any Supabase secret key) is scoped to Preview or Development.
   - Settings → Build and Deployment: no custom Install or Build Command and no Ignored Build Step that the move would break; "Include files outside the root directory in the Build Step" is on.
   - If the Supabase GitHub integration or branching is on for this repository, it doesn't run for fork pull requests, and its directory is `cloud`.
2. Settings → Environments → Production: turn off "Auto-assign Custom Production Domains", so merges to `main` build but don't go live. If your plan doesn't offer it, do steps 3 to 5 of the sitting back to back instead.
3. Merge to `main`. On the `main` ruleset's required status checks, add `standalone` and `cloud` and remove the old web job (it no longer exists). The production build of each merge either fails (from the 6.5 merge on, the old Root Directory is gone) or isn't assigned; the serving deployment stays as it is. The Vercel check on the 6.5 pull request is expected red and doesn't block.
4. Settings → Build and Deployment → Root Directory: `cloud/web`. Keep "Include files outside the root directory in the Build Step" on. Change nothing else.
5. After the agent switch (Gate 7 step 6): Deployments → the latest `main` commit → Redeploy, then Promote it to production (or turn auto-assignment back on and redeploy). Check `/login`, sign in and stream a chat. Turn "Auto-assign Custom Production Domains" back on.
6. If the web app misbehaves: Instant Rollback to the previous production deployment. If you also roll the agent back, roll the web app back first.

## Move the live stack to `cloud/deploy-config` (Gate 7)

**Never `git pull` the old checkout before the switch.** Its containers bind-mount files from its `deploy-config/`; a pull that moves them leaves the next container restart with empty directories in their place, and SearXNG and Caddy fail. The old checkout stays untouched as the rollback.

Run the steps in one terminal, from the fresh checkout:

```bash
OLD="<path of the old checkout>"
NEW="$HOME/open-agent-hosted"
AGENT_HOST="<public agent host>"
```

1. A fresh checkout of the M6 `main` commit. Never put a `.env` file in its `cloud/deploy-config/`: Compose reads `.env` from the compose file's folder, and a `COMPOSE_PROJECT_NAME` there would override `open-agent-bot`.

   ```bash
   git clone https://github.com/Nit-1997/open-agent-bot "$NEW"
   cd "$NEW"
   git checkout <main commit after M6>
   ```

2. Merge the settings files from the old checkout into `cloud/deploy-config/env-files/{backend,frontend,ops}/.env` (names, modes, sizes and key names only; each new file is `0600` in a `0700` folder, nothing is overwritten, a key with two different values is refused, the old files stay for the rollback). First list the git-ignored files in its `deploy-config/` (names only): every `.env-*` line must be one of the eight names the helper knows (`.env-agent`, `.env-renderer`, `.env-caddy`, `.env-llm` and `.env-search` go to backend, `.env-nextjs` to frontend, `env-files/.env-supabase-admin` and `env-files/.env-e2e` to ops); anything else is reported `unknown (not moved)` below.

   ```bash
   git -C "$OLD" status --porcelain --ignored -- "$OLD/deploy-config"
   node cloud/deploy-config/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy-config/env-files --copy --dry-run
   node cloud/deploy-config/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy-config/env-files --copy
   node cloud/deploy-config/scripts/env-check.mjs
   ```

   An `unknown (not moved)` line (exit 2) names a file the helper doesn't know; add its names by hand to the right file only if the hosted stack uses them. `env-check.mjs` lists any required name that is missing or empty, and warns by name about backend names no container receives.

3. Config check under the new code, then a preview on spare ports. The check prints `hosted config ok`, a `ConfigError` message (names only, never values), or only an error's name and code:

   ```bash
   docker compose -p oab-gate7 -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env --profile local run --rm --no-deps --build agent node -e "import('./dist/config.js').then(m=>{try{m.loadHostedConfig(process.env);console.log('hosted config ok')}catch(e){console.log(e.name==='ConfigError'?e.message:e.name+' '+(e.code??''));process.exit(1)}})"
   . scripts/preview-preflight.sh
   P="docker compose -p oab-gate7 --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env -f cloud/deploy-config/compose.hosted.yml -f cloud/deploy-config/compose.preview.yml --profile local"
   preflight $P && $P up -d --build search renderer agent web
   ```

   Sign in at http://localhost:18300 and send a chat. Then remove the preview, its volumes and its images:

   ```bash
   $P down
   docker volume ls --filter label=com.docker.compose.project=oab-gate7 --format '{{.Name}}'
   docker volume rm $(docker volume ls -q --filter label=com.docker.compose.project=oab-gate7)
   docker image rm oab-gate7-agent oab-gate7-renderer oab-gate7-web
   ```

4. Names check (names only): the project must be `open-agent-bot` and the volumes `open-agent-bot_caddy-config`, `open-agent-bot_caddy-data` and `open-agent-bot_searxng-data` (and `open-agent-bot_ollama-data` with the `ollama` profile), the ones the live stack uses.

   ```bash
   docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env --profile local config --format json --no-env-resolution | jq '{name, volumes: [.volumes[].name]}'
   ```

5. Rollback point. Write down the old commit, the exact command you started the live stack with (for `c1c0f4e`, most likely `docker compose --env-file deploy-config/.env-nextjs --profile local up -d --build` run in the old checkout) and the running containers. The old layout also reads `$OLD/.env` for `CADDYFILE`, `CADDY_BIND` and `COMPOSE_PROFILES`; the new layout must not have a `.env` in `cloud/deploy-config/`, so record (names only) whether that file exists, which of those variables it sets, and which services run, then give step 6 the same values through the shell and the same `--profile` flags:

   ```bash
   test -f "$OLD/.env" && grep -oE '^(CADDYFILE|CADDY_BIND|COMPOSE_PROFILES)=' "$OLD/.env"
   docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Label "com.docker.compose.service"}}' | sort
   ```

   Then retag the images of the built services (agent, renderer, web), so `up --build` can't overwrite them; SearXNG and Caddy are pulled images pinned by digest and need nothing:

   ```bash
   git -C "$OLD" rev-parse HEAD
   docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Names}} {{.Image}} {{.CreatedAt}}'
   SHA=$(git -C "$OLD" rev-parse --short HEAD)
   docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Label "com.docker.compose.service"}} {{.Image}}' | while read -r svc img; do case "$svc" in agent|renderer|web) docker tag "$img" "${img%:*}:rollback-$SHA" && echo "$svc $img ${img%:*}:rollback-$SHA" ;; esac; done | tee "$HOME/open-agent-rollback.txt"
   ```

   The note must list one line per built service that runs: three (agent, renderer, web), or two (agent, renderer) if the web app isn't part of the live project, each `<service> <image> <image>:rollback-<sha>`. Check the count before you go on; if an image shows as a bare `sha256:` id, stop: the tag was already moved by another build.

   ```bash
   want=2; [ -n "$(docker ps -q --filter label=com.docker.compose.project=open-agent-bot --filter label=com.docker.compose.service=web)" ] && want=3
   test "$(wc -l < "$HOME/open-agent-rollback.txt")" -eq "$want" && echo "rollback tags: $want" || echo "STOP: expected $want rollback tags"
   ```

6. Switch. Containers are recreated with the new bind paths and images, on the same volumes; the agent is down for a few seconds. If step 5 found `CADDYFILE` or `CADDY_BIND` in `$OLD/.env`, export the same values in this shell first (read them from the file yourself; don't paste them anywhere), and add a `--profile` flag for each extra profile step 5 showed (`--profile litellm` for `llm`, `--profile ollama` for `ollama`):

   ```bash
   docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env --profile local up -d --build
   ```

7. Verify: every container is new and healthy, the volumes are the same, the agent answers locally and on its public host, and (after Gate 6 step 5) sign-in and a streamed chat work on the Vercel app. Confirm the tunnel (cloudflared) runs outside the compose project: `docker ps --filter label=com.docker.compose.project=open-agent-bot` must not list it. If it is a service of the project, check that it now points at the recreated agent, and re-point it if not.

   ```bash
   docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env ps
   docker volume ls --filter label=com.docker.compose.project=open-agent-bot --format '{{.Name}}'
   curl -fsS http://127.0.0.1:8000/health
   curl -fsS "https://$AGENT_HOST/health"
   ```

8. Rollback, if needed (web app first, Gate 6 step 6): put each recorded tag back on the exact image ref it came from, then start the old stack from the old checkout with its recorded command **without `--build`**, so the old images run again on the same volumes (with `--build` it rebuilds the old code from the old checkout instead). The second line below is the usual `c1c0f4e` command, written to run from any folder; use yours if you recorded a different one.

   ```bash
   while read -r svc img tag; do docker tag "$tag" "$img"; done < "$HOME/open-agent-rollback.txt"
   docker compose --project-directory "$OLD" -f "$OLD/docker-compose.yml" --env-file "$OLD/deploy-config/.env-nextjs" --profile local up -d
   ```

   If the old checkout ran the post-revamp layout instead, its command is `docker compose -f "$OLD/compose.hosted.yml" --env-file "$OLD/deploy-config/.env-nextjs" --profile local up -d`.

9. After a burn-in (a few days), delete the old checkout's settings files and the rollback tags. The root `.gitignore` and `.dockerignore` keep their legacy `deploy-config/` lines until then (a checkout of an older commit still has that folder); drop them in a cleanup change after this step. From then on, every hosted command runs in the new checkout with `-f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env`; a docker compose command without `-f` targets the local project `open-agent` in any checkout.

   ```bash
   rm "$OLD"/deploy-config/.env-* "$OLD"/deploy-config/env-files/.env-*
   while read -r svc img tag; do docker image rm "$tag"; done < "$HOME/open-agent-rollback.txt"
   ```

The factory rehearsed these steps on `oab-` projects beside the live stack (M6 demo part 4): from `c1c0f4e` and from the pre-M6 (M3) layout, each switched to this layout with the volumes reused and rolled back through the retagged images.

### Old web app against the new agent

Between Gate 7 step 6 and Gate 6 step 5 the `c1c0f4e` web app talks to the new agent. Every agent call it makes (`/agui` through its `/api/copilotkit` route; `/chats`, `/chats/:id`, `/chats/:id/messages`; `/reports`, `/reports/:id`; `/search`, `/places`, `/models`, `/onboarding/options`; `/profile`; `/settings/brave-search[/key]`; `/providers` and its `local`, `test`, `logins/:flow[/answer]`, `:id`, `:id/key`, `:id/models` and `:id/login` subpaths; `/artifacts/:file` for HTML, `.pdf` and `.jpg`; `/auth/email-link`; `/access-requests`; and the admin `/admin/access-requests[/:id/(approve|reject|resend)]` and `/admin/users[/:id[/(deactivate|reactivate)]]` calls) maps onto a route of the new agent with the same method; the two agents register the same 38 method and path pairs, `/health` included. Demo part 4 switches `search renderer agent` first and runs the old web container's sign-in, chat, Stop, artifact (HTML and PDF) and request-access flows against the new agent (`npm run compat -w @oab/cloud-e2e`) before it switches the web app. After Stop, the old web app shows "Something went wrong talking to the agent. This operation was aborted": that's a known `c1c0f4e` bug (the post-revamp web app fixes it), not an incompatibility, and the live web app does the same today.

## Apply the M7 migrations (Gate 8)

M7 adds two migrations, `20261104092535_request_usage.sql` (the usage tables and functions, and a new `private.handle_new_user`) and `20261104113650_signup_modes.sql` (the signup modes, the throwaway list table and a new `private.before_user_created`). Until they are on the production database, an M7 agent refuses to start there. Gate 8 applies them with `supabase db push`, redeploys the agent, and only then merges the web app. Nothing else changes: the mode stays `waitlist`, so signups work as today.

Work from a checkout of the M7 commit you will deploy, with Supabase CLI 2.111.0 and `psql` 17. Never paste the M7 SQL into the dashboard's editor and never mix it with `db push`, and don't use `supabase link` (nothing needs unlinking). `db push --db-url` needs no `config.toml`: the factory rehearsed every step below on a local stack started at the last pre-M7 migration (demo part 2).

1. Check the auth config and read the database URL. The check must report no drift and the note that `public.signup_settings` is missing (a pre-M7 database whose hook is invite-only). For the URL, open the dashboard's Connect dialog and copy the **session pooler** string (`…pooler.supabase.com:5432`; the direct `db.<ref>` host is IPv6-only), with the password filled in and `?sslmode=require` appended. Paste it at the silent prompt: `read -s` keeps it out of the shell history and the screen, and the variable is not exported, so only the commands below see it.

   ```bash
   set -a; . cloud/deploy-config/env-files/ops/.env; set +a
   node cloud/supabase/scripts/configure-auth.mjs --check
   read -s LIVE_DB_URL
   case "$LIVE_DB_URL" in *pooler.supabase.com:5432/*sslmode=require*) echo "session pooler URL" ;; *) echo "STOP: not a session pooler URL with sslmode=require"; unset LIVE_DB_URL ;; esac
   ```

   On any stop below, run `unset LIVE_DB_URL` before you leave the shell.

   While a `psql` or Supabase CLI command below runs, its URL argument, password included, shows in the process list (`ps`) to every user of the machine, so run Gates 8 and 9 on a machine only you use. For the `psql` steps you can keep the password out of the arguments: write it to `~/.pgpass` (mode `0600`, one line `<pooler host>:5432:postgres:<user>:<password>`), paste the URL without the password, and delete the file when you finish. The Supabase CLI's `--db-url` still carries it. Never export the URL or the password, and never leave either in a file after the gate.

2. Save the old function bodies, then check that live still runs the ones `cloud/supabase/rollback/m7.sql` restores. `check-old-bodies.mjs` compares each body (`prosrc`) and its `security definer`, volatility and `set` settings with the rollback file and prints only function names; exit 0 means both match, exit 1 means one differs (stop: live was changed by hand, and the rollback file would not restore it).

   ```bash
   psql "$LIVE_DB_URL" -XAtc "select pg_get_functiondef('private.before_user_created(jsonb)'::regprocedure) union all select pg_get_functiondef('private.handle_new_user()'::regprocedure)" > "$HOME/open-agent-m7-old-functions.sql"
   psql "$LIVE_DB_URL" -XAtc "$(node cloud/supabase/scripts/check-old-bodies.mjs --query)" | node cloud/supabase/scripts/check-old-bodies.mjs
   ```

3. Dry run. `check-push-plan.mjs` reads the CLI's plan and exits 0 only when it lists exactly the two M7 files, in order; exit 1 (another list) is a stop, and exit 3 means the history needs repair (step 4).

   ```bash
   supabase --workdir cloud db push --db-url "$LIVE_DB_URL" --dry-run | node cloud/supabase/scripts/check-push-plan.mjs
   ```

4. History repair, only after exit 3. The earlier migrations were applied by pasting their SQL, so the live `supabase_migrations.schema_migrations` may be empty and the dry run then lists every migration. First confirm the pre-M7 objects exist on live: the check must print `pre-M7 objects present` (anything else names what's missing; stop). Then mark the 12 pre-M7 versions as applied, without running them, and repeat step 3, which must now exit 0.

   ```bash
   psql "$LIVE_DB_URL" -XAtc "$(node cloud/supabase/scripts/check-push-plan.mjs --pre-m7-query)"
   supabase --workdir cloud migration repair --status applied $(node cloud/supabase/scripts/check-push-plan.mjs --pre-m7-versions) --db-url "$LIVE_DB_URL"
   ```

5. Push, check that nothing is left to push (`--applied` expects the "up to date" plan), and forget the URL.

   ```bash
   supabase --workdir cloud db push --db-url "$LIVE_DB_URL"
   supabase --workdir cloud db push --db-url "$LIVE_DB_URL" --dry-run | node cloud/supabase/scripts/check-push-plan.mjs --applied
   unset LIVE_DB_URL
   ```

6. Check the auth config again: expect `signup mode: waitlist, no drift` and no other drift line.

   ```bash
   node cloud/supabase/scripts/configure-auth.mjs --check
   ```

7. Redeploy the agent from the M7 checkout with the Gate 7 command (Gate 7 step 6), and check that it started: the health check answers and the startup log shows the `[limits]` line with your numbers, not the Gate 8 refusal.

   ```bash
   docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env --profile local up -d --build
   curl -fsS http://127.0.0.1:8000/health
   docker compose -f cloud/deploy-config/compose.hosted.yml --env-file cloud/deploy-config/env-files/backend/.env logs --tail 50 agent | grep -E '\[limits\]|refusing to start'
   ```

8. Merge `revamp/m7` into `main`; Vercel builds and deploys the web app. Sign in on the live app, send a chat and check that the sidebar shows the usage meter.

9. Re-run the hosted smoke on a preview from a second checkout or worktree with the `.env` guard (see "Run the hosted stack"), which sets high limits (4 running per user, 1000 per hour, 100000 per month, 50 on the server) so the tests are never throttled. The e2e marks its `oab-e2e+` and `oab-test+` users as human-checked (`test-users.mjs --human-checked`), so the suites keep working after Gate 9. Then remove the preview.

   ```bash
   . scripts/preview-preflight.sh
   P="docker compose -p oab-preview --env-file .env --env-file cloud/deploy-config/env-files/backend/.env --env-file cloud/deploy-config/env-files/frontend/.env -f cloud/deploy-config/compose.hosted.yml -f cloud/deploy-config/compose.preview.yml --profile local"
   preflight $P && $P up -d --build search renderer agent web
   APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e
   $P down
   ```

**Rollback.** Redeploy the previous agent first (Gate 7 step 8's retag, or its commit with the Gate 7 command), roll the web app back on Vercel (Instant Rollback), then restore the two old function bodies and clear the hook's mode comment. The M7 tables and functions stay, unused, and the migration history still lists both M7 versions: going forward again needs a new migration that re-creates the two functions, never a hand paste.

```bash
read -s LIVE_DB_URL
psql "$LIVE_DB_URL" -v ON_ERROR_STOP=1 -f cloud/supabase/rollback/m7.sql
psql "$LIVE_DB_URL" -XAtc "$(node cloud/supabase/scripts/check-old-bodies.mjs --query)" | node cloud/supabase/scripts/check-old-bodies.mjs
unset LIVE_DB_URL
```

## Open signups (Gate 9)

Gate 9 turns on `open` mode after Gate 8 has run and been burnt in. Do the steps in order; the last one opens signups, and `configure-auth.mjs` refuses it until steps 4 to 6 are done.

1. **Numbers.** Confirm the request limits in `cloud/deploy-config/env-files/backend/.env` (`LIMIT_RUNNING_PER_USER`, `LIMIT_REQUESTS_PER_HOUR`, `LIMIT_REQUESTS_PER_MONTH`, `LIMIT_RUNNING_SERVER`; defaults 1, 10, 50 and 8) and the signup caps in `public.signup_settings` (defaults 20 per hour, 100 per day, 3 per IP per day). Change the caps in the dashboard's SQL editor, for example `update public.signup_settings set signups_per_hour = 20, signups_per_day = 100, signups_per_ip_day = 3, updated_at = now() where id;`.
2. **Turnstile.** In the Cloudflare dashboard, Turnstile → Add widget (mode Managed). Its hostnames are the app's domain (`<APP_HOST>`) plus every Vercel preview hostname you test on (`<preview host>`); the widget refuses any other host. Copy its site key and secret key.
3. **Keys and redeploy.** Put the secret in `cloud/deploy-config/env-files/backend/.env` as `TURNSTILE_SECRET_KEY` (in an editor; never echo it), and the site key as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in `cloud/deploy-config/env-files/frontend/.env` and in Vercel (Settings → Environment Variables, Production). The site key is read at build time, so redeploy the web app on Vercel (Deployments → Redeploy), and redeploy the agent with the Gate 7 command. The agent log must not show `[signup] open mode needs TURNSTILE_SECRET_KEY`.
4. **Dummy-key check.** Neither file may hold one of Cloudflare's test keys (the agent refuses a test secret outside the local stack, and the web app a test site key outside a local Supabase, but check before you open). Each `grep -c` must print `0` (it exits 1 when nothing matches); the last two lines must each print `1`, proving the keys are set.

   ```bash
   grep -cE '^TURNSTILE_SECRET_KEY=[0-9]x0{30,}[A-Z]{2}$' cloud/deploy-config/env-files/backend/.env
   grep -cE '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=[0-9]x0{20}[A-Z]{2}$' cloud/deploy-config/env-files/frontend/.env
   grep -c '^TURNSTILE_SECRET_KEY=.' cloud/deploy-config/env-files/backend/.env
   grep -c '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.' cloud/deploy-config/env-files/frontend/.env
   ```

5. **Throwaway domains.** Load `cloud/supabase/data/disposable-domains.txt` into `public.blocked_email_domains` and check it (`0 missing, 0 extra`).

   ```bash
   set -a; . cloud/deploy-config/env-files/ops/.env; set +a
   node cloud/supabase/scripts/blocked-domains.mjs --apply
   node cloud/supabase/scripts/blocked-domains.mjs --check
   ```

6. **Terms and Privacy.** Replace or approve `cloud/web/content/terms.md` and `cloud/web/content/privacy.md`, remove their `<!-- DRAFT-NOT-REVIEWED -->` line, and merge; `/terms` and `/privacy` then show no draft banner. Both counts must print `0`:

   ```bash
   grep -c DRAFT-NOT-REVIEWED cloud/web/content/terms.md cloud/web/content/privacy.md
   ```

7. **Edge limits and email.** In Vercel → Firewall, add rate-limit rules (per IP, deny over the limit) for `/login`, `/auth/*` and `/api/human-check`. The Cloudflare tunnel exposes only the agent's host, and the agent answers 401 without the service secret (the first command prints `401`). Check the client IP forwarding: two access requests sent from two different networks get different IP-hash tags in the admin Requests list. In Resend, verify your sending domain (Domains → Add, then the DNS records), and set `SMTP_SENDER_EMAIL` in `cloud/deploy-config/env-files/ops/.env` to an address on it; step 10's `--apply` writes it to Supabase.

   ```bash
   AGENT_HOST="<public agent host>"
   curl -s -o /dev/null -w '%{http_code}\n' "https://$AGENT_HOST/profile"
   ```

8. **Required check.** On the `main` ruleset's required status checks, add `cloud-supabase` (the local Supabase stack job).
9. **Accept the risks.** Read "Accepted risks" in [SECURITY.md](SECURITY.md) and accept them: open signups let anyone drive the agent's browser tool from your egress IP (the private-network guard stays on for everyone but the admin); an attacker can fill the global signup caps and pause signups for real users; bots can drive Google's sign-in flow directly; the per-IP cap is best effort.
10. **Open.** The `--apply` refuses, listing each missing precondition, unless the M7 functions and the signup row exist, the hook carries the M7 marker, the throwaway list holds at least 1000 domains and the legal pages have no draft marker; it writes the mode before it turns GoTrue's signups on. Then check it.

    ```bash
    SIGNUP_MODE=open node cloud/supabase/scripts/configure-auth.mjs --apply --i-confirm-open-signups
    SIGNUP_MODE=open node cloud/supabase/scripts/configure-auth.mjs --check
    ```

11. **Watch.** For the first week, check the admin Usage tab daily: the signup counts for the last hour and day against the caps, the month's total and the running count.

### Emergency close

To stop new signups at once, go back to `waitlist`. `--close` needs only `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`: it turns GoTrue's signups off first, on their own (`disable_signup: true`, nothing else), checks that they are off, then writes the mode, so a key-drift or settings problem can't block it; existing accounts keep working, and their limits and human checks stay. Open again with step 10.

```bash
set -a; . cloud/deploy-config/env-files/ops/.env; set +a
SIGNUP_MODE=waitlist node cloud/supabase/scripts/configure-auth.mjs --close
```
