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

## v2: skills, Jev, sources, workspace, router, RPIV (2026-10-29)

Plan: `docs/superpowers/plans/2026-10-29-open-agent-v2.md`. Spec: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`. Eval reports: `agent/evals/results/`.

Baselines (pre-v2 build): Sonnet 5.5 passed 18 of 24 runs, and its two runs agreed on every scenario. Qwen 3.5 passed 4 of 24 runs, and its two runs differed on 2 of 12 scenarios. Qwen's recipe-cart run looped through 71 tool calls.

| Milestone | Flag | Shipped on? | Result |
|---|---|---|---|
| M0 eval harness | — | yes | 14 YAML scenarios, SSE runner, 12 assertion types plus negation, `run_stats` event, `--rescore`, baselines for Sonnet and Qwen |
| M1 Jev shop re-rank | `JEV_RERANK` | yes | ESCI grocery test split, Exact@1: keyword 62.5% → Jev 86.1% (NDCG@3 0.624 → 0.842); one batched call per store-item list. Party and recipe-cart pass live. With a missing model, shop falls back to keyword ranking and logs it. Re-rank time: 0.3–0.4 s for typical carts, 0.8–1.8 s for marketplace party carts with ~90 lists (`JEV_CONCURRENCY=64`), so <1 s at p95 holds for typical carts but not for the largest ones |
| M2 skills + prompt split | `PROMPT_V2` | yes | Core prompt under 2,000 chars (tested). First request on Sonnet: 10,730 → 7,510 input tokens (-30.0%). load_skill called in trip, party and research, not car. Sonnet 19 of 24 vs 18 of 24 baseline |
| M3 stays wishes, FX, budget, music | `JEV_STAYS` `JEV_MUSIC` `TURN_BUDGET` | yes | hotel-brand 0/2 → 2/2: the € budget is no longer searched as $, the search names the wished-for chains, and listings show ✓ brand / ✓ area. Music set: Jev 20/20, word overlap 18/20. Cover art: word overlap gave a-ha's "Take On Me" an orchestral cover single's art; Jev plus an artist-first search got 6 of 6 live cards right |
| M4 sources + JSON-LD | `SOURCES_V2` | yes | store-domain (B&H + Newegg): 8 calls → 2, each store a price or an explicit "blocked" with a product link. india-shop shows live Flipkart ₹ prices. amazon.in and amazon.co.uk resolve to themselves. A mock store is one file. No store or provider names in the core prompt or skills (tested) |
| M5 codemode | `CODEMODE` | **no** | Sandbox guards proven (no network, timeout, output cap, allow-list, budgets and net guard apply to script calls, Jev cost counted). Sonnet chose in-context ranking for dining/events/gifts and in-context budget math for party even with codemode offered, so the A/B can't show a gain. Kept off per the kill rule; turn on for experiments |
| M6 workspace + plan | `WORKSPACE` | yes | party-followup 0/2 → pass: `plan patch /guests 16`, then shop with quantity changes only and no new catalog search. Browser: editing guests inline reaches the next turn; after `docker compose restart agent` the chat continues with 16 guests and the cart intact |
| M7 router | `ROUTER` | **no** | Routing set (109 prompts): every expected area flagged in 97–98%, p95 0.3 s. Gate failed: Qwen 5 of 14 without hints, 3 of 14 with them. Qwen doesn't use preloaded skills reliably; with hints it once claimed a grocery cart without calling shop. Kept off per the kill rule |
| M8 RPIV research | `RPIV` | yes | Same claim checker on both: baseline reports had 7 and 9 unsupported claims, all unmarked; RPIV shows 2–5 per report, marked, after removing unsupported sentences where the paragraph or list survives. Pages read 6 → 4. Time 56 s vs the 52.9 s baseline (+6%), but about 2× the non-RPIV path on the same provider |

Fixes found while verifying (each with tests):

| Problem | Fix |
|---|---|
| A 5-minute shop call left the SSE stream silent past undici's 300 s body timeout (eval runner and the Next.js proxy both use undici), so the turn died | `/agui` sends `: ping` every 15 s; checked that `@ag-ui/client` ignores it |
| Prompt and skill text didn't stop models sending a named grocery store's site (Target, Walmart) into its bot wall | shop retries a blocked named store through the regional grocery marketplace, keeping only that store ("Target (Shipt)"), and never swaps in a different store |
| `suggest_replies` wasn't budgeted; Qwen called it 37 times in one turn | Hard once-per-reply limit; the refusal says the reply is complete |
| Restored chats flagged the budget and cart total as unverified | Restored history and the workspace summary count as evidence |
| The research plan reply ran past 2,000 tokens and lost the takeaway | 4,000 tokens, and a cut-off reply still yields title, decision and takeaway |
| LiteLLM models reported $0 cost | Per-token prices are read from LiteLLM `/model/info` |

Environment notes:

- There's no TypeSafe key; Jev runs through the OpenRouter key (`typesafe/jev-1.14`, pinned, about $0.0003 per batched call).
- The Anthropic API key ran out of credit mid-way (`credit balance is too low`), so `chat-sonnet-5.5` through LiteLLM fails until it's topped up. Later Sonnet checks used the same model through OpenRouter. That route reports token counts differently (input looks like ~10 tokens, cost is right), so token comparisons above use the Anthropic-direct runs. It once returned an empty reply after a tool call, apparently because OpenRouter enables reasoning for this model by default.
