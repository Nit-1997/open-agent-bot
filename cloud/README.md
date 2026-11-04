# Hosted deployment

The invite-only hosted deployment. Everything in `cloud/` is hosted-only; the open-source app builds and runs without this folder.

## Run the hosted stack

> **Warning.** The root `docker-compose.yml` is the local stack (project `open-agent`). Every hosted command needs `-f cloud/deploy/compose.hosted.yml`: bare `docker compose ps`, `logs`, `down`, `restart` and `up` target the local project, not the hosted one. `cloud/deploy/compose.hosted.yml` pins the project name `open-agent-bot`, so the existing containers and volumes are reused.

Open Agent is invite-only. Accounts, sessions and every user's data live in one Supabase project; the agent and the web app keep nothing on disk.

1. Install Docker, Node 22 and `jq` (the preview preflight uses it).
2. Fill in the env files (git-ignored; templates with names only are in `cloud/deploy/env.examples/`):
   - `cloud/deploy/.env-agent`: Supabase URL and keys, `AGENT_SERVICE_SECRET` (`openssl rand -hex 32`), `CREDENTIAL_KEYS` (`v1:` + `openssl rand -base64 32`), `ACCESS_REQUEST_PEPPER` (`openssl rand -base64 32`), `APP_ORIGIN=https://app.localhost`.
   - `cloud/deploy/.env-renderer`: only `RENDERER_SECRET` (`openssl rand -hex 32`); put the same value in `.env-agent`.
   - `cloud/deploy/.env-nextjs`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, and the same `AGENT_SERVICE_SECRET`.
   - `cloud/deploy/env-files/.env-supabase-admin` (owner's machine only): the Management API token, the `admin_scripts` secret key, Google OAuth client, Resend key.
   - From a checkout that still has them in `deploy-config/`: `node cloud/deploy/scripts/env-files.mjs --from <that checkout>/deploy-config --to cloud/deploy --copy` (add `--dry-run` first; it prints names, modes and sizes only, creates each file `0600` and never overwrites one).
3. Set up Supabase once: apply `cloud/supabase/migrations/` in order, then `set -a; . cloud/deploy/env-files/.env-supabase-admin; set +a; node cloud/supabase/scripts/configure-auth.mjs --apply` and `node cloud/supabase/scripts/bootstrap-admin.mjs <your email>`. If you use the Supabase CLI, run it as `supabase --workdir cloud …`.
4. `docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local up -d --build` (the env file feeds the web image's `NEXT_PUBLIC_*` build args).
5. Trust Caddy's local CA once: `docker compose -f cloud/deploy/compose.hosted.yml cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`.
6. Open https://app.localhost and sign in with Google using the bootstrapped email. The agent is at https://agent.localhost (it needs the service secret and a user token).

Visitors ask for access at `/request-access`; the admin approves them at `/admin`, which sends the invite email. Users add their own model keys in the app; keys are encrypted by the agent and never sent back to the browser.

To run a preview beside a running stack, work in a second checkout or worktree, never the one that runs the stack. In that checkout, first create a git-ignored `.env` containing `COMPOSE_PROJECT_NAME=oab-<name>` at the root and in `cloud/deploy/` (`printf 'COMPOSE_PROJECT_NAME=oab-guard\n' | tee .env cloud/deploy/.env`; Compose reads `.env` from the compose file's folder), so unqualified compose commands there never reach the live project; `docker compose config --format json | jq -r .name` and `docker compose -f cloud/deploy/compose.hosted.yml config --format json | jq -r .name` must both print that name. Then use another project name and the preview override: `. scripts/preview-preflight.sh`, `P="docker compose -p oab-preview --env-file .env --env-file cloud/deploy/.env-nextjs -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --profile local"`, `preflight $P && $P up -d --build search renderer agent web` (agent on 127.0.0.1:18800, web on http://localhost:18300). `preflight` returns 1 unless the project name starts with `oab-`, every published port is on 127.0.0.1 and at 18000 or above, and any `PREVIEW_AGENT_PORT` / `PREVIEW_WEB_PORT` is in 18000–19999; scripts call it as `preflight … || exit 1`. For a second local stack, use `-p oab-<name>` with `OPEN_AGENT_PORT` in 18000–19999 and `OPEN_AGENT_DATA_VOLUME` / `OPEN_AGENT_KEYS_VOLUME` starting with `oab-`; `preflight` refuses any volume name that doesn't start with `oab-`.

Ports bound to 127.0.0.1: Caddy 80/443 and the agent's 8000 for debugging (LiteLLM 4000 and Ollama 11434 when turned on). SearXNG is reachable only from the agent.

The agent refuses to start if a provider key such as `OPENAI_API_KEY` is set in its environment, because it would serve every user. The operator LiteLLM gateway (`LLM_API_KEY`) and private-network model servers are available to the admin only.

### Deploy

The web app runs on Vercel (Root Directory `cloud/web`, "Include files outside the root directory" on, Production env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `AGENT_URL=https://<AGENT_HOST>`, `AGENT_SERVICE_SECRET`; nothing for Preview). The agent, SearXNG and Caddy run on EC2: create `cloud/deploy/.env-agent` (same `CREDENTIAL_KEYS` and pepper as local, `APP_ORIGIN=https://<APP_HOST>`, a new `RENDERER_SECRET`), `cloud/deploy/.env-renderer` (that `RENDERER_SECRET` only) and `cloud/deploy/.env-caddy` (`AGENT_HOST`, `ACME_EMAIL`), then `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose -f cloud/deploy/compose.hosted.yml up -d --build`. Require IMDSv2 with hop limit 1, open 80/443 only, and set `PROD_ORIGIN`/`SITE_URL` in `.env-supabase-admin` before rerunning `configure-auth.mjs --apply`. The renderer runs Chromium with its sandbox, which needs unprivileged user namespaces: Amazon Linux 2023 allows them; on Ubuntu 23.10 or later, check `sysctl kernel.apparmor_restrict_unprivileged_userns` is `0` (or give Docker an AppArmor profile that allows `userns`). If the sandbox can't start, the renderer exits and stays unhealthy, and cards show the plain fallback until it's fixed; the agent keeps working. Runs end at `RUN_TIME_LIMIT_SECONDS` (default 280) to stay inside Vercel's `maxDuration = 300`.

### Optional: Ollama in Docker

`docker compose -f cloud/deploy/compose.hosted.yml --profile ollama up -d` runs Ollama on port 11434. As the admin, add it in the app: Models → Ollama → Connect (`http://host.docker.internal:11434/v1`).

### Optional: LiteLLM gateway

The gateway is an opt-in profile and is offered to the admin only. Create `cloud/deploy/.env-llm` with `LITELLM_MASTER_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_OPENAI_BASE_URL` and `OLLAMA_CHAT_MODEL` for the models in `cloud/deploy/litellm/config.yaml`, and set `LLM_API_KEY` in `cloud/deploy/.env-agent` to the same master key. Then add the `litellm` profile to the compose command.

### Settings reference

Agent settings live in `cloud/deploy/.env-agent` (git-ignored).

| Variable | Default | What it does |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | required | The Supabase project; the secret key is the agent's own `sb_secret_…` key |
| `AGENT_SERVICE_SECRET` | required | 64 hex chars shared with the web app |
| `CREDENTIAL_KEYS` | required | Master keys for stored provider keys, `v2:<base64>,v1:<base64>`, first is current. Rotate with `docker compose -f cloud/deploy/compose.hosted.yml exec agent node dist/scripts/rotateCredentials.js` |
| `ACCESS_REQUEST_PEPPER` | required | Base64 of 32 bytes; hashes visitor IPs |
| `APP_ORIGIN` | required | The web app's origin, used for email links |
| `RUN_TIME_LIMIT_SECONDS` | `280` | A run ends cleanly after this long |
| `RENDERER_SECRET` | required | 64 hex chars shared with the renderer (`cloud/deploy/.env-renderer`); must differ from `AGENT_SERVICE_SECRET` |
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

## Develop the hosted stack

To work on one side of the hosted stack, run the other in Docker and point at it:

- Agent: `cd cloud/agent && npm run build && set -a && . ../deploy/.env-agent && set +a && COPILOTKIT_TELEMETRY_DISABLED=true npm start` (`tsc -b` builds `@oab/shared`, `@oab/bff` and `@oab/core` and then the hosted agent into `cloud/agent/dist/`; settings in the reference table above). The agent refuses to start unless `COPILOTKIT_TELEMETRY_DISABLED=true`; set it for every host-run agent, script and eval. The agent image sets it already.
- Web: `cd cloud/web && set -a && . ../deploy/.env-nextjs && set +a && AGENT_URL=http://localhost:8000 npm run dev`

Both need the same `AGENT_SERVICE_SECRET` and a Supabase project (see "Run the hosted stack" above). Sign-in cookies are `Secure`, so use the Caddy stack at https://app.localhost for anything that needs a session. The checks for the cloud workspaces are in CONTRIBUTING's checks table; the cloud boundary (nothing outside `cloud/` imports or builds from it) is in CONTRIBUTING's "Cloud boundary".

## End-to-end demo

`cloud/e2e/` drives a preview stack with Playwright on desktop, tablet and phone sizes. It creates `oab-e2e+shell@example.test` and `oab-e2e+other@example.test`, seeds chats, reports and saved cards, and removes them afterwards with `cloud/supabase/scripts/cleanup-e2e.mjs`. It reads `cloud/deploy/env-files/.env-supabase-admin` and needs `E2E_OPENROUTER_KEY` in `cloud/deploy/env-files/.env-e2e` (saved through the app's API, never typed or logged; the run uses DeepSeek V4 Flash).

Every Playwright project (`desktop`, `tablet`, `phone`, `smoke`, `preview-m1`, `preview-m2`) needs `APP_ORIGIN` set on the command, and refuses anything but `http://localhost` or `http://127.0.0.1` on a port in 18000–19999. `APP_ORIGIN` and the opt-in below are never read from the env files. To target any other origin on purpose, also set `E2E_ALLOW_LIVE=1` on the command.

```bash
npm ci && APP_ORIGIN=http://localhost:18300 npm run demo -w @oab/cloud-e2e
```

`make-demo.mjs` needs `ffmpeg` and joins the recordings into `~/Downloads/app-shell-demo.mp4`.

The `smoke` project (`cloud/e2e/preview-smoke.spec.ts`) runs on its own against a fresh preview: `APP_ORIGIN=http://localhost:18300 npm run smoke -w @oab/cloud-e2e` signs in, completes onboarding, and checks that a reply streams and that Stop ends a run. `APP_ORIGIN=http://localhost:18300 npm run m1 -w @oab/cloud-e2e` runs the M1 preview checks.

## Evals

- `cd cloud/agent && COPILOTKIT_TELEMETRY_DISABLED=true npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `packages/core/evals/scenarios/` against the running agent and writes `packages/core/evals/results/<date>-<label>-<model>/report.md`, diffed against `packages/core/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. Evals sign in as `EVAL_USER_EMAIL` (default `oab-eval@example.test`, created once with `bootstrap-admin.mjs oab-eval@example.test --user` and given a provider key in the app), reading `cloud/deploy/.env-agent` and `.env-supabase-admin`.
- `npx tsx evals/run.ts --target local --origin http://127.0.0.1:3000 --openrouter-key-env OPENROUTER_API_KEY --model openrouter/deepseek/deepseek-v4-flash` (from `packages/core`, where `local` is the default and only target) runs the same scenarios against the local stack with no Supabase: it saves the key from the named variable through the app, then posts each run to `/api/copilotkit/agent/openagent/run`. The signed-in path above runs from `cloud/agent`, whose `evals/run.ts` registers `--target hosted` (its default) on top of core's runner.
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.

## Switch-over after M6 (owner only)

M6 moved everything hosted into `cloud/`. Two owner steps put production on the new layout: Gate 6 points Vercel at `cloud/web`, and Gate 7 moves the live agent stack to `cloud/deploy`. The live stack runs commit `c1c0f4e` from the old checkout (`$OLD` below): its root `docker-compose.yml` has no `name:` (the project is `open-agent-bot` from the folder name), the agent and renderer build from `agent/Dockerfile`, the web from `web/Dockerfile`, and its containers bind files from that checkout's `deploy-config/`.

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

## Move the live stack to `cloud/deploy` (Gate 7)

**Never `git pull` the old checkout before the switch.** Its containers bind-mount files from its `deploy-config/`; a pull that moves them leaves the next container restart with empty directories in their place, and SearXNG and Caddy fail. The old checkout stays untouched as the rollback.

Run the steps in one terminal, from the fresh checkout:

```bash
OLD="<path of the old checkout>"
NEW="$HOME/open-agent-hosted"
AGENT_HOST="<public agent host>"
```

1. A fresh checkout of the M6 `main` commit. Never put a `.env` file in its `cloud/deploy/`: Compose reads `.env` from the compose file's folder, and a `COMPOSE_PROJECT_NAME` there would override `open-agent-bot`.

   ```bash
   git clone https://github.com/Nit-1997/open-agent-bot "$NEW"
   cd "$NEW"
   git checkout <main commit after M6>
   ```

2. Copy the settings files from the old checkout (names, modes and sizes only; each new file is `0600`, nothing is overwritten, the old files stay for the rollback). First list the git-ignored files in its `deploy-config/` (names only): every `.env-*` line must be one of the eight names the helper knows (`.env-agent`, `.env-renderer`, `.env-nextjs`, `.env-caddy`, `.env-llm`, `.env-search`, `env-files/.env-supabase-admin`, `env-files/.env-e2e`); anything else is reported `unknown (not moved)` below.

   ```bash
   git -C "$OLD" status --porcelain --ignored -- "$OLD/deploy-config"
   node cloud/deploy/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy --copy --dry-run
   node cloud/deploy/scripts/env-files.mjs --from "$OLD/deploy-config" --to cloud/deploy --copy
   ```

   An `unknown (not moved)` line (exit 2) names a file the helper doesn't know; copy it by hand only if the hosted stack uses it.

3. Config check under the new code, then a preview on spare ports. The check prints `hosted config ok`, a `ConfigError` message (names only, never values), or only an error's name and code:

   ```bash
   docker compose -p oab-gate7 -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local run --rm --no-deps --build agent node -e "import('./dist/config.js').then(m=>{try{m.loadHostedConfig(process.env);console.log('hosted config ok')}catch(e){console.log(e.name==='ConfigError'?e.message:e.name+' '+(e.code??''));process.exit(1)}})"
   . scripts/preview-preflight.sh
   P="docker compose -p oab-gate7 --env-file cloud/deploy/.env-nextjs -f cloud/deploy/compose.hosted.yml -f cloud/deploy/compose.preview.yml --profile local"
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
   docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local config --format json --no-env-resolution | jq '{name, volumes: [.volumes[].name]}'
   ```

5. Rollback point. Write down the old commit, the exact command you started the live stack with (for `c1c0f4e`, most likely `docker compose --env-file deploy-config/.env-nextjs --profile local up -d --build` run in the old checkout) and the running containers. The old layout also reads `$OLD/.env` for `CADDYFILE`, `CADDY_BIND` and `COMPOSE_PROFILES`; the new layout must not have a `.env` in `cloud/deploy/`, so record (names only) whether that file exists, which of those variables it sets, and which services run, then give step 6 the same values through the shell and the same `--profile` flags:

   ```bash
   test -f "$OLD/.env" && grep -oE '^(CADDYFILE|CADDY_BIND|COMPOSE_PROFILES)=' "$OLD/.env"
   docker ps --filter label=com.docker.compose.project=open-agent-bot --format '{{.Label "com.docker.compose.service"}}' | sort
   ```

   Then Then retag the images of the built services (agent, renderer, web), so `up --build` can't overwrite them; SearXNG and Caddy are pulled images pinned by digest and need nothing:

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
   docker compose -f cloud/deploy/compose.hosted.yml --env-file cloud/deploy/.env-nextjs --profile local up -d --build
   ```

7. Verify: every container is new and healthy, the volumes are the same, the agent answers locally and on its public host, and (after Gate 6 step 5) sign-in and a streamed chat work on the Vercel app. Confirm the tunnel (cloudflared) runs outside the compose project: `docker ps --filter label=com.docker.compose.project=open-agent-bot` must not list it. If it is a service of the project, check that it now points at the recreated agent, and re-point it if not.

   ```bash
   docker compose -f cloud/deploy/compose.hosted.yml ps
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

9. After a burn-in (a few days), delete the old checkout's settings files and the rollback tags. The root `.gitignore` and `.dockerignore` keep their legacy `deploy-config/` lines until then (a checkout of an older commit still has that folder); drop them in a cleanup change after this step. From then on, every hosted command runs in the new checkout with `-f cloud/deploy/compose.hosted.yml`; a docker compose command without `-f` targets the local project `open-agent` in any checkout.

   ```bash
   rm "$OLD"/deploy-config/.env-* "$OLD"/deploy-config/env-files/.env-*
   while read -r svc img tag; do docker image rm "$tag"; done < "$HOME/open-agent-rollback.txt"
   ```

The factory rehearsed these steps on `oab-` projects beside the live stack (M6 demo part 4): from `c1c0f4e` and from the pre-M6 (M3) layout, each switched to this layout with the volumes reused and rolled back through the retagged images.

### Old web app against the new agent

Between Gate 7 step 6 and Gate 6 step 5 the `c1c0f4e` web app talks to the new agent. Every agent call it makes (`/agui` through its `/api/copilotkit` route; `/chats`, `/chats/:id`, `/chats/:id/messages`; `/reports`, `/reports/:id`; `/search`, `/places`, `/models`, `/onboarding/options`; `/profile`; `/settings/brave-search[/key]`; `/providers` and its `local`, `test`, `logins/:flow[/answer]`, `:id`, `:id/key`, `:id/models` and `:id/login` subpaths; `/artifacts/:file` for HTML, `.pdf` and `.jpg`; `/auth/email-link`; `/access-requests`; and the admin `/admin/access-requests[/:id/(approve|reject|resend)]` and `/admin/users[/:id[/(deactivate|reactivate)]]` calls) maps onto a route of the new agent with the same method; the two agents register the same 38 method and path pairs, `/health` included. Demo part 4 switches `search renderer agent` first and runs the old web container's sign-in, chat, Stop, artifact (HTML and PDF) and request-access flows against the new agent (`npm run compat -w @oab/cloud-e2e`) before it switches the web app. After Stop, the old web app shows "Something went wrong talking to the agent. This operation was aborted": that's a known `c1c0f4e` bug (the post-revamp web app fixes it), not an incompatibility, and the live web app does the same today.
