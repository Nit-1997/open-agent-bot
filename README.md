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

1. Install Docker.
2. `docker compose up -d`
3. Open http://localhost:3000

No env files and no edits. On first start the agent generates the web↔agent secret (on the `shared` volume) and SearXNG generates its own (on `searxng-data`). The app then walks you through a short setup: add a model provider, tell it where home is, how you travel and where you shop. Every key (chat providers, Jev, Brave Search) is added in the app and kept on the `agent-data` volume, owner-only, never sent back to the browser.

Ports, all bound to 127.0.0.1: web 3000, agent 8000, SearXNG 8081 (LiteLLM 4000 and Ollama 11434 when turned on).

There is no login yet: anyone who can reach port 3000 can change keys and read your profile. Run it only on your own machine and keep the ports on localhost.

The agent and web containers run as non-root users (`pwuser`, `node`) and report health to Docker. If your volumes were created by an older build that ran as root, hand them over once: `docker compose run --rm --no-deps --user root --entrypoint chown agent -R pwuser:pwuser /data/agent /data/artifacts`.

### Optional: Ollama in Docker

`docker compose --profile ollama up -d` runs Ollama on port 11434. An Ollama already running on the host works too: in the app, Models → Ollama → Connect (`http://host.docker.internal:11434/v1`).

### Optional: LiteLLM gateway

The old gateway is an opt-in profile. Create `deploy-config/.env-llm` with `LITELLM_MASTER_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_OPENAI_BASE_URL` (e.g. `http://host.docker.internal:11434/v1`) and `OLLAMA_CHAT_MODEL` (e.g. `openai/qwen3.5:35b`) for the models in `deploy-config/litellm/config.yaml`, and `deploy-config/.env-agent` with `LLM_API_KEY` set to the same master key. Then `COMPOSE_PROFILES=litellm docker compose up -d`. The gateway appears as the `litellm` provider with every model it serves (or only those in `AGENT_MODELS`).

### Settings reference

Everything is optional. Put agent settings in `deploy-config/.env-agent` (git-ignored); compose reads it if it exists.

| Variable | Default | What it does |
| --- | --- | --- |
| `LLM_API_KEY` | unset | Turns on the LiteLLM gateway provider (with the `litellm` profile) |
| `LLM_BASE_URL` | `http://llm:4000/v1` | Where the gateway is |
| `AGENT_MODELS` | all gateway models | Gateway models to offer: `id=Label=note\|id2=Label` |
| `AGENT_MODEL_CAPS` | Sonnet models get `codemode` | Per-model capabilities: `provider/model=codemode\|other=none` |
| `JEV_MODEL` | `typesafe/jev-latest`, then `openrouter/typesafe/jev-1.14` | Pin the Jev classifier to one provider/model |
| `JEV_CONCURRENCY` | `64` | Jev requests in flight across all chats |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. `debug` also logs prompts, tool arguments and the profile |
| `AGENT_SHARED_SECRET` | generated | Use a fixed web↔agent secret instead (set the same value for web) |

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
- **Workspace**: carts, trips, events and shortlists are saved in `/data/agent/workspace.sqlite`, so "make it 16 kids" patches the plan, and a chat continues after an agent restart.

Design and results: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`, `docs/findings.md`.

## Evals

- `cd agent && npm run eval -- --model openrouter/anthropic/claude-sonnet-5.5` runs the scenarios in `agent/evals/scenarios/` against the running agent and writes `agent/evals/results/<date>-<label>-<model>/report.md`, diffed against `agent/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small. The shared secret is read from the running agent container (or `AGENT_SHARED_SECRET`).
- `npm run eval:rank` scores shop ranking on the ESCI grocery slice (Exact@1, NDCG@3); add `-- --judge` with an OpenRouter key to score the Jev re-rank.
- `npx tsx evals/run.ts --rescore <results dir>` re-grades saved runs after assertions change.

## Develop

- Agent: `cd agent && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` (live pi test: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npm test`)
- Web: `cd web && npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, how to add a tool, and conventions. Report security issues as described in [SECURITY.md](SECURITY.md).

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.

## License

[MIT](LICENSE)
