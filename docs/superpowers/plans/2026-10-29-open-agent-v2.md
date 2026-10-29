# Open Agent v2: execution plan

Spec: `docs/superpowers/specs/2026-10-29-open-agent-v2-design.md`. The milestone task lists below are the owner's build plan, kept verbatim so every implementer works from the same text.

## Waves

| Wave | Runs in parallel | Gate before the next wave |
| --- | --- | --- |
| 1 | M0 eval harness · M1 judge + shop re-rank · M2 skills + prompt split | Baseline recorded on the pre-v2 build (Sonnet ×2, Qwen ×2); M1, M2 merged, verified, flags on |
| 2 | M3 stays/FX/budget/music · M6 workspace + plan tool | M3, M6 merged and verified |
| 3 | M4 source registry + JSON-LD | merged and verified |
| 4 | M5 codemode · M7 router · M8 RPIV | merged and verified; final eval on Sonnet and Qwen |

Why this order: the baseline must be recorded against today's build, so M0 lands first and the baseline runs while M1/M2 are built. M3 needs the judge (M1). M6 is independent of M3 and runs beside it. M4 rewrites the stays and shop sources that M3 and M6 touch, so it runs alone. M5 needs M4's clean sources; M7 needs M6's workspace summary; M8 needs M3's hit selection.

Every implementer: works in its own worktree branch, runs `npm run lint && npm run typecheck && npm test && npm run build` in `agent/` (and `web/` when touched), commits there, and does not touch Docker or the live agent on :8000. The orchestrator merges, rebuilds Docker, runs live evals and checks the browser.

## Build plan (owner's milestones)

 M0 · Eval harness
 Goal: a repeatable score per model, so every later milestone is judged against numbers rather than impressions.
 # Task Where 
 0.1 Scenario file format (YAML): prompt(s), user context, model, assertions. Write the 12 scenarios from the Overview tab, including multi-turn ones. agent/evals/scenarios/*.yaml 
 0.2 Runner that posts to /agui (same approach as the review script) and records tool trajectory, arguments, widget kinds, final text, duration and token usage per run. agent/evals/run.ts 
 0.3 Assertions: must call / must not call, max tool calls, widget kind present, grounding (count of unverified claims), banned phrases (invented provider claims), duration ceiling. agent/evals/assert.ts 
 0.4 Offline ranking fixtures: the ESCI grocery slice from when-to-use-jev (Apache-2.0) turned into tile lists with labels, for testing rankTiles without a browser. agent/evals/fixtures/esci-grocery.jsonl 
 0.5 Report: markdown table per model (pass/fail, calls, seconds, $) plus a diff against the committed baseline. agent/evals/report.ts 
 0.6 npm run eval and npm run eval:rank scripts. Live evals are run by hand (they cost money); the ranking eval runs in CI. agent/package.json , CI 
 0.7 Record the baseline for Sonnet 5.5 and Qwen, 2 runs each, to measure run-to-run variance. agent/evals/baseline/ 
 Verify M0
 npm run eval -- --model chat-sonnet-5.5 scores all 12 scenarios and writes a report.
 Two back-to-back runs differ by at most 1 scenario, which tells us how much noise to expect.
 npm run eval:rank prints Exact@1 and NDCG@3 for today's rankTiles on the ESCI grocery slice, and runs in CI.
 Baselines for Sonnet and Qwen are committed.
 M1 · Jev wiring + shop re-rank
 Goal: the right products in the cart, labeled substitutes, and a correct best-value store. This milestone also proves the Jev wiring.
 # Task Where 
 1.1 TYPESAFE_API_KEY in deploy-config/.env-agent (already gitignored). Confirm that hub.runtime resolves the typesafe classifier, and pin a version rather than -latest . providers/hub.ts , config.ts 
 1.2 judge module wrapping modelRegistry.classify : score / choose / yesno , a timeout, a fallback callback, at most 4 requests at once, a decision log (criteria version and probabilities), and usage added to cost logging. agent/src/judge/index.ts 
 1.3 Frozen criteria as versioned code: the product-match levels exact / substitute / complement / irrelevant, each with means/not text. agent/src/judge/criteria/productMatch.ts 
 1.4 Re-rank: the keyword filter cuts each list to about the top 20, then one batched Jev score call per item and store, ranked by level, then sponsored, then price. Kept behind the JEV_RERANK flag, with keyword ranking as the fallback. shop/rank.ts , tools/shop.ts 
 1.5 Each pick carries match: exact|substitute . bestValue counts only exact matches as found, and substitutes are listed separately. shop/rank.ts , shared/widgets.ts 
 1.6 Cart card shows a "Substitute" badge and a "why" tooltip (e.g. "exact, 94%"). Every new element gets a unique id. web/components/widgets/Cart* 
 1.7 Tune the criteria on a practice slice only, then freeze them. The test slice is never used for tuning. evals/fixtures 
 Verify M1
 eval:rank : Jev Exact@1 is at least 10 points above the M0 keyword baseline (target ≥ 80%, in line with the 83.6% from when-to-use-jev ).
 Live evals party and recipe-cart pass, with no scenario regressions against the baseline.
 Outage test: with a bad TYPESAFE_API_KEY , shop still returns keyword-ranked results and the log shows the fallback.
 Re-ranking adds less than 1 s at p95 per shop call (from the logs).
 Unit tests for the judge fallback and the substitute logic; the web build passes; Docker images rebuilt; committed.
 M2 · Skills + prompt split
 Goal: a new use case becomes a markdown file. The core prompt shrinks to under 2k characters with no drop in quality.
 # Task Where 
 2.1 Write skills: trip-planning , party-planning , research , grocery-run , music , gift-ideas , dining-out . Each has frontmatter (name, description) and a playbook. agent/skills/*/SKILL.md 
 2.2 Load the skills with additionalSkillPaths in DefaultResourceLoader , and remove noSkills . pi/createPiSession.ts 
 2.3 load_skill(name) tool, limited to the skills directory (no general file reads). Write the skill index (name and description) into the system prompt ourselves. tools/loadSkill.ts , prompt/systemPrompt.ts 
 2.4 Move tool-specific rules into tool descriptions (shop cart semantics, "shows its own card", flight preference fields, stays usage). tools/*.ts 
 2.5 Move data-style rules into config or code: the grocery default store per region, and nearby airports computed from the home location instead of the hard-coded Bay Area list. shop/stores.ts , tools/geo.ts 
 2.6 Core prompt: identity, hard rules, grounding, voice, and the user-context section. Add a test that it stays under 2,000 characters. prompt/systemPrompt.ts 
 Verify M2
 A test asserts the core prompt is under 2,000 characters.
 Eval trajectories show load_skill called in trip , party and research , and not in car .
 Sonnet's pass rate is at least the baseline. Input tokens per first turn drop by at least 30% (from the usage logs).
 Adding a dummy skill takes no code change: it appears in the index and loads.
 M3 · Stays wishes, currency, turn budget, quick Jev wins
 Goal: fix the failures from the live tests (wrong brand, € shown as $, per-tool cap), and fix the music and image matching bugs.
 # Task Where 
 3.1 stays gets a wants parameter (brand, area, vibe). Jev scores each listing against it using a frozen template, and the card shows which wishes each listing meets. tools/stays.ts , judge/criteria/stayMatch.ts 
 3.2 Currency: max_price takes a currency. Add an FX helper using a free ECB-rates API with a daily cache, and compare prices in a single currency. lib/fx.ts , tools/stays.ts 
 3.3 Turn-level budget: total calls and wall time per turn, with soft per-group guidance. Each result says "n of N used". tools/budget.ts 
 3.4 Music: replace the word-overlap bestMatch with a Jev choice among the iTunes results, with a "none" option. tools/lookup.ts , tools/musicArt.ts 
 3.5 Search-hit selection helper: Jev yes/no per hit, "likely answers the question?". Used by research (M8) and available to the agent now. judge/criteria/hitUseful.ts 
 Verify M3
 hotel-brand passes: the top picks are Marriott or Hyatt, or the answer says plainly that none are under budget. The € budget is honored.
 No "budget used up" error while under the turn total, and evals show no runaway loops (max calls ≤ cap).
 playlist passes. A music-matching unit set (20 titles, including tributes and karaoke versions) scores at least 95%.
 No regressions against M2.
 M4 · Source registry + JSON-LD reader
 Goal: provider-neutral verticals. A new provider is one file; "any store" works; the prompt names no providers.
 # Task Where 
 4.1 A Source<Q,R> type: vertical, regions, capabilities, defaultFor, search() , plus a registry with selection by vertical, region and capability. agent/src/sources/ 
 4.2 Port the stays sources (already close to this shape) and the shop stores, adding regions. Fix the domain mapping (amazon.in and amazon.co.uk) and add amazon.in and Flipkart. sources/stays/* , sources/retail/* 
 4.3 Flights behind a FlightSource , with Google Flights as the first one, so a second source can plug in later. sources/flights/google.ts 
 4.4 JSON-LD reader for Product/Offer , Hotel , Restaurant and Event . It becomes the default source for unknown store domains (search the site, read product pages, take the offers) and a structured fallback in fetch_page . sources/jsonld.ts 
 4.5 Tool descriptions list their sources from the registry. Remove every store and provider name from the prompt and skills. tools/*.ts , skills/* 
 Verify M4
 store-domain passes with at most 3 tool calls. grocery-offlist passes with at most 5.
 india-shop uses amazon.in or Flipkart and INR. A unit test covers amazon.in resolving to amazon.in.
 grep of the prompt and skills finds no store or provider names.
 Adding a mock store is one file, and the test sees it selected for its region.
 M5 · Codemode + judging (long tail)
 Goal: the agent can do math and run judgments over many items in one script. This uses pi's own sandbox rather than a custom one.
 # Task Where 
 5.1 Add createCodemodeExtension() to the resource loader, and turn it on with defaultTools: ["+codemode"] only for models marked capable (a model capability flag in AGENT_MODELS ). pi/createPiSession.ts , config.ts 
 5.2 Decide which tools scripts can call (a list of allowed tools). Confirm that the budget and the browse policy still apply to calls made from a script. tools/index.ts 
 5.3 A judging skill: the means/not criteria pattern, thresholds and fallbacks, and returning a short summary rather than raw data. skills/judging/SKILL.md 
 5.4 Sandbox guard tests: no network, a timeout, an output cap, and Jev usage counted in the cost. test/pi/codemode.int.test.ts 
 5.5 A/B eval on the long-tail set (dining, events, gifts): ranking inside the LLM's context vs ranking in a codemode script with Jev. evals/ 
 Verify M5
 dining passes, and the A/B shows codemode is at least as accurate with fewer LLM round trips. If it isn't, keep codemode only for math.
 The party budget total and € → $ conversion come out exactly right, computed in a script.
 Qwen sessions don't get codemode (checked in the trajectory). A sandbox network attempt fails the test as expected.
 M6 · Workspace + plan tool
 Goal: plans become typed, persisted state. Follow-ups change that state directly instead of rebuilding the plan, and chats survive restarts.
 # Task Where 
 6.1 SQLite store under /data/agent ( node:sqlite ): workspace(thread_id, kind, id, json, version). agent/src/workspace/store.ts 
 6.2 Typed entities in shared/ : cart (moved over from ActiveCart ), trip, event, shortlist. shared/workspace.ts 
 6.3 plan tool with get / set / patch . A small workspace summary is included each turn. tools/plan.ts 
 6.4 Generalize cart_edits into workspace_edits from the UI, so guests, dates and quantities can be edited inline. agui/runHandler.ts , web widgets 
 6.5 Session restore: instead of SESSION_EXPIRED , rebuild the pi session from the AG-UI messages plus the workspace. session/sessionStore.ts , server.ts 
 Verify M6
 party-followup passes: the guest count goes from 12 to 16, only quantities change, and no new search runs for unchanged items.
 docker compose restart agent in the middle of a chat, and the next message continues with the cart intact.
 Existing cart tests pass after the move. Editing guests in the UI shows up in the next turn.
 M7 · Pre-turn Jev router
 Goal: small models get a narrowed set of skills and tools; plan-vs-book intent is handled in code. Runs in the agent before the prompt, which is the "proxy" from the diagram.
 # Task Where 
 7.1 Yes/no question per area (lodging, flights, shopping, dining, research, music, weather) plus "missing details?". Input: the message, the last 2 turns, and the workspace summary. Runs in parallel while the session is fetched. agui/router.ts 
 7.2 Hints: load the matched skills ahead of the turn. For small models only, limit the active tools to the matched set plus the core tools. agui/runHandler.ts 
 7.3 Low confidence or no match means no hints, which is today's behavior. agui/router.ts 
 7.4 Policy intent: buy, book or log in is answered with a hand-off note from code, which keeps the read-only promise. agui/router.ts 
 7.5 Optional: a model route (simple turns to Qwen, complex to Sonnet) following pi's jev-router.ts virtual-model pattern. providers/ 
 7.6 Labeled routing set: 100 prompts, including multi-intent ones and follow-ups. evals/fixtures/routing.jsonl 
 Verify M7
 Qwen passes at least 3 more scenarios with hints than without.
 On the routing set, every expected area is flagged in at least 95% of prompts. Missing an area matters more than flagging an extra one.
 The router adds no latency at p95, because it runs in parallel. A Jev outage leads to the "no hints" path.
 M8 · RPIV research workflow
 Goal: research reports whose claims are checked against their sources, with fewer wasted reads.
 # Task Where 
 8.1 Workflow in code, triggered by the research skill or the router: Research (search, then pick hits with Jev, then read), Plan (the decision plus an outline), Implement ( create_artifact ), Verify. agent/src/workflows/research.ts 
 8.2 Verify step: pull each claim out of the report and run a Jev yes/no check against the text of its cited source. Unsupported claims are flagged inline or removed. judge/criteria/claimSupported.ts 
 8.3 Progress events for each phase, shown in the chat's step list. agui/translate.ts , web 
 Verify M8
 On the research scenarios, unverified claims per report drop by at least 50% against the baseline.
 Pages read per report go down, and total time is no more than 20% over baseline.
 A planted false claim in a test fixture is caught by the verify step.
 Definition of done (every milestone)
 Code
 npm run lint , typecheck and test pass in agent/ and web/ .
 npm run build passes for both.
 New HTML elements have unique ids.
 No unnecessary comments; code matches the style around it.
 Proof
 The milestone's verify checklist is fully ticked.
 npm run eval on Sonnet shows no regressions against the last milestone.
 The eval report is committed under agent/evals/results/ .
 Ship
 Docker containers rebuilt and restarted.
 Self-review of the diff, then a commit with a meaningful message.
 No keys, .env files or certificates committed; secrets stay in deploy-config/.env-* .
 Each feature behind a flag until its milestone check passes.
 Kill criteria: if a Jev-backed milestone doesn't beat its baseline on the eval, leave it behind the flag and record why in docs/findings.md . Shipping it anyway would undermine the point of having evals.
 The scenario set (built in M0, re-run at the end of every milestone)
 ID Prompt (short) Pass criteria (abridged) Proves 
 party 8th birthday, 12 kids, $300 ask_user or plan; shop cart; budget adds up M1 M2 M5 M6 
 party-followup …then "make it 16 kids" guest count updated; only quantities change M6 
 hotel-brand Marriott/Hyatt near Louvre < €400 top picks are those brands, or an explicit "none under budget"; € honored M3 
 store-domain XM5 at B&H + Newegg a price or a clear block per store, ≤ 3 tool calls M4 
 research Heat pump vs furnace report created; unverified claims under a threshold M2 M8 
 car Maui SUV + snorkel answer with links; no invented prices regression guard 
 grocery-offlist Eggs/milk/bananas at TJ's + Whole Foods ≤ 5 tool calls; honest result M4 
 dining Palo Alto, 8 people, veg, reservable ranked cards that meet the constraints M5 
 trip Tahoe 3 days stays + weather + plan card; trip skill loaded M2 M6 
 recipe-cart Groceries for tacos for 6 no pantry basics; correct products M1 
 playlist 80s road-trip playlist square cards with correct cover art M3 
 india-shop Best phone under ₹30k (IN locale) amazon.in/Flipkart, INR M4 
 M0 · Eval harness
