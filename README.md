# Open Agent Bot

Personal, read-only research and planning agent: chat, widgets, and HTML artifacts.

```
web (Next.js + CopilotKit) → AG-UI → agent (Node + pi SDK) → model providers you add in the app
                                        ├─ search (SearXNG)
                                        └─ Chromium (guest-mode browsing, PDF rendering)
```

- Design: `docs/superpowers/specs/2026-10-27-open-agent-bot-design.md`
- What we learned about the stack: `docs/findings.md`

## Run

Open Agent is invite-only. Accounts, sessions and every user's data live in one Supabase project; the agent and the web app keep nothing on disk.

1. Install Docker and Node 22.
2. Fill in the env files (git-ignored; templates with names only are in `deploy-config/env.examples/`):
   - `deploy-config/.env-agent`: Supabase URL and keys, `AGENT_SERVICE_SECRET` (`openssl rand -hex 32`), `CREDENTIAL_KEYS` (`v1:` + `openssl rand -base64 32`), `ACCESS_REQUEST_PEPPER` (`openssl rand -base64 32`), `APP_ORIGIN=https://app.localhost`.
   - `deploy-config/.env-nextjs`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, and the same `AGENT_SERVICE_SECRET`.
   - `deploy-config/env-files/.env-supabase-admin` (owner's machine only): the Management API token, the `admin_scripts` secret key, Google OAuth client, Resend key.
3. Set up Supabase once: apply `supabase/migrations/` in order, then `set -a; . deploy-config/env-files/.env-supabase-admin; set +a; node supabase/scripts/configure-auth.mjs --apply` and `node supabase/scripts/bootstrap-admin.mjs <your email>`.
4. `docker compose --env-file deploy-config/.env-nextjs --profile local up -d --build` (the env file feeds the web image's `NEXT_PUBLIC_*` build args).
5. Trust Caddy's local CA once: `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`.
6. Open https://app.localhost and sign in with Google using the bootstrapped email. The agent is at https://agent.localhost (it needs the service secret and a user token).

Visitors ask for access at `/request-access`; the admin approves them at `/admin`, which sends the invite email. Users add their own model keys in the app; keys are encrypted by the agent and never sent back to the browser.

Ports bound to 127.0.0.1: Caddy 80/443 and the agent's 8000 for debugging (LiteLLM 4000 and Ollama 11434 when turned on). SearXNG is reachable only from the agent.

The agent refuses to start if a provider key such as `OPENAI_API_KEY` is set in its environment, because it would serve every user. The operator LiteLLM gateway (`LLM_API_KEY`) and private-network model servers are available to the admin only.

### Deploy

The web app runs on Vercel (Root Directory `web`, "Include files outside the root directory" on, Production env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGIN`, `AGENT_URL=https://<AGENT_HOST>`, `AGENT_SERVICE_SECRET`; nothing for Preview). The agent, SearXNG and Caddy run on EC2: create `deploy-config/.env-agent` (same `CREDENTIAL_KEYS` and pepper as local, `APP_ORIGIN=https://<APP_HOST>`) and `deploy-config/.env-caddy` (`AGENT_HOST`, `ACME_EMAIL`), then `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose up -d --build`. Require IMDSv2 with hop limit 1, open 80/443 only, and set `PROD_ORIGIN`/`SITE_URL` in `.env-supabase-admin` before rerunning `configure-auth.mjs --apply`. Runs end at `RUN_TIME_LIMIT_SECONDS` (default 280) to stay inside Vercel's `maxDuration = 300`. The full checklist is in the design spec's "Rollout and deploy".

### Optional: Ollama in Docker

`docker compose --profile ollama up -d` runs Ollama on port 11434. As the admin, add it in the app: Models → Ollama → Connect (`http://host.docker.internal:11434/v1`).

### Optional: LiteLLM gateway

The gateway is an opt-in profile and is offered to the admin only. Create `deploy-config/.env-llm` with `LITELLM_MASTER_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_OPENAI_BASE_URL` and `OLLAMA_CHAT_MODEL` for the models in `deploy-config/litellm/config.yaml`, and set `LLM_API_KEY` in `deploy-config/.env-agent` to the same master key. Then add the `litellm` profile to the compose command.

### Settings reference

Agent settings live in `deploy-config/.env-agent` (git-ignored).

| Variable | Default | What it does |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | required | The Supabase project; the secret key is the agent's own `sb_secret_…` key |
| `AGENT_SERVICE_SECRET` | required | 64 hex chars shared with the web app |
| `CREDENTIAL_KEYS` | required | Master keys for stored provider keys, `v2:<base64>,v1:<base64>`, first is current. Rotate with `docker compose exec agent node dist/agent/src/scripts/rotateCredentials.js` |
| `ACCESS_REQUEST_PEPPER` | required | Base64 of 32 bytes; hashes visitor IPs |
| `APP_ORIGIN` | required | The web app's origin, used for email links |
| `RUN_TIME_LIMIT_SECONDS` | `280` | A run ends cleanly after this long |
| `LLM_API_KEY` | unset | Turns on the LiteLLM gateway provider for the admin (with the `litellm` profile) |
| `LLM_BASE_URL` | `http://llm:4000/v1` | Where the gateway is |
| `AGENT_MODELS` | all gateway models | Gateway models to offer: `id=Label=note\|id2=Label` |
| `AGENT_MODEL_CAPS` | Sonnet models get `codemode` | Per-model capabilities: `provider/model=codemode\|other=none` |
| `JEV_MODEL` | `typesafe/jev-latest`, then `openrouter/typesafe/jev-1.14` | Pin the Jev classifier to one provider/model |
| `JEV_CONCURRENCY` | `64` | Jev requests in flight across all chats |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs prompts, tool arguments and the profile |

## Search and pictures

- Web search goes through SearXNG. Some engines rate-limit or CAPTCHA a home IP; Yahoo, Bing, Google, Qwant, Mojeek and Startpage are enabled so one working engine is enough.
- Optional fallback: add a Brave Search API key in the app (Models → Web search; free tier at brave.com/search/api) and it is used whenever SearXNG returns nothing.
- Pictures come from the pages the agent reads (`images:` section), `image_search` (SearXNG images), `music` (iTunes Search: album and song art, Apple Music links) and `wikipedia` (places, people, topics). No keys needed.
- Cards show an image or link only if a tool returned it; otherwise the image is dropped and a placeholder is shown.

## Skills, Jev and codemode

- **Follow-ups**: the model ends its answer with `<followups>a | b</followups>`; the agent turns that line into the buttons under the reply.
- **Skills** live in `agent/skills/<name>/SKILL.md` (frontmatter `name`, `description`, then a playbook). The core prompt lists them and the agent loads one with `load_skill`. A new use case is a new folder; no code change.
- **Jev** (TypeSafe's calibrated classifier) judges product matches in `shop`, hotel brand/area/vibe wishes in `stays`, music cover art, which search hits to read, and research claims. It uses whichever key you added in the app: TypeSafe first, then OpenRouter (`JEV_MODEL` pins one). If Jev is unreachable, every feature falls back to its non-Jev behavior.
- **Codemode**: Claude Sonnet models (from any provider), or models tagged `codemode` in `AGENT_MODEL_CAPS`, can write one script that runs many lookups and does the maths in code. A failed script turns codemode off for the rest of that chat.
- **Workspace and chats**: carts, trips, events and shortlists are saved per chat in Supabase, so "make it 16 kids" patches the plan. Chats and their messages are saved too; Recent chats in the profile drawer reopens them, and a chat continues after an agent restart.

Design and results: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`, `docs/findings.md`.

## Evals

- `cd agent && npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `agent/evals/scenarios/` against the running agent and writes `agent/evals/results/<date>-<label>-<model>/report.md`, diffed against `agent/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. Evals sign in as `EVAL_USER_EMAIL` (default `oab-eval@example.test`, created once with `bootstrap-admin.mjs oab-eval@example.test --user` and given a provider key in the app), reading `deploy-config/.env-agent` and `.env-supabase-admin`.
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.

## Develop

- Agent: `cd agent && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` (live pi test: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npm test`; Supabase integration tests against the real project: `npm run test:supabase`)
- Web: `cd web && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, how to add a tool, and conventions. Report security issues as described in [SECURITY.md](SECURITY.md).

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.

## License

[MIT](LICENSE)
