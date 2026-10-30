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

Manage models in the app: header model menu → **Manage models…** (or Profile → Manage models).

- **Cloud providers:** OpenAI, Anthropic, OpenRouter, Together AI, Groq and Google Gemini. Paste an API key, or use **Sign in with ChatGPT** for OpenAI, which uses your ChatGPT plan. Claude Pro/Max sign-in is not offered, because Anthropic's terms allow it only in Claude Code and Claude.ai.
- **Local servers:** Ollama, llama.cpp, LM Studio, or any OpenAI-compatible URL. Their models are discovered automatically. Use `host.docker.internal` for servers on this machine.
- **Choosing models:** each provider has a model picker, which controls what appears in the header menu, and a **Test** button that runs one tool call and shows its cost.

Keys are stored by the agent in `/data/agent` (the `agent-data` volume, owner-only) and are never sent back to the browser. pi's model runtime handles the provider calls; see `docs/superpowers/specs/2026-10-27-model-providers-design.md`.

The existing LiteLLM gateway still works as a provider named `litellm`, seeded from `LLM_BASE_URL`, `LLM_API_KEY` and `AGENT_MODELS` in `deploy-config/.env-agent`. `AGENT_MODEL` is the fallback default.

Sign in with ChatGPT redirects to `127.0.0.1:1455`, which compose publishes to localhost only. If the page doesn't finish on its own, paste the final URL from your browser into the panel.

There's no app login yet: anyone who can reach port 3000 can change keys. Keep ports bound to localhost until a settings password exists.

## Search and pictures

- Web search goes through SearXNG. Some engines rate-limit or CAPTCHA a home IP; Yahoo, Bing, Google, Qwant, Mojeek and Startpage are enabled so one working engine is enough.
- Optional fallback: set `BRAVE_SEARCH_API_KEY` in `deploy-config/.env-agent` (free tier at brave.com/search/api) and it is used whenever SearXNG returns nothing.
- Pictures come from the pages the agent reads (`images:` section), `image_search` (SearXNG images), `music` (iTunes Search: album and song art, Apple Music links) and `wikipedia` (places, people, topics). No keys needed.
- Cards show an image or link only if a tool returned it; otherwise the image is dropped and a placeholder is shown.

## Skills, Jev and codemode

- **Follow-ups**: the model ends its answer with `<followups>a | b</followups>`; the agent turns that line into the buttons under the reply.
- **Skills** live in `agent/skills/<name>/SKILL.md` (frontmatter `name`, `description`, then a playbook). The core prompt lists them and the agent loads one with `load_skill`. A new use case is a new folder; no code change.
- **Jev** (TypeSafe's calibrated classifier) judges product matches in `shop`, hotel brand/area/vibe wishes in `stays`, music cover art, which search hits to read, and research claims. It's reached through the OpenRouter key added in the app (`JEV_MODEL=openrouter/typesafe/jev-1.14`), or set `TYPESAFE_API_KEY` and `JEV_MODEL=typesafe/jev-latest`. If Jev is unreachable, every feature falls back to its non-Jev behavior.
- **Codemode**: models tagged `codemode` in `AGENT_MODEL_CAPS` (Sonnet) can write one script that runs many lookups and does the maths in code. A failed script turns codemode off for the rest of that chat.
- **Workspace**: carts, trips, events and shortlists are saved in `/data/agent/workspace.sqlite`, so "make it 16 kids" patches the plan, and a chat continues after an agent restart.

Design and results: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`, `docs/findings.md`.

## Evals

- `cd agent && npm run eval -- --model chat-sonnet-5.5` runs the scenarios in `agent/evals/scenarios/` against the running agent and writes `agent/evals/results/<date>-<label>-<model>/report.md`, diffed against `agent/evals/baseline/<model>.json`. Live runs cost money; `--only a,b` and `--runs N` keep them small.
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
