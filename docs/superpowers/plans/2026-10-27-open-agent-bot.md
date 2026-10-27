# Open Agent Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, single-user, ChatGPT-style agent that answers everyday questions (shopping checks, research, travel, planning) with streamed chat, typed widgets, and HTML artifacts.

**Architecture:** Next.js + CopilotKit (`web`) talks AG-UI over HTTP to a Node service (`agent`) that embeds the pi SDK, one pi session per AG-UI thread, and translates pi events into AG-UI events. All model calls go through a LiteLLM proxy (`llm`) that maps stable aliases to real models (Ollama on the host in v1). Web search runs through a self-hosted SearXNG (`search`).

**Tech Stack:** Node 22, TypeScript, Hono, `@earendil-works/pi-coding-agent`, `@ag-ui/core` + `@ag-ui/encoder`, Playwright, TypeBox, Vitest; Next.js (app router) + `@copilotkit/react-core` / `@copilotkit/react-ui` / `@copilotkit/runtime` + `@ag-ui/client`; LiteLLM proxy; SearXNG; Docker Compose; Ollama (host).

**Spec:** `docs/superpowers/specs/2026-10-27-open-agent-bot-design.md`

## Global Constraints

- Localhost only, single user, no auth in v1. Agent accepts an optional `x-agent-secret` header, enforced only when `AGENT_SHARED_SECRET` is set.
- Never pay, check out, log in, sign up, or book. Stop and hand back a link + steps.
- Never present invented data as looked up. Tool failures and blocked sites are reported, never papered over.
- pi built-in coding tools (read/bash/edit/write/grep/find/ls) are disabled. Only this plan's tools are active.
- pi has exactly one provider: `litellm`, OpenAI-compatible, base URL from `LLM_BASE_URL` (default `http://llm:4000/v1`). Model alias from `AGENT_MODEL` (default `chat-default`). LiteLLM v1 alias `chat-default` → `ollama_chat/<qwen ~9B tag>` at `http://host.docker.internal:11434`.
- Secrets/config in `deploy-config/`: `.env-nextjs`, `.env-agent`, `.env-llm`. All gitignored; commit `*.example` versions. No keys in code or compose.
- Every HTML element in `web` has a unique `id` across the project (prefix by component, e.g. `weather-card-temp-<toolCallId>`).
- Avoid unnecessary comments.
- `npm run build` passes in `agent` and `web` before every commit. After major changes: `docker compose up -d --build`.
- Artifacts are served to the browser only via `web` (`/api/artifacts/...`) and always with `Content-Security-Policy: sandbox allow-scripts`, rendered in an iframe with `sandbox="allow-scripts"` (never `allow-same-origin`).
- Page text returned to the model is capped at `MAX_PAGE_CHARS = 12000`, with a trailing `\n[truncated]` marker when cut.
- Idle sessions (and their browser contexts) are disposed after `SESSION_IDLE_MS = 30 * 60 * 1000`.
- Anything the pi SDK, CopilotKit, or LiteLLM can't do as assumed is recorded in `docs/findings.md` (what was assumed, what's true, the workaround). pi is never replaced by a hand-rolled loop.

## Review Focus

1. **User sends a new message while a run is still streaming on the same thread** → reject with `RUN_ERROR` code `THREAD_BUSY`, don't corrupt the session. Test: Task 4 `rejects concurrent run on same thread`.
2. **Agent restarted mid-conversation (unknown threadId, but history has earlier turns)** → `RUN_ERROR` code `SESSION_EXPIRED`; UI tells the user to start a new chat. Tests: Task 4 `expired thread yields SESSION_EXPIRED`, Task 8 `shows expired banner`.
3. **Browser tab closed / request aborted mid-run** → the pi run is aborted and the thread is free again. Test: Task 4 `client abort aborts pi run and frees thread`.
4. **Model sends a malformed `show_widget` payload** (small local model will) → tool returns a precise validation error to the model; nothing is rendered. Test: Task 5 `show_widget rejects invalid payload with path-level errors`.
5. **Huge or binary pages** (PDF links, 2MB HTML) → text is trimmed to `MAX_PAGE_CHARS`; non-text content types return `unsupported content-type <type>` instead of garbage. Test: Task 6 `fetch_page truncates and rejects binary`.

---

## File Structure

```
docker-compose.yml
deploy-config/.env-agent.example  .env-llm.example  .env-nextjs.example
deploy-config/litellm/config.yaml
deploy-config/searxng/settings.yml
docs/findings.md
shared/widgets.ts                  TypeBox schemas + Static types for widget payloads (imported by agent and web)
agent/
  package.json  tsconfig.json  vitest.config.ts  Dockerfile
  src/config.ts                    env → AgentConfig
  src/server.ts                    Hono app: POST /agui, GET /artifacts/:id(.pdf), GET /health
  src/pi/createPiSession.ts        builds a pi session wired to litellm + our tools
  src/pi/litellmProvider.ts        pi extension: registerProvider("litellm", …)
  src/agui/translate.ts            pure pi-event → AG-UI-event translator
  src/agui/runHandler.ts           one AG-UI run: busy/expired/abort, SSE encoding
  src/session/sessionStore.ts      threadId → SessionEntry, idle disposal
  src/prompt/systemPrompt.ts       buildSystemPrompt(userContext)
  src/tools/index.ts               registerTools(pi, deps)
  src/tools/text.ts                truncate(), htmlToText()
  src/tools/webSearch.ts  fetchPage.ts  weather.ts  flights.ts  browse.ts  browsePolicy.ts  showWidget.ts  createArtifact.ts
  src/artifacts/store.ts           save/get/renderPdf on disk
  test/**                          vitest, mirrors src
web/
  package.json  Dockerfile  next.config.ts
  app/layout.tsx  app/page.tsx
  app/api/copilotkit/route.ts      CopilotRuntime → HttpAgent(AGENT_URL/agui)
  app/api/artifacts/[id]/route.ts  proxy to agent, forces sandbox CSP
  components/Chat.tsx              CopilotChat + renderers + user context
  components/ToolActivity.tsx      default renderer for non-widget tools
  components/widgets/WeatherCard.tsx  FlightList.tsx  ProductComparison.tsx  PlanChecklist.tsx  WidgetRenderer.tsx
  components/artifacts/ArtifactCard.tsx  ArtifactViewer.tsx
  lib/userContext.ts               getUserContext()
  test/**
```

---

### Task 1: Compose skeleton with LiteLLM and SearXNG

**Files:**
- Create: `docker-compose.yml`, `deploy-config/.env-llm.example`, `deploy-config/.env-agent.example`, `deploy-config/.env-nextjs.example`, `deploy-config/litellm/config.yaml`, `deploy-config/searxng/settings.yml`, `docs/findings.md`, `README.md`

**Interfaces:**
- Produces: `llm` at `http://llm:4000/v1` (host port 4000) serving alias `chat-default` with OpenAI tool-calling; `search` at `http://search:8080/search?q=…&format=json` (host port 8081). Services `agent`/`web` are declared but commented out until Tasks 4/8.

- [ ] **Step 1:** Write `deploy-config/litellm/config.yaml` with `model_list: [{model_name: chat-default, litellm_params: {model: ollama_chat/${OLLAMA_MODEL}, api_base: os.environ/OLLAMA_BASE_URL}}]` and `general_settings.master_key: os.environ/LITELLM_MASTER_KEY`. `.env-llm.example`: `LITELLM_MASTER_KEY=sk-local-dev`, `OLLAMA_BASE_URL=http://host.docker.internal:11434`, `OLLAMA_MODEL=qwen3.5:9b` (implementer: use the Qwen ~9B tag actually pulled locally; record it in README).
- [ ] **Step 2:** Write `searxng/settings.yml` with `use_default_settings: true`, `search.formats: [html, json]`, `server.secret_key` from env, `server.limiter: false`.
- [ ] **Step 3:** `docker-compose.yml`: `llm` (`ghcr.io/berriai/litellm:main-stable`, `--config /app/config.yaml`, `env_file: deploy-config/.env-llm`, `extra_hosts: ["host.docker.internal:host-gateway"]`), `search` (`searxng/searxng`, mounted settings). An `ollama` service under `profiles: [ollama]`.
- [ ] **Step 4: Verify LiteLLM tool calling end to end**

Run: `cp deploy-config/.env-llm.example deploy-config/.env-llm && docker compose up -d llm search && curl -s localhost:4000/v1/chat/completions -H 'Authorization: Bearer sk-local-dev' -H 'content-type: application/json' -d '{"model":"chat-default","messages":[{"role":"user","content":"weather in Pune?"}],"tools":[{"type":"function","function":{"name":"weather","parameters":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}}]}' | jq '.choices[0].message.tool_calls[0].function'`
Expected: `{"name":"weather","arguments":"{\"location\":\"Pune\"…}"}`. If no tool_calls, record in `docs/findings.md` and try another local model tag before moving on.

- [ ] **Step 5: Verify search**

Run: `curl -s 'localhost:8081/search?q=diwali+sweets&format=json' | jq '.results | length'`
Expected: a number > 0.

- [ ] **Step 6:** `docs/findings.md` starts with a heading and a table: `| Area | Assumed | Actual | Workaround |`. Commit: `chore: compose skeleton with LiteLLM and SearXNG`.

---

### Task 2: pi session wired to LiteLLM

**Files:**
- Create: `agent/package.json`, `agent/tsconfig.json`, `agent/vitest.config.ts`, `agent/src/config.ts`, `agent/src/pi/litellmProvider.ts`, `agent/src/pi/createPiSession.ts`
- Test: `agent/test/config.test.ts`, `agent/test/pi/createPiSession.int.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv): AgentConfig` where `AgentConfig = { port: number; llmBaseUrl: string; llmApiKey: string; model: string; searxngUrl: string; artifactsDir: string; sharedSecret?: string }` (defaults: `8000`, `http://llm:4000/v1`, required, `chat-default`, `http://search:8080`, `/data/artifacts`).
  - `litellmProvider(cfg: AgentConfig): (pi: ExtensionAPI) => void` — calls `pi.registerProvider("litellm", { baseUrl, apiKey, api: "openai-completions", models: [{ type: "chat", id: cfg.model, name: cfg.model, reasoning: false, input: ["text"], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 32768, maxTokens: 4096 }] })`.
  - `createPiSession(opts: { cfg: AgentConfig; systemPrompt: string; extensions: Array<(pi: ExtensionAPI) => void> }): Promise<PiSession>` where `PiSession` is the SDK's session type. Uses `SessionManager.inMemory()`, a `DefaultResourceLoader` with `extensionFactories: [litellmProvider(cfg), ...extensions]` and **no** discovered extensions/skills from disk, built-in tools disabled, model `litellm/<cfg.model>`.

- [ ] **Step 1:** Write `config.test.ts`: `loadConfig({LLM_API_KEY:"k"})` returns the defaults above; `loadConfig({})` throws `/LLM_API_KEY/`; `AGENT_PORT="9001"` → `port === 9001`.
- [ ] **Step 2:** Run `cd agent && npx vitest run test/config.test.ts` → FAIL (module missing). Implement `loadConfig`. Run → PASS.
- [ ] **Step 3: SDK verification spike (not shipped).** In a scratch script, confirm against the installed `@earendil-works/pi-coding-agent` typings: (a) how to disable all built-in tools while keeping extension tools (`tools: []`, `noTools`, or `excludeTools`); (b) how to pass a custom system prompt (resource loader override, settings, or an option); (c) how to select `litellm/<model>` in `createAgentSession`; (d) the exact event names for tool start/update/end and for an assistant message start/end; (e) how to abort a running prompt. Record every answer, and any mismatch with this plan, in `docs/findings.md`. Later tasks use the names found here. If (b) is unsupported, fall back to prepending the system prompt to the first user prompt and record it.
- [ ] **Step 4:** Write `createPiSession.int.test.ts`, skipped unless `LLM_BASE_URL` is set: creates a session with system prompt `"Reply with exactly: pong"`, `prompt("ping")`, asserts `getLastAssistantText()` contains `pong`; asserts the session's active tool list contains none of `read, bash, edit, write, grep, find, ls`.
- [ ] **Step 5:** Implement `litellmProvider` and `createPiSession`. Run: `LLM_BASE_URL=http://localhost:4000/v1 LLM_API_KEY=sk-local-dev npx vitest run test/pi` → PASS.
- [ ] **Step 6:** `npm run build` → no errors. Commit: `feat(agent): pi session via LiteLLM provider`.

---

### Task 3: pi → AG-UI event translator

**Files:**
- Create: `agent/src/agui/translate.ts`
- Test: `agent/test/agui/translate.test.ts`

**Interfaces:**
- Consumes: pi event names recorded in Task 2 Step 3.
- Produces: `createTranslator(ids: { newId: () => string }): { translate(e: PiEvent): BaseEvent[]; finish(): BaseEvent[] }` — stateful per run. `BaseEvent` and `EventType` from `@ag-ui/core`.

Mapping (pure, no I/O):
| pi | AG-UI |
|---|---|
| first `text_delta` of an assistant message | `TEXT_MESSAGE_START {messageId, role:"assistant"}` then `TEXT_MESSAGE_CONTENT` |
| subsequent `text_delta` | `TEXT_MESSAGE_CONTENT {messageId, delta}` |
| assistant message end / tool start while a text message is open | `TEXT_MESSAGE_END` |
| tool execution start | `TOOL_CALL_START {toolCallId (pi's id), toolCallName}`, `TOOL_CALL_ARGS {delta: JSON.stringify(args)}`, `TOOL_CALL_END` |
| tool execution end | `TOOL_CALL_RESULT {messageId: newId(), toolCallId, content: text of result}` |
| thinking deltas, unknown events | nothing |
`finish()` closes any open text message.

- [ ] **Step 1:** Write tests: `text deltas become one START, N CONTENT, one END`; `text then tool then text yields two distinct messageIds`; `tool start emits START/ARGS/END with pi tool id and JSON args`; `tool end emits TOOL_CALL_RESULT with joined text content`; `finish closes open message`; `unknown events are ignored`. Feed fixtures shaped like the events found in Task 2.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. `npm run build`. Commit: `feat(agent): pi to AG-UI translator`.

---

### Task 4: Agent HTTP server, sessions, system prompt

**Files:**
- Create: `agent/src/server.ts`, `agent/src/agui/runHandler.ts`, `agent/src/session/sessionStore.ts`, `agent/src/prompt/systemPrompt.ts`, `agent/Dockerfile`
- Modify: `docker-compose.yml` (enable `agent`, volume `artifacts-data:/data/artifacts`, `env_file: deploy-config/.env-agent`, port 8000)
- Test: `agent/test/session/sessionStore.test.ts`, `agent/test/agui/runHandler.test.ts`, `agent/test/prompt/systemPrompt.test.ts`

**Interfaces:**
- Consumes: `createPiSession`, `createTranslator`, `loadConfig`.
- Produces:
  - `type UserContext = { timeZone: string; locale: string; localTime: string }` (exported from `systemPrompt.ts`).
  - `buildSystemPrompt(ctx: UserContext | null): string`.
  - `class SessionStore { constructor(opts: { idleMs: number; now?: () => number; create: (threadId: string, ctx: UserContext | null) => Promise<SessionEntry> }); get(threadId): SessionEntry | undefined; getOrCreate(threadId, ctx): Promise<SessionEntry>; sweep(): Promise<void> }` where `SessionEntry = { session: PiSession; busy: boolean; lastUsed: number; dispose: () => Promise<void> }`.
  - `handleRun(input: RunAgentInput, store: SessionStore, signal: AbortSignal): AsyncIterable<BaseEvent>`.
  - HTTP: `POST /agui` (AG-UI `RunAgentInput` JSON in, SSE out via `@ag-ui/encoder`), `GET /health` → `{ok:true}`. 401 if `sharedSecret` set and `x-agent-secret` mismatches.

Run semantics:
- User context comes from `input.context` entry whose `description === "user_context"` (JSON string value → `UserContext`).
- Prompt text = last `role:"user"` message's content.
- Unknown thread + more than one user message in `input.messages` → `RUN_STARTED`, `RUN_ERROR {code:"SESSION_EXPIRED", message:"This chat's session ended (the agent restarted). Start a new chat."}`.
- Thread busy → `RUN_ERROR {code:"THREAD_BUSY"}`.
- `signal` aborted → abort the pi run (Task 2 Step 3 method), mark not busy.
- Model/provider error → `RUN_ERROR {code:"MODEL_ERROR", message}`.

`buildSystemPrompt` must state, in its own words: the no-pay/no-checkout/no-login/no-booking rule with link handoff; never invent results, report blocked/failed tools; infer region, currency, and units from the user context unless the user names a site/region, and ask only when genuinely ambiguous; use `show_widget` for weather/flights/products/plans and `create_artifact` for reports or when asked for a page/PDF; cite source URLs.

- [ ] **Step 1:** `systemPrompt.test.ts`: with `{timeZone:"Asia/Kolkata", locale:"en-IN", localTime:"2026-10-27T14:00"}` output contains `Asia/Kolkata`, `en-IN`, `checkout`, `show_widget`, `create_artifact`; with `null` contains `ask the user`.
- [ ] **Step 2:** `sessionStore.test.ts`: `getOrCreate twice returns same entry`; `sweep disposes entries idle longer than idleMs` (fake `now`); `sweep keeps busy entries`.
- [ ] **Step 3:** `runHandler.test.ts` using a fake `PiSession` that emits scripted events: `streams RUN_STARTED, text events, RUN_FINISHED`; `expired thread yields SESSION_EXPIRED`; `rejects concurrent run on same thread` (THREAD_BUSY); `client abort aborts pi run and frees thread`; `model error yields MODEL_ERROR and frees thread`; `reads user_context from input.context`.
- [ ] **Step 4:** Run all → FAIL. Implement. Run → PASS.
- [ ] **Step 5:** `Dockerfile` based on `mcr.microsoft.com/playwright:v1.<current>-noble` (Chromium needed in Task 7), build context = repo root so `shared/` is available. `docker compose up -d --build agent`, then:

Run: `curl -N localhost:8000/agui -H 'content-type: application/json' -d '{"threadId":"t1","runId":"r1","messages":[{"id":"m1","role":"user","content":"Say hi in 3 words"}],"tools":[],"context":[],"state":{},"forwardedProps":{}}'`
Expected: SSE lines `RUN_STARTED`, `TEXT_MESSAGE_START`, ≥1 `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `RUN_FINISHED`.

- [ ] **Step 6:** `npm run build`; commit: `feat(agent): AG-UI endpoint with per-thread pi sessions`.

---

### Task 5: Widgets and artifacts (agent side)

**Files:**
- Create: `shared/widgets.ts`, `agent/src/tools/index.ts`, `agent/src/tools/showWidget.ts`, `agent/src/tools/createArtifact.ts`, `agent/src/artifacts/store.ts`
- Modify: `agent/src/server.ts` (artifact routes), `agent/src/pi/createPiSession.ts` (register tools)
- Test: `agent/test/tools/showWidget.test.ts`, `agent/test/artifacts/store.test.ts`, `agent/test/server.artifacts.test.ts`

**Interfaces:**
- Produces in `shared/widgets.ts` (TypeBox; export schema + `Static` type for each, and `WidgetPayload` union discriminated on `kind`):
  - `weather_card`: `{ kind, location, units: "metric"|"imperial", current: { temp: number, condition: string }, days: Array<{ date: string, high: number, low: number, condition: string, precipChance?: number }>, source: string }`
  - `flight_list`: `{ kind, from, to, date, currency, flights: Array<{ airline, departTime, arriveTime, durationMin: number, stops: number, price?: number, bookingUrl? }>, searchUrl: string, source: string }`
  - `product_comparison`: `{ kind, query, currency, rows: Array<{ store, title, price?: number, availability: "in_stock"|"out_of_stock"|"unknown"|"blocked", url, note? }> }`
  - `plan_checklist`: `{ kind, title, sections: Array<{ name, items: Array<{ label, quantity?: string, note?, url? }> }> }`
  - `validateWidget(x: unknown): { ok: true; value: WidgetPayload } | { ok: false; errors: string[] }` — errors formatted `"<json-path>: <message>"`.
- `registerTools(pi: ExtensionAPI, deps: ToolDeps): void` with `ToolDeps = { cfg: AgentConfig; artifacts: ArtifactStore; browser: BrowserPool }` (`BrowserPool` arrives in Task 7; until then optional).
- Tool `show_widget(params: { widget: WidgetPayload })` → on success text `"rendered <kind>"`; on failure text `"invalid widget:\n<errors>"` (marked as error result).
- Tool `create_artifact(params: { title: string; html: string })` → text `"artifact <id> created: <title>"`, `details: { artifactId, title }`.
- `ArtifactStore`: `save(title, html): Promise<{ id: string }>` (id = 12-char nanoid; files `<id>.html`, `<id>.json`), `get(id): Promise<{ title, html } | null>`, `renderPdf(id): Promise<Buffer | null>` (Playwright Chromium `page.pdf({format:"A4", printBackground:true})`). Ids not matching `/^[A-Za-z0-9_-]{12}$/` → `null`.
- HTTP: `GET /artifacts/:id` → HTML with header `Content-Security-Policy: sandbox allow-scripts`; `GET /artifacts/:id.pdf` → `application/pdf`, `Content-Disposition: attachment; filename="<slug-of-title>.pdf"`; 404 otherwise.

- [ ] **Step 1:** Tests: `show_widget accepts valid payload for each kind`; `show_widget rejects invalid payload with path-level errors` (e.g. `rows/0/availability`); `store.save then get round-trips`; `store.get rejects path traversal id "../../etc"`; `artifact route sets sandbox CSP`; `pdf route returns application/pdf` (Chromium available in container; skip if not installed locally).
- [ ] **Step 2:** FAIL → implement → PASS. `npm run build`. Commit: `feat(agent): show_widget, create_artifact, artifact store`.

---

### Task 6: Search, fetch, and weather tools

**Files:**
- Create: `agent/src/tools/text.ts`, `agent/src/tools/webSearch.ts`, `agent/src/tools/fetchPage.ts`, `agent/src/tools/weather.ts`
- Modify: `agent/src/tools/index.ts`
- Test: `agent/test/tools/text.test.ts`, `webSearch.test.ts`, `fetchPage.test.ts`, `weather.test.ts` (all with injected `fetch`)

**Interfaces:**
- `truncate(s: string, max = MAX_PAGE_CHARS): string`; `htmlToText(html: string): string` (drop script/style/nav/footer, collapse whitespace; use `@mozilla/readability` + `linkedom`, fall back to tag-strip).
- `web_search({ query: string, count?: number /*default 8, max 15*/ })` → SearXNG `format=json`; text lists `n. title — url\n   snippet`.
- `fetch_page({ url: string })` → 15s timeout; `text/html` → `htmlToText` → `truncate`; `text/plain|application/json` → `truncate`; else `unsupported content-type <type>`; non-2xx → `HTTP <status> from <host>` (403/429/503 additionally `— the site may be blocking automated access`).
- `weather({ location: string, days?: number /*1–7, default 3*/, units?: "metric"|"imperial" })` → Open-Meteo geocoding (`geocoding-api.open-meteo.com/v1/search?name=…&count=1`) then forecast (`api.open-meteo.com/v1/forecast` with `current=temperature_2m,weather_code` and `daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max`, `timezone=auto`). Returns text summary and `details` already shaped as a `weather_card` payload (so the model can pass it straight to `show_widget`). Unknown location → `no location found for "<q>"`.

- [ ] **Step 1:** Tests: `truncate adds marker only when cut`; `fetch_page truncates and rejects binary` (`application/pdf` → unsupported); `fetch_page reports 403 as possible blocking`; `web_search formats results and caps count at 15`; `weather maps WMO code 61 to "Rain"` and `weather unknown location message`; `weather details validate as weather_card` (via `validateWidget`).
- [ ] **Step 2:** FAIL → implement → PASS. `npm run build`. Commit: `feat(agent): web_search, fetch_page, weather tools`.

---

### Task 7: Guest-mode browser, policy, and flights

**Files:**
- Create: `agent/src/tools/browsePolicy.ts`, `agent/src/tools/browse.ts`, `agent/src/tools/flights.ts`
- Modify: `agent/src/tools/index.ts`, `agent/src/session/sessionStore.ts` (dispose browser context with session)
- Test: `agent/test/tools/browsePolicy.test.ts`, `agent/test/tools/browse.int.test.ts` (local static fixture server), `agent/test/tools/flights.test.ts`

**Interfaces:**
- `checkAction(a: BrowseAction, page: { url: string; target?: { type?: string; name?: string; autocomplete?: string; text?: string } }): { allowed: true } | { allowed: false; reason: string }`.
  - Blocked URL pattern (case-insensitive, on target URL for `goto` and current URL for all actions): `/(checkout|cart|basket|payment|pay\b|billing|login|signin|sign-in|signup|sign-up|register|account|auth|wallet)/`.
  - Blocked targets: `type` in `password`; `autocomplete` matching `cc-|current-password|new-password`; element text/name matching `/(place order|buy now|pay|add to cart|proceed to checkout|sign in|log in|book now|confirm booking)/i`.
- `BrowserPool`: one Chromium browser per process (lazy), `contextFor(threadId): Promise<BrowserContext>`, `close(threadId)`. Context uses the user's `locale` and `timezoneId` from `UserContext`.
- `browse({ actions: BrowseAction[] })` where `BrowseAction = {op:"goto",url} | {op:"click",selector?:string,text?:string} | {op:"type",selector:string,value:string,submit?:boolean} | {op:"select",selector:string,value:string} | {op:"wait",ms:number /*≤5000*/} | {op:"read"}`. Max 10 actions per call. Runs sequentially on the thread's page; each action checked with `checkAction` first; on block, stops and returns `stopped: <reason>. Hand this link to the user: <current url>`. Navigation timeout 20s. Returns final URL, title, and `truncate(htmlToText(content))`. Detects likely bot walls (HTTP 403/429, or text matching `/(captcha|are you a robot|access denied|unusual traffic)/i`) → `blocked by <host>: <url>`.
- `flights({ from: string, to: string, date: string /*YYYY-MM-DD*/, returnDate?: string, adults?: number })` → builds a Google Flights search URL (`https://www.google.com/travel/flights?q=Flights%20from%20<from>%20to%20<to>%20on%20<date>…` plus `&hl=<locale>&curr=<currency from locale>`), runs `browse` `goto`+`wait 3000`+`read`, returns the trimmed text prefixed with `searchUrl: <url>`. The model extracts flights into a `flight_list` widget; the `searchUrl` is always included so the user can book themselves.

- [ ] **Step 1:** `browsePolicy.test.ts`: `allows search input typing on amazon.in`; `blocks goto to /checkout`; `blocks click on "Proceed to checkout"`; `blocks typing into password field`; `blocks cc-number autocomplete`; `allows pincode input`.
- [ ] **Step 2:** `browse.int.test.ts` with a fixture server serving `/search` (form) and `/checkout`: `types into search and reads results`; `stops at checkout link with handoff message`; `detects captcha page as blocked`; `caps actions at 10`.
- [ ] **Step 3:** `flights.test.ts` (fake browse): `builds google flights url with date and currency from en-IN → INR`; `result text starts with searchUrl`.
- [ ] **Step 4:** FAIL → implement → PASS. `npm run build`. Commit: `feat(agent): guest-mode browse with checkout guard, flights`.

---

### Task 8: Web app — chat over CopilotKit with user context

**Files:**
- Create: `web/` (Next.js app router, TS), `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/api/copilotkit/route.ts`, `web/components/Chat.tsx`, `web/components/ToolActivity.tsx`, `web/lib/userContext.ts`, `web/Dockerfile`
- Modify: `docker-compose.yml` (enable `web`, build context = repo root so `shared/` is importable, port 3000, `env_file: deploy-config/.env-nextjs` with `AGENT_URL=http://agent:8000`, optional `AGENT_SHARED_SECRET`)
- Test: `web/test/userContext.test.ts`, `web/test/ToolActivity.test.tsx`, `web/test/Chat.test.tsx`

**Interfaces:**
- Consumes: agent `POST /agui`, AG-UI error codes `SESSION_EXPIRED`, `THREAD_BUSY`, `MODEL_ERROR`.
- Produces:
  - `getUserContext(now?: Date): UserContext` (same shape as agent; `Intl.DateTimeFormat().resolvedOptions().timeZone`, `navigator.language`, local ISO time without Z).
  - `route.ts`: `CopilotRuntime` with `agents: { openagent: new HttpAgent({ url: \`${AGENT_URL}/agui\`, headers }) }`, exported via the current CopilotKit Next.js endpoint helper (GET/POST). Use whatever the installed CopilotKit version documents; record deviations in findings.
  - `Chat`: `<CopilotKit runtimeUrl="/api/copilotkit" agent="openagent">` + `CopilotChat`. User context sent each run as context item `description: "user_context"`, `value: JSON.stringify(getUserContext())` (via `useCopilotReadable` or the version's equivalent).
  - `ToolActivity({ name, status, args })`: default renderer for non-widget tools; labels: `web_search` → `Searching "<query>"`, `fetch_page`/`browse` → `Opening <host>`, `weather` → `Checking weather for <location>`, `flights` → `Searching flights <from> → <to>`; spinner while `status !== "complete"`.
- Mobile-first layout: full-height chat, input pinned bottom, max content width 760px on desktop. "New chat" button resets the thread.
- Error handling: `SESSION_EXPIRED` → banner with "Start new chat" button; `MODEL_ERROR` → inline error with "Retry"; `THREAD_BUSY` → "Still working on the last message".
- Every element has a unique `id`.

- [ ] **Step 1:** Tests: `getUserContext returns tz, locale, local time without Z`; `ToolActivity labels web_search with query`; `shows expired banner` (render Chat's error banner component with `SESSION_EXPIRED`).
- [ ] **Step 2:** FAIL → implement → PASS. `npm run build` → no errors.
- [ ] **Step 3:** `docker compose up -d --build`. Open `http://localhost:3000`, ask "what time zone am I in?". Expected: streamed answer naming your browser's zone; a `web_search` question shows a "Searching…" activity row.
- [ ] **Step 4:** Commit: `feat(web): CopilotKit chat with AG-UI agent and user context`.

---

### Task 9: Web widgets and artifact viewer

**Files:**
- Create: `web/components/widgets/WidgetRenderer.tsx`, `WeatherCard.tsx`, `FlightList.tsx`, `ProductComparison.tsx`, `PlanChecklist.tsx`, `web/components/artifacts/ArtifactCard.tsx`, `ArtifactViewer.tsx`, `web/app/api/artifacts/[id]/route.ts`
- Modify: `web/components/Chat.tsx` (register renderers)
- Test: `web/test/widgets/*.test.tsx`, `web/test/artifactsRoute.test.ts`

**Interfaces:**
- Consumes: `shared/widgets.ts` (`WidgetPayload`, `validateWidget`), tool names `show_widget`, `create_artifact`.
- Produces:
  - Tool renderer for `show_widget`: `WidgetRenderer({ toolCallId, args })` validates `args.widget`; on invalid renders nothing (the agent already got the error). Dispatches on `kind`.
  - Tool renderer for `create_artifact`: `ArtifactCard({ toolCallId, args, result })` shows title, "Open" (opens `ArtifactViewer` full-screen modal with `<iframe sandbox="allow-scripts" src="/api/artifacts/<id>">`), and "Download PDF" (`/api/artifacts/<id>?format=pdf`). Artifact id parsed from the tool result text `artifact <id> created`.
  - `GET /api/artifacts/[id]?format=pdf|html` → proxies to agent; always sets `Content-Security-Policy: sandbox allow-scripts` for HTML.
  - `ProductComparison` shows `blocked` rows as "Site blocked automated access — open link"; every row links out. `FlightList` always shows a "Search & book yourself" link to `searchUrl`. Prices formatted with `Intl.NumberFormat(locale, {style:"currency", currency})`.
- [ ] **Step 1:** Tests: `WeatherCard renders location and N days`; `ProductComparison renders blocked row with link`; `FlightList always renders searchUrl link`; `WidgetRenderer renders nothing for invalid payload`; `all rendered elements have unique ids` (query `[id]`, assert set size equals count, across one of each widget rendered together); `artifacts route forces sandbox CSP`.
- [ ] **Step 2:** FAIL → implement → PASS. `npm run build`. `docker compose up -d --build`.
- [ ] **Step 3:** Commit: `feat(web): widgets and sandboxed artifact viewer`.

---

### Task 10: End-to-end scenarios and findings

**Files:**
- Modify: `docs/findings.md`, `README.md`

- [ ] **Step 1:** `docker compose up -d --build`, Ollama running on host with the chosen model. In the browser run the spec's five success scenarios:
  1. "weather in Pune this weekend" → weather widget.
  2. "is the Sony WH-1000XM5 in stock near me?" → product comparison for the inferred region; blocked sites shown honestly.
  3. "flights SFO→BLR on Dec 15" → flight list + search link, or an explicit "couldn't get live data".
  4. "plan a Diwali party for 25" → plan checklist; then "make it a printable page" → artifact opens, PDF downloads.
  5. An open research question → streamed answer with source URLs; "write it up as a report" → artifact.
- [ ] **Step 2:** For each, record in `docs/findings.md`: pass/partial/fail on `chat-default`, what went wrong, turn count. For any failure that looks like model capability, and only if a hosted key has been provided in `deploy-config/.env-llm`, add a `chat-strong` alias in `litellm/config.yaml`, rerun with `AGENT_MODEL=chat-strong`, and record the result.
- [ ] **Step 3:** README: prerequisites (Docker, Ollama + `ollama pull <tag>`), copying `.env*.example`, `docker compose up -d --build`, how to add a model alias.
- [ ] **Step 4:** Commit: `docs: e2e findings for v1 scenarios`.
