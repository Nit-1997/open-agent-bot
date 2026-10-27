# Findings

What we assumed about the stack, what turned out to be true, and how we worked around it.

| Area | Assumed | Actual | Workaround |
|------|---------|--------|------------|
| Ollama / model | Qwen ~9B available locally | `qwen3.5:9b` requires a newer Ollama than the installed 0.20.2 | `chat-default` → `ollama_chat/gemma4:latest`. Upgrade Ollama, `ollama pull qwen3.5:9b`, change `OLLAMA_CHAT_MODEL` in `deploy-config/.env-llm` |
| LiteLLM tool calling | `ollama_chat/` passes OpenAI tools through | Works: gemma4 returned a `weather` tool call (~8s cold) | — |
| pi: disable built-ins | `tools: []` / extensions | `createAgentSession({ noTools: "builtin" })`; active tools = only `customTools` | — |
| pi: custom tools | `pi.registerTool` via extension factory | `createAgentSession({ customTools: [defineTool({...})] })` works directly; no extension needed. `typebox` (not `@sinclair/typebox`) for schemas | Use `customTools` |
| pi: provider | extension `registerProvider` | `ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })` + `runtime.registerProvider("litellm", {...})` + `runtime.getModel(...)`, passed as `modelRuntime` + `model` | No extension needed |
| pi: system prompt | unknown | `new DefaultResourceLoader({ systemPrompt, noExtensions, noSkills, noContextFiles, ... })` then `reload()`. pi appends a `<cwd>` block after it | Use a throwaway temp `cwd`/`agentDir` per session so the user's `~/.pi` is never read |
| pi: events | names unknown | `message_update` (`assistantMessageEvent.type`: `text_start/text_delta/text_end/thinking_*/toolcall_*`), `message_start/end` (`message.role`), `tool_execution_start/update/end` (`toolCallId`, `toolName`, `args`, `result`, `isError`), `turn_*`, `agent_end`, `agent_settled` | — |
| pi: abort / busy | unknown | `session.abort()`, `session.isStreaming`; `prompt()` while streaming requires `streamingBehavior` | Runhandler rejects concurrent runs (THREAD_BUSY) |
| gemma4 via LiteLLM | `thinkingLevel: "off"` suppresses reasoning | gemma4 still streams `thinking_delta` events | Translator ignores thinking events |
| pi tool results → model | model sees `details` | Only `content` text reaches the model; `details` is UI/log-only. gemma4 tried to rebuild a weather_card from memory, failed pi's schema validation 3×, and repeated its answer each time | Tools that already produce a valid widget put it in `details.widget`; the translator emits a synthetic `show_widget` call for the UI. Model never copies widget JSON for weather |
| pi tool arg validation | our `validateWidget` reports errors | pi validates params against the TypeBox schema *before* `execute` and returns its own path-level error text to the model | Fine — errors are clear; our validator is a second line |
| CopilotKit version | v1 API (`useCopilotReadable`, `CopilotRuntime` from root) | 1.81 is the v2 API: `@copilotkit/react-core/v2` (`CopilotKit`, `CopilotChat`, `useAgentContext`, `useRenderTool`, `useDefaultRenderTool`), runtime `CopilotRuntime` + `createCopilotEndpoint` from `@copilotkit/runtime/v2` served via `hono/vercel` at `app/api/copilotkit/[[...slug]]` | — |
| CopilotKit + `@ag-ui/client` | any version | CopilotKit 1.81 pins `@ag-ui/client@1.0.2`; installing 1.0.3 breaks `HttpAgent` typing (private `_debug`) | Pin `@ag-ui/client@1.0.2` exactly |
| CopilotKit + Next 16 | SSR-safe provider | Provider calls `randomUUID()` during render; Next 16 cacheComponents prerender fails | Mount `<CopilotKit>` client-only (`useSyncExternalStore` gate) |
| Unique element ids | every element ours | CopilotKit's own chat DOM has no per-element ids; we can't set them | Our components carry unique ids; CopilotKit internals are exempt |
| gemma4 + nested widget arg | model can fill `show_widget({ widget: {...} })` | gemma sent `{"widget": "product_comparison"}` (a string) for products and flights; for the plan it skipped the tool and *claimed* "the widget above" | Replaced `show_widget` with flat tools `show_products`, `show_flights`, `show_plan` (fields at top level, `kind` added server-side); prompt forbids mentioning a card unless a show tool succeeded |
| gemma4 + flight fields | model converts units | Turned "28 hr 25 min" into `durationMin: 10125` and invented `bookingUrl: .../xxxxxxxx` | `duration` is copied text; `bookingUrl` removed — the real `searchUrl` is always shown |

## v1 scenario results (2026-10-27, `chat-default` = gemma4 via Ollama, all local)

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 1 | Weather in Pune this weekend | Pass | Weather card + summary, one tool call (~20s). Model used default 3 days rather than computing "weekend" |
| 2 | Sony WH-1000XM5 in stock near me (en-IN) | Partial | Inferred India/INR/amazon.in. Product card rendered, but built from search snippets, not loaded pages, and `show_products` was called twice (duplicate card) |
| 3 | Flights SFO→BLR on 2026-12-15 | Pass | Real options read from Google Flights ($1,419 Alaska/JAL), flight card + "Search & book yourself" link (~27s). Once ended with no text summary |
| 4 | Diwali party for 25 → printable page | Pass | Plan checklist card with quantities (~17s); separate request produced an HTML artifact that opens full screen and downloads as PDF |
| 5 | Heat pumps vs furnaces research | Pass | Streamed answer with source links from one search |

No hosted key was provided, so no scenario was rerun on a stronger model. Biggest local-model gaps: it rarely chooses `browse` over search snippets for stock checks, and occasionally repeats a show_* call.

## Round 2 (owner testing, 2026-10-27)

| Area | Problem seen | Root cause | Fix |
|------|--------------|------------|-----|
| Currency | US user got rupees for SFO→Nashville | Browser language is `en-IN` while time zone is `America/Los_Angeles`; currency was derived from the language region | `regionFor()` derives country/currency from the time zone first, language second; system prompt states Country/Currency explicitly |
| Flight card | Plain text answer, no card | Card depended on the model making a second `show_flights` call after `flights`; gemma often skipped it | Split data tools from rendering: data tools return typed `details.data`; `render/registry.ts` turns data into widgets deterministically. Model-called render tools remain only for synthesized content (`show_products`, `show_plan`) |
| Flight parsing | `en-IN` pages parsed 0 options | Google writes "6 hrs 17 min" in en-IN vs "6 hr" in en-US | Parser accepts hr/hrs, min/mins, am/pm in any case; fixtures for both variants |
| Duplicate cards | gemma called `flights` twice (Nashville, then BNA) | Model behavior | Registry renders at most one card per data kind per reply |
| Leaked tool notes | Model echoed "the flight card is shown automatically" | Tool result phrased as a statement | Phrased as "(Note for you, do not repeat to the user: …)" |

## Model comparison (2026-10-27): same 5-turn Diwali conversation, replayed via the agent

| | gemma4 (9.6 GB) | qwen2.5:32b (19 GB) | qwen3.5:35b MoE (22 GB, 31 GB resident) |
|---|---|---|---|
| Tool calls over 5 turns | 7 | 0 | 42 |
| Cards / artifacts | 1 plan card | none | plan card, weather card, printable PDF guide |
| "Build a cart" turn | generic aisle list | invented Target links (no tool call) | real Target/Amazon products + prices, every link traced to a tool result |
| Research-turn latency (thinking on) | 25–45s | 30–80s | 130–225s |
| Malformed tool args ("non-whitespace after JSON") | 3 | – | 7 |

Decision: default `chat-default` → `ollama_chat/qwen3.5:35b` with `think: false` (simple call 2.0s → 0.6–0.8s). Ollama upgraded 0.20.2 → 0.40.11 and runs as a brew service with `OLLAMA_MAX_LOADED_MODELS=1`.
Open issue: the identical malformed-JSON error across two different models points at the pipeline (likely parallel tool calls merged into one argument string), not the model.

## Round 3: tool-call merge bug, search budget, grounding (2026-10-27)

| Area | Finding |
|------|---------|
| Merged tool calls | Root cause: LiteLLM 1.106.5 `ollama_chat/` streams parallel tool calls all at `index: 0`; pi merges by index → concatenated JSON args. Ollama's `/v1` endpoint indexes correctly. Fix: LiteLLM `openai/` provider → `http://host.docker.internal:11434/v1`. Live regression test `test/pi/parallelTools.int.test.ts` |
| Latency | With merged-call fix + per-reply budget (4 searches, 4 reads, 2 flight searches), qwen3.5:35b thinking-off research turns went from 130–225s to 20–26s, 0 tool errors |
| City | Prompt now says time zone gives the country, not the city; model asks for location/headcount before planning |
| **Grounding (open)** | qwen3.5:35b invents prices and "in stock" claims in free text when only search snippets were read: thinking off → 3 invented prices + stock claims; thinking on → 12 invented prices, 305s turn. Product IDs were real. Prompt rules are not enough; needs a structural fix |
