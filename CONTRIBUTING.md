# Contributing

Thanks for helping out. This guide covers local setup, where code lives, and what a pull request needs.

## Setup

You need Node 22 (see `.nvmrc`), Docker, and optionally Ollama for a local model.

```bash
cd agent && npm ci && npx playwright install chromium
cd ../web && npm ci
```

To run the whole stack, follow **Run** in the [README](README.md). To work on one side, run the other in Docker and point at it:

- Agent: `cd agent && npm run build && npm start` (reads the same env vars as `deploy-config/.env-agent`)
- Web: `cd web && AGENT_URL=http://localhost:8000 npm run dev`

## Checks

CI runs these on every pull request. Run them before you push:

| Package | Commands |
| --- | --- |
| `agent` | `npm run lint && npm run typecheck && npm test && npm run build` |
| `web` | `npm run lint && npm run typecheck && npm test && npm run build` |

Agent tests marked `.int.test.ts` start a real Chromium against local fixture servers. Tests under `test/pi/` call a live model and are skipped unless `LLM_BASE_URL` is set.

## Layout

```
agent/src/
  server.ts            process wiring: config, provider hub, session store, shutdown
  app.ts               composes the HTTP routes in http/
  http/                artifacts, providers (model admin), agui (chat stream)
  agui/                pi session events → AG-UI events, run lifecycle
  pi/                  creating and disposing pi agent sessions
  providers/           model provider catalog, keys, OAuth sign-in flows
  session/             per-thread session store with idle sweep
  prompt/              system prompt and region/currency detection
  tools/               one file per agent tool, plus net.ts (URL guard, safe fetch),
                       browsePolicy.ts (what the browser may not do),
                       browserGuard.ts (blocks private-network requests), budget.ts
  shop/                catalog tile extraction, ranking and the per-chat cart
  stays/               hotel and rental search: one file per site in sources/
  workspace/           per-chat saved plan state (SQLite): store, summary, edits, cart binding
  grounding/           checks prices, ratings and links against tool evidence
  render/              tool data → widget payloads
  artifacts/           report storage, PDF export, and the report kit (reportKit.ts: CSS
                       components plus the guide the model sees in create_artifact)
  lib/                 small shared helpers with no tool dependencies
shared/                widget schemas and flight helpers used by both agent and web
web/
  app/api/             thin proxies to the agent (lib/agentServer.ts holds URL + secret)
  components/chat/     chat session, turns, activity steps, sources
  components/widgets/  one component per widget kind
  components/profile/  onboarding, profile drawer, model management
  lib/                 pure helpers (turn building, sources, profile storage)
```

## Adding a tool

1. Add `agent/src/tools/<name>.ts` that exports a factory returning `defineTool({...})`. Take network access (`fetch`) and other services as injectable deps so tests can fake them.
2. Validate URLs from the model with `publicHttpUrlError` and fetch them with `fetchPublic` from `tools/net.ts`. Never call `fetch` on a model-supplied URL directly.
3. Register it in `tools/index.ts`. Wrap it in `withBudget` if it costs a network round trip.
4. If it returns structured data for a card, add a renderer in `render/registry.ts` and a schema in `shared/widgets.ts`.
5. Add a step label in `web/lib/steps.ts` and tests under `agent/test/tools/`.

## Adding a source

Every provider (a store, a stay site, a flight search) is a `Source` in `agent/src/sources/`: `{ id, vertical, regions, capabilities, defaultFor?, search(q, ctx) }`. Tools never name providers; they ask the registry (`sources/registry.ts`) with `select({ vertical, region, capability })` or `defaults({ vertical, region, kind })`. `regions` are country codes (`"*"` for anywhere). `defaultFor` lists the region tags (`"IN"`, or `"US:grocery"` with a kind, or `"*"`) where the source is a default. Register it in `sources/index.ts`. A test can register a source on `createRegistry()` instead, as `agent/test/sources/registry.test.ts` does.

### A store

1. Add a `browserStore({...})` to `agent/src/sources/retail/stores.ts` (or its own file for one that needs special reading, like `shipt.ts`): `id`, `label`, `home`, `searchUrl(q)`, `regions`, and `defaultFor` if it is a regional default. `domains` defaults to `<id>.com`; set it for others (`amazon.in`). `aliases` are extra spoken names.
2. Add it to `SIMPLE_STORES`.
3. Add a resolution case to `agent/test/sources/registry.test.ts`.

A store with no entry still works: `shop` reads any unknown domain through its schema.org JSON-LD (`sources/jsonld.ts`, `sources/retail/jsonldStore.ts`): it finds product pages with a `site:` search, reads their offers, and reports a block with a link when the site denies access. `fetch_page` appends the same data as `structured:` lines.

### A stay site

1. Create `agent/src/sources/stays/<site>.ts` that exports `staySource({...})` (see `sources/stays/define.ts` and `stays/types.ts`):
   - `id`, `label`, `site` (domain, used for the favicon), and `lists` (`"hotel"`, `"rental"` or both, also its capabilities)
   - `searchUrl(q)`: the site's search URL for `q.location`, `q.checkin`, `q.checkout`, `q.adults`, `q.rooms` and `q.currency`
   - `read(page, q)` (optional): pulls listings from the loaded results page. Leave it out and the site is offered as a link the user opens, which is the right choice for sites that block automated browsers (see `expedia.ts`).
2. Split `read` in two, like `booking.ts`: a `collect` function that runs in the page and returns plain objects, and a pure `parse<Site>Card(card, q)` that turns one into a `Stay`. Prefer `data-testid` or ARIA labels over class names, which change often. Use the helpers in `stays/parse.ts` for prices, review counts and cleaning tracking parameters off links.
3. Add it to `STAY_SOURCES` in `sources/stays/index.ts`.
4. Add `parse` cases to `agent/test/stays/parse.test.ts` with card text copied from the real site, and a fixture-page case to `sources.int.test.ts`.

Check that the site's search results load for the agent's browser first: run the stack, ask for stays somewhere, and look at the stays card. Sites that blocked the browser or returned nothing readable are listed in its footer as links.

### A flight search

Export a `FlightSource` like `sources/flights/google.ts` and register it. The `flights` tool uses the first registered source (or pass `source` to `flightsTool`).

## Conventions

- TypeScript strict mode everywhere. Prefer small pure functions; keep I/O at the edges.
- Code explains itself through names. Add a comment only for a non-obvious reason.
- Every rendered HTML element in `web/` has a unique, stable `id` derived from its parent's id.
- Secrets live in `deploy-config/.env-*` files, which are git-ignored. Only commit the `.example` files.
- Commit messages follow `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`).

## Safety rails

The agent is read-only by design: it never logs in, adds to cart, pays, or books. Changes that weaken `tools/browsePolicy.ts` or `tools/net.ts` need a clear reason in the pull request and tests that pin the new behavior.
