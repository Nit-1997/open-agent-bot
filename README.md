# Open Agent Bot

Personal, read-only research and planning agent: chat, widgets, and HTML artifacts.

```
web (Next.js + CopilotKit) → AG-UI → agent (Node + pi SDK) → llm (LiteLLM) → Ollama on the host
                                        ├─ search (SearXNG)
                                        └─ Chromium (guest-mode browsing, PDF rendering)
```

- Design: `docs/superpowers/specs/2026-10-27-open-agent-bot-design.md`
- What we learned about the stack: `docs/findings.md`

## Run

1. Install Docker and Ollama, and pull the model named in `deploy-config/.env-llm.example` (default `qwen3.5:35b`, needs Ollama ≥ 0.19 and ~31 GB free memory): `ollama pull qwen3.5:35b`. Optional: `launchctl setenv OLLAMA_MAX_LOADED_MODELS 1` to keep one model in memory
2. Create env files: `for f in llm agent nextjs search; do cp deploy-config/.env-$f.example deploy-config/.env-$f; done`
3. `docker compose up -d --build`
4. Open http://localhost:3000

Ports: web 3000, agent 8000, LiteLLM 4000, SearXNG 8081.

## Models

All model calls go through LiteLLM. The agent asks for an alias (`AGENT_MODEL`, default `chat-default`); `deploy-config/litellm/config.yaml` maps aliases to real models.

`chat-sonnet-5.5` (Claude Sonnet 5.5) is already defined; put `ANTHROPIC_API_KEY=...` in `deploy-config/.env-llm` to use it.

Users pick models in the app (a default during onboarding, and per chat from the header menu). The agent only offers the aliases listed in `AGENT_MODELS` in `deploy-config/.env-agent`, as `alias=Label=note` entries separated by `|`:

```
AGENT_MODELS=chat-sonnet-5.5=Sonnet 5.5=Best quality, about 5 cents a turn|chat-default=Qwen 3.5 (local)=Free and private; slower and weaker at cards
```

`AGENT_MODEL` stays the fallback when the browser doesn't ask for one. Avoid `$` in these values; Compose expands it.

## Develop

- Agent: `cd agent && npm test && npm run build` (live pi test: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npm test`)
- Web: `cd web && npm test && npm run build`

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.
