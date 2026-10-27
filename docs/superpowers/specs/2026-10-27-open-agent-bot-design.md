# Open Agent Bot — Design

Date: 2026-10-27
Status: Approved in conversation, pending builder check

## Intent

A personal, general-purpose agent that feels like ChatGPT but answers with rich UI: chat text, purpose-built widgets, and agent-generated HTML artifacts. It does the legwork for everyday questions — searching, checking real websites, planning — and hands back something useful.

This is a prototype to test whether the stack (CopilotKit + AG-UI + pi harness) works well together, and to feel out how useful such an agent is day to day. Cost matters: run as cheaply as possible, local model first.

## Use cases (v1)

1. **Shopping checks** — "Is X in stock, where, at what price?" Read-only. No cart, no checkout.
2. **Research** — "I'm wondering about X." Search multiple sources, synthesize, optionally produce a report (HTML artifact, downloadable as PDF).
3. **Travel lookups** — flight availability, weather at a destination.
4. **Planning** — e.g. "Diwali party for 25 people": headcount-based menu, quantities, where to buy, availability.
5. **Build me something** — explicitly later; v1 only needs the artifact path, which this builds toward.

A typical session: one goal, one fresh conversation, roughly 10–40 messages until done.

## Goals

- Stream chat responses with visible tool activity (user sees "searching…", "opening page…").
- Render structured results as native widgets.
- Render agent-written HTML as an inline artifact with full-screen view and PDF download.
- Run against a local model by default; switch to a hosted model by config only.
- Mobile-first UI that also works well on desktop.
- Whole stack starts with one `docker compose up`.

## Non-goals (v1)

- Multi-user, auth, accounts.
- Long-term memory, user profiles, cross-session context. Each session is fresh.
- Long-running/background sessions.
- Persisting conversation history across server restarts.

## Anti-goals

- **Never cross into commitment**: no payments, checkouts, logins, account creation, or anything that books/reserves on the user's behalf. At that point the agent stops and hands back a link plus steps ("search X, pick Y, then book it yourself here").
- Never present invented data as looked-up data. If a tool fails or a site blocks, say so explicitly.
- Artifacts must not be able to reach the parent page (no same-origin script access).

## Architecture

```
┌──────────────────────────┐   HTTP (CopilotKit)   ┌────────────────────────────────┐
│ web  (Next.js)           │ ───────────────────▶  │ agent  (Node)                   │
│  - Chat UI + widgets     │                       │  - AG-UI endpoint (SSE)         │
│  - Artifact viewer       │ ◀─────────────────── │  - Session manager              │
│  - CopilotKit runtime    │   AG-UI event stream  │  - pi SDK session per thread    │
│    (API route)           │                       │  - Custom tools                 │
└──────────────────────────┘                       │  - Artifact store (disk)        │
                                                   └───────────────┬────────────────┘
                                                                   │
                                     Ollama (host)  /  OpenRouter or Anthropic (optional)
```

### Decided

- **No Python layer.** pi is TypeScript; the "proxy" is a Node service that embeds pi via its SDK (`@earendil-works/pi-coding-agent`, `createAgentSession()`, `session.subscribe()`), rather than spawning pi in RPC mode. This removes a process boundary and a language boundary.
- **Two services** in Docker Compose: `web` and `agent`. Ollama runs on the host and is reached from the `agent` container.
- **web**: Next.js + CopilotKit. The CopilotKit runtime lives in a Next.js API route and is configured with the agent server as an AG-UI HTTP agent.
- **agent**: Small Node HTTP server exposing one AG-UI run endpoint. Responsibilities:
  - Map AG-UI `threadId` → a live pi session (in memory). New thread = new session.
  - Feed the latest user message into `session.prompt()`.
  - Translate pi events to AG-UI events: text deltas → `TEXT_MESSAGE_*`; tool execution → `TOOL_CALL_*`; run boundaries → `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`.
  - Serve artifact files (`GET /artifacts/:id`, `GET /artifacts/:id.pdf`).
- **Models**: default is a ~9B Qwen via Ollama. Optional hosted model (OpenRouter or Anthropic) selected via env. Model choice is config, not code.
- **Tools** (registered as pi custom tools):
  | Tool | Purpose |
  |------|---------|
  | `web_search` | Search the web, return titles/URLs/snippets |
  | `fetch_page` | Fetch a URL and return readable text |
  | `browse` | Headless Playwright, stateful per thread. Can navigate, click, type into search/filter/location inputs, and pick options, as a guest. Returns rendered text (optionally a screenshot). See browse policy below |
  | `weather` | Current + forecast for a location |
  | `flights` | Flight availability/prices between two places on dates |
  | `show_widget` | Emit a typed widget payload to the UI (see below) |
  | `create_artifact` | Save agent-written HTML; return an artifact id |
- **Browse policy** (owner's decision): guest-mode interaction is allowed — typing a PIN/ZIP, searching, filtering, choosing dates, selecting a store or variant. It must stop before payment, checkout, login, or sign-up. This is enforced in code, not only in the prompt: the tool refuses actions on URLs/elements matching checkout/cart/payment/login/sign-in/account patterns and on password or card-number fields, and returns "stopped at checkout — here is the link" instead. One browser context per thread, closed when the session ends.
- **Blocked sites are acceptable** (owner's decision). If a site blocks the headless browser, the tool reports it and the agent says so and offers the link. No stealth plugins, proxies, or paid scraping APIs in v1.
- **User context injection** (owner's decision): the web client sends the browser's time zone, locale, and current local time with each run (AG-UI `context`/forwarded props). The agent server injects these into the system prompt. The agent infers region from them (e.g. America/Los_Angeles → US stores, USD, °F; Asia/Kolkata → amazon.in/Flipkart, INR, °C) unless the user names a specific site/region. It asks a clarifying question only when the request is genuinely ambiguous (e.g. no city for weather and nothing to infer from).
- pi's built-in coding tools (shell, file write/edit) are **disabled** for v1. Only the tools above are active. They can be reconsidered for the "build me something" use case later.
- **Two output paths**:
  - **Widgets**: fixed set, agent sends data, React renders. v1 set: `weather_card`, `flight_list`, `product_comparison` (item, store, price, in-stock, link), `plan_checklist` (sections of items with quantities/notes). Delivered as an AG-UI tool call that CopilotKit renders with a registered React component.
  - **Artifacts**: agent writes full HTML via `create_artifact`; UI shows an artifact card that opens the HTML in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`), with "Full screen" and "Download PDF". PDF is rendered server-side from the HTML with Playwright.
- **Secrets/config** live in `deploy-config/`: `.env-nextjs` for web, `.env-agent` for the agent. All `.env*` files are gitignored; commit `.env.example` versions.
- **Project conventions** (from the owner's standing instructions): every HTML element in the web app gets a unique `id`; avoid unnecessary comments; `npm run build` must pass before each commit; rebuild/restart containers after major changes.

## Deployment

- **v1 (owner's decision):** localhost only, single user, everything in one Docker Compose, model running locally. No auth.
- **Ollama placement (my call):** on macOS, Docker containers can't use the Apple GPU, so Ollama in a container is CPU-only and much slower. Default is Ollama on the host, reached via `host.docker.internal`. The compose file includes an optional `ollama` service behind a profile for Linux/GPU hosts and EC2.
- **Later (not v1, but don't paint into a corner):** whole compose on EC2; or `web` on Vercel and `agent` on EC2; models via hosted API keys. Implications for v1: all URLs/hosts come from env, the agent's base URL is configurable, artifacts are served through `web` (proxied) so only `web` needs to be public, and the agent endpoint accepts an optional shared-secret header (off by default) so auth can be switched on later.
- Hosted API keys: the owner will provision one if needed. The first experiment is local-only.

## Model expectations (my call)

The local ~9B model is the target, not a gate. All five success criteria are attempted locally first; any that only pass on the hosted model are recorded as findings rather than treated as failures. To help the small model: few tools, page text trimmed before it reaches the model, widget payloads validated server-side with clear error messages back to the model.

## If pi can't do something assumed here (my call)

The point of the prototype is to test this stack. If the pi SDK can't disable built-ins, register custom tools, or reach a provider by config, record it as a finding in `docs/findings.md`, apply the smallest workaround that keeps pi as the harness, and keep going. Don't replace pi with a hand-rolled loop.

## Error handling

- Tool failures surface as visible tool results ("site blocked the request", "no flights found") and the model is told to report them, not guess.
- Model/provider failures become `RUN_ERROR` and show in the UI with a retry button.
- If the agent server restarts, the in-memory session is gone; the UI shows "session expired, start a new chat" rather than silently continuing.

## Left to the builder

- Agent HTTP framework (Hono/Express/Fastify).
- Search provider (e.g. Brave/Tavily/SearXNG); prefer free tier or self-hostable.
- Weather and flight data providers; prefer free tiers. If no usable free flight API exists, `flights` may use `browse` against a public flight search page and say so in the result.
- Exact CopilotKit and AG-UI package versions, and whether the CopilotKit runtime uses `HttpAgent` or an in-process `AbstractAgent` subclass. Prefer whichever the current CopilotKit docs support most directly.
- System prompt wording, including how strongly to steer the model toward widgets vs. artifacts.
- UI visual design within "mobile-first, clean chat".
- Artifact storage layout on disk.

## Success looks like

Running locally, the owner can:
1. Ask "weather in Pune this weekend" → weather widget.
2. Ask "is the Sony WH-1000XM5 in stock near me?" → product comparison widget for the inferred region's stores, built from actually loaded pages, with "blocked" shown honestly where a site refused.
3. Ask "flights SFO→BLR on Dec 15" → flight list widget plus booking links, or an explicit "couldn't get live data".
4. Plan a Diwali party for 25 → plan checklist widget, and on request an HTML artifact downloadable as PDF.
5. Ask an open research question → streamed answer with sources, optionally a report artifact.

Attempted on the local model first; the hosted model is a one-line switch, and which criteria needed it is recorded.
