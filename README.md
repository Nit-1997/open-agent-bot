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

1. Install Docker and Ollama, and pull the model named in `deploy-config/.env-llm.example` (default `gemma4:latest`): `ollama pull gemma4`
2. Create env files: `for f in llm agent nextjs search; do cp deploy-config/.env-$f.example deploy-config/.env-$f; done`
3. `docker compose up -d --build`
4. Open http://localhost:3000

Ports: web 3000, agent 8000, LiteLLM 4000, SearXNG 8081.

## Models

All model calls go through LiteLLM. The agent asks for an alias (`AGENT_MODEL`, default `chat-default`); `deploy-config/litellm/config.yaml` maps aliases to real models.

To add a hosted model, e.g. Claude:

```yaml
  - model_name: chat-strong
    litellm_params:
      model: anthropic/claude-sonnet-5-5
      api_key: os.environ/ANTHROPIC_API_KEY
```

Put `ANTHROPIC_API_KEY=...` in `deploy-config/.env-llm`, set `AGENT_MODEL=chat-strong` in `deploy-config/.env-agent`, then `docker compose up -d`.

To use Qwen 3.5 9B locally: upgrade Ollama, `ollama pull qwen3.5:9b`, set `OLLAMA_CHAT_MODEL=ollama_chat/qwen3.5:9b` in `deploy-config/.env-llm`.

## Develop

- Agent: `cd agent && npm test && npm run build` (live pi test: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npm test`)
- Web: `cd web && npm test && npm run build`

## Safety rails

- The browser tool works as a guest. Code refuses checkout, cart, payment, login, sign-up and booking steps and hands back the link.
- Artifacts are served with `Content-Security-Policy: sandbox allow-scripts` and shown in a sandboxed iframe.
