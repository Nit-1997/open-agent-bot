# Open Agent Bot

Personal read-only agent: chat, widgets, and HTML artifacts. Next.js + CopilotKit → AG-UI → pi (Node) → LiteLLM → Ollama.

Design: `docs/superpowers/specs/2026-10-27-open-agent-bot-design.md`

## Run

1. Install Docker and Ollama. Pull the model named in `deploy-config/.env-llm` (default `gemma4:latest`).
2. Copy env files: `for f in llm agent nextjs search; do cp deploy-config/.env-$f.example deploy-config/.env-$f; done`
3. `docker compose up -d --build`
4. Open http://localhost:3000

## Models

Add an alias to `deploy-config/litellm/config.yaml`, put any provider key in `deploy-config/.env-llm`, then set `AGENT_MODEL` in `deploy-config/.env-agent` and `docker compose up -d`.
