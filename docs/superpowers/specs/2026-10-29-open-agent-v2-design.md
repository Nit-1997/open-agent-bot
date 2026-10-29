# Open Agent v2: skills, Jev, sources, workspace, router, RPIV

Source documents: `open-bot-architecture.html` (target state) and `open-bot-build-plan.html` (milestones M0–M8). This spec fixes the shared contracts so milestones can be built in parallel, and records where reality differs from the plan.

## Decisions that differ from the build plan

| Plan said | Reality | Decision |
| --- | --- | --- |
| `TYPESAFE_API_KEY` + `typesafe/jev-latest`, pin a version | No TypeSafe key. The stored OpenRouter key serves `typesafe/jev-1.13` and `typesafe/jev-1.14` (probed: 619 ms, ~$0.00002 per call). The direct TypeSafe catalog only has `jev-latest`. | `JEV_MODEL=openrouter/typesafe/jev-1.14` (default). If `TYPESAFE_API_KEY` is set and `JEV_MODEL` names `typesafe/...`, that is used instead. |
| ESCI grocery slice "from when-to-use-jev" | No public repo by that name. | Build the slice from Amazon's ESCI dataset (Apache-2.0, `amazon-science/esci-data`), US locale, grocery-like queries, split into `practice` and `test`. |
| Runner "same approach as the review script" | No script in the repo. | `agent/evals/run.ts` posts `RunAgentInput` to `http://localhost:8000/agui` with `x-agent-secret`, parses the SSE stream. |
| Token usage per run | Only logged to the console today. | M0 adds a `CUSTOM` AG-UI event `run_stats` emitted before `RUN_FINISHED`. |
| Skills dir in Docker | `agent/Dockerfile` copies only `src/`. | Add `COPY agent/skills ./skills`; resolve the dir from `SKILLS_DIR` (default `<agent root>/skills`). |

## Feature flags

`config.ts` gains `flags` parsed from env (`1`, `true`, `on` are true; default off in code). `.env-agent` turns each on only after its milestone check passes; `.env-agent.example` lists them all.

| Env | Milestone | Effect when on |
| --- | --- | --- |
| `JEV_RERANK` | M1 | shop re-ranks picks with Jev |
| `PROMPT_V2` | M2 | core prompt + skills + `load_skill` instead of the legacy prompt |
| `JEV_STAYS` | M3 | stays scores listings against `wants` |
| `JEV_MUSIC` | M3 | music cover match chooses with Jev |
| `TURN_BUDGET` | M3 | turn-level budget instead of per-group caps |
| `SOURCES_V2` | M4 | source registry + JSON-LD reader |
| `CODEMODE` | M5 | codemode for models with the `codemode` capability |
| `WORKSPACE` | M6 | SQLite workspace, `plan` tool, session restore |
| `ROUTER` | M7 | pre-turn Jev router hints and policy hand-off |
| `RPIV` | M8 | research workflow with verify step |

Flags are part of `AgentConfig`. When a flag is off, behavior is exactly today's.

## Jev judge (M1, used by M3, M5, M7, M8)

`agent/src/judge/index.ts`:

```ts
export type Level = { means: string; not: string };
export type ScoreCriteria<L extends string> = { id: string; version: string; question: string; levels: Record<L, Level> };
export type YesNoCriteria = { id: string; version: string; question: string; yes: string; no: string };
export type ChooseCriteria = { id: string; version: string; question: string };

export type Scored<L extends string> = { id: string; level: L; p: number; probabilities: Record<L, number> };

export interface Judge {
  readonly available: boolean;
  score<L extends string>(items: { id: string; state: Record<string, unknown> }[], c: ScoreCriteria<L>, o?: { signal?: AbortSignal }): Promise<Scored<L>[] | null>;
  yesno(items: { id: string; state: Record<string, unknown> }[], c: YesNoCriteria, o?: { signal?: AbortSignal }): Promise<{ id: string; yes: boolean; p: number }[] | null>;
  choose(state: Record<string, unknown>, options: Record<string, string>, c: ChooseCriteria & { none?: string }, o?: { signal?: AbortSignal }): Promise<{ choice: string | null; p: number } | null>;
  usage(): { calls: number; failures: number; costUsd: number };
}
export function createJudge(opts: { runtime: ModelRuntime; model: string; timeoutMs?: number; concurrency?: number; log?: (line: string) => void }): Promise<Judge>;
export const noJudge: Judge; // available=false, every call returns null
```

- `null` means "fall back": model missing, timeout (default 4000 ms per call), provider error, or any item failed. Callers must treat `null` as "use today's path".
- `score` uses one classifier `choice` question per item (labels = level keys, criteria text = `means … Not: not`). Max 4 calls in flight (`lib/concurrency.ts`).
- Decision log: one line per call, `[jev] {"c":"productMatch@1","h":"<sha1 of state, 8 chars>","ans":"exact","p":0.94,"ms":420}`; failures `[jev] {"c":…,"error":"timeout"}`.
- Usage accumulates per judge; a per-turn judge is created from a per-session factory so `run_stats` reports Jev calls and cost per turn.
- Criteria are frozen code under `agent/src/judge/criteria/<name>.ts`, each exporting a versioned constant.

## Evals (M0)

```
agent/evals/
  scenarios/*.yaml      one file per scenario
  fixtures/esci-grocery.jsonl
  fixtures/routing.jsonl          (M7)
  run.ts  assert.ts  report.ts  rank.ts  sse.ts
  baseline/<model>.json           committed baseline summaries
  results/<date>-<label>-<model>/ runs.jsonl + report.md (committed per milestone)
```

Scenario YAML:

```yaml
id: party
proves: [M1, M2, M5, M6]
context: { timeZone: America/Los_Angeles, locale: en-US, home: "Palo Alto, CA" }
turns:
  - prompt: "Plan an 8th birthday party for 12 kids, budget $300"
    if_asked: "12 kids, Saturday Nov 14 at home, $300 total, pizza and cake, shop at Target"
  - prompt: "make it 16 kids"
assert:
  - { type: must_call, tool: shop }
  - { type: must_not_call, tool: browse }
  - { type: max_tool_calls, n: 12, turn: 1 }
  - { type: widget_present, kind: cart }
  - { type: max_unverified_claims, n: 2 }
  - { type: banned_phrases, patterns: ["I (have )?booked", "added to (your )?cart on"] }
  - { type: max_duration_s, n: 300 }
  - { type: text_matches, pattern: "\\$\\d" }
  - { type: tool_arg_matches, tool: shop, pattern: "16" , turn: 2 }
  - { type: tool_result_matches, tool: stays, pattern: "Marriott|Hyatt" }
  - { type: widget_matches, kind: stay_list, pattern: "€|EUR" }
```

- When a turn's run calls `ask_user` and the turn has `if_asked`, the runner sends `if_asked` as the next user message before the next turn (counted in the same turn for assertions).
- `turn` (1-based) scopes an assertion; without it the assertion covers the whole scenario.
- `npm run eval -- --model <id> [--only a,b] [--runs N] [--label m1] [--url …]`. Writes `results/…` and prints the report with a diff against `baseline/<model>.json`.
- `npm run eval:rank [-- --judge]` runs offline ranking on the ESCI slice (test split): Exact@1 and NDCG@3 for `rankTiles` (keyword) and, with `--judge` and a key, the Jev re-rank. The keyword part runs in CI (`npm test` includes a test that runs it and checks the metrics compute).
- `run_stats` AG-UI `CUSTOM` event value: `{ inputTokens, outputTokens, cacheRead, costUsd, jevCalls, jevCostUsd, toolCalls, durationMs, skills: string[] }`.

The 12 scenarios and pass criteria are the table in the build plan's Overview.

## Skills + prompt split (M2)

- `agent/skills/<name>/SKILL.md` with frontmatter `name`, `description`; body is the playbook. Skills: trip-planning, party-planning, research, grocery-run, music, gift-ideas, dining-out (+ judging in M5).
- Loaded through `DefaultResourceLoader({ additionalSkillPaths: [skillsDir] })` without `noSkills`; the core prompt carries an index (`- name: description`) that we write.
- `load_skill({ name })` returns the body of a known skill only; unknown names list the available ones. No path input.
- Core prompt (identity, hard rules, grounding, voice, user context) under 2,000 characters before the user-context and profile sections; a test enforces it.
- Tool-specific rules move into tool descriptions; region defaults (grocery store per region) into `shop/stores.ts`; nearby airports are computed from the home location (`tools/geo.ts`, airports within 100 km by great-circle distance) instead of the Bay Area list.

## Later milestones: fixed points

- **M3** `stays` gains `wants: { brand?: string[]; area?: string; vibe?: string }` and `max_price` gains `currency`. `lib/fx.ts` uses `https://api.frankfurter.app/latest?from=EUR` (ECB rates, free, no key) with a 24 h in-memory cache and an injectable fetch. `TurnBudget`: total calls (default 24) and wall time (default 240 s) per turn, per-group soft limits as guidance; each budgeted result ends with `(budget: n of N calls used)`.
- **M4** `Source<Q, R>` = `{ id; vertical: "retail" | "stays" | "flights" | "dining" | "events"; regions: string[] ("*" = any); capabilities: string[]; defaultFor?: string[]; search(q: Q, ctx): Promise<R> }`; `registry.select({ vertical, region, capability })`.
- **M6** `workspace(thread_id TEXT, kind TEXT, id TEXT, json TEXT, version INTEGER, updated_at INTEGER, PRIMARY KEY(thread_id, kind, id))` in `${AGENT_DATA_DIR}/workspace.sqlite`. Kinds: `cart`, `trip`, `event`, `shortlist`. `plan` tool: `get`, `set`, `patch` (RFC 6902 subset: add, replace, remove). UI sends `workspace_edits` in AG-UI context (superset of `cart_edits`, which stays accepted).
- **M7** `agent/src/agui/router.ts`: `route({ message, lastTurns, workspaceSummary }) → { areas: Record<Area, number>, missingDetails: number, intent: "plan" | "buy" | "book" | "login", skills: string[], tools: string[] | null }`. Areas: lodging, flights, shopping, dining, research, music, weather. Threshold 0.5 for areas; any Jev failure → no hints. Runs in parallel with session fetch.
- **M8** `agent/src/workflows/research.ts`. Progress via `CUSTOM` event `workflow_step` `{ workflow: "research", phase: "research" | "plan" | "implement" | "verify", status: "start" | "done", detail? }`; the web step list shows them.

## Process

- Each milestone is built on its own branch (worktree), merged into `feat/v1` by the orchestrator after review.
- After each merge: agent and web lint, typecheck, test, build; Docker rebuild and restart; `npm run eval` on Sonnet (and Qwen for the scenarios the milestone proves); browser check; eval report committed under `agent/evals/results/`.
- Kill criteria: a Jev-backed milestone that doesn't beat its baseline stays behind its flag, with the reason in `docs/findings.md`.
