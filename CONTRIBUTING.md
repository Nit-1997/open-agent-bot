# Contributing

Thanks for helping out. This guide covers local setup, where code lives, and what a pull request needs.

## Setup

You need Node 22 (see `.nvmrc`), Docker, and optionally Ollama for a local model. The repo is one npm workspace (`packages/shared`, `packages/core`, `web`, `e2e`) with a single root `package-lock.json`; install from the root.

```bash
npm ci && npx playwright install chromium
```

To run the whole stack, follow **Run** in the [README](README.md). To work on one side, run the other in Docker and point at it:

- Agent: `cd packages/core && npm run build && set -a && . ../../deploy-config/.env-agent && set +a && npm start` (`tsc -b` builds `@oab/shared` and then the agent into `packages/core/dist/`; settings in the README's reference table)
- Web: `cd web && set -a && . ../deploy-config/.env-nextjs && set +a && AGENT_URL=http://localhost:8000 npm run dev`

Both need the same `AGENT_SERVICE_SECRET` and a Supabase project (see **Run** in the README). Sign-in cookies are `Secure`, so use the Caddy stack at https://app.localhost for anything that needs a session.

## Checks

CI runs these on every pull request. Run them from the repo root before you push (`npm run format -w <package>` fixes formatting); `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` runs all of them across the workspaces.

| Package | Commands |
| --- | --- |
| `@oab/shared` | `npm run build -w @oab/shared` (also built by the agent's `tsc -b`) |
| `@oab/core` | `npm run lint -w @oab/core && npm run format:check -w @oab/core && npm run typecheck -w @oab/core && npm test -w @oab/core && npm run build -w @oab/core` |
| `web` | `npm run lint -w web && npm run format:check -w web && npm run typecheck -w web && npm test -w web && npm run build -w web` |

Agent tests marked `.int.test.ts` start a real Chromium against local fixture servers. Tests under `test/pi/` call a live model and are skipped unless `LLM_BASE_URL` is set. Tests under `test/supabase/` run against the real Supabase project with `npm run test:supabase`; they create `oab-test+<uuid>@example.test` users with the admin API (no email is sent) and delete them afterwards.

## Layout

```
packages/core/src/
  server.ts            the container entry (Docker CMD node dist/server.js): only imports hosted/main.js
  startAgent.ts        the composition root: startAgent(deps) wires the store, identity, key wrapper,
                       run policy, provider hubs, sessions and extra routes, and starts the server
  app.ts               composes the HTTP routes in http/ and the mounted routes behind the guards
  config.ts            CoreConfig: settings every deployment shares (port, SearXNG, renderer, limits)
  store/               the Store port: per-user repositories and row types (types.ts)
  identity/            the Identity port (Principal, Capabilities, guards, RouteMount) and the user
                       paths the core guard covers (userPaths.ts)
  secrets/             envelope AES-256-GCM for provider credentials, the KeyWrapper, CREDENTIAL_KEYS
                       parsing (keys.ts), hints, the credential store and secretsFor(store, wrapper)
  policy/              the RunPolicy port and LocalRunPolicy (per-user rate limit and concurrency)
  scripts/             operator scripts run inside the container (credential key rotation)
  hosted/              the hosted (Supabase) implementation; moves to cloud/agent in M6
    main.ts            entry: loadHostedConfig → hostedAgentDeps → startAgent → signals
    deps.ts, config.ts, gateway.ts, routes.ts, ambientEnv.ts
    store/             Supabase client, the Store over Supabase, admin and rotation repositories
    identity/          JWT verification (JWKS, ES256), active-user cache, capabilities, admin guard
    admin/             approve/invite/deactivate/delete, Supabase Auth admin adapter
    access/            request-access and email-link service (IP pepper, padding, limits)
    http/              the access and admin routes
    secrets/           credential key rotation
  http/                artifacts, chats, providers (model admin), profile, settings, onboarding
                       (places, chip options), reports, search, agui (chat stream); handlers.ts
                       holds shared helpers
  agui/                run lifecycle (runHandler), input parsing, pi events → AG-UI events,
                       typed event builders (events.ts), run stats
  pi/                  creating and disposing pi agent sessions
  providers/           model provider catalog, per-user hubs (LRU) with capability-gated private
                       networks and gateway, OAuth sign-in flows bound to their user
  profile/             ProfileStore (over the Store port), the prompt lines built from it, and the tool
                       defaults it implies
  onboarding/          Photon address search, Overpass nearby groceries, onboarding chip rows
  session/             sessions keyed by user and chat, with per-user and global caps and idle sweep
  prompt/              system prompt and region/currency detection
  tools/               one file per agent tool, each owning its full description, plus
                       the helpers budget.ts, result.ts, args.ts and text.ts
  browser/             Chromium pool (pool.ts), private-network guard (guard.ts), what the
                       browser may not do (policy.ts), live frames (frames.ts)
  shop/                catalog tile extraction, ranking and the per-chat cart
  stays/               hotel and rental search: one file per site in sources/
  workspace/           per-chat plan state kept in the agent session (in memory): store, summary, edits, cart binding
  grounding/           checks prices, ratings and links against tool evidence
  render/              tool data shapes (data.ts) → widget payloads
  artifacts/           report storage through the Store port, thumbnail and PDF requests to the renderer
                       (remoteRenderer.ts), and the report kit (reportKit.ts: CSS components plus the
                       guide the model sees in create_artifact)
  renderer/            the separate renderer service (main.ts): sandboxed Chromium for thumbnails and PDFs
                       with the egress lock-down (chromium.ts, sanitize.ts), behind a shared secret (server.ts)
  lib/                 small shared helpers with no tool dependencies: net.ts (URL guard,
                       safe fetch), retry, fx, concurrency, rate limits, keyed mutex, log redaction
packages/shared/src/   the @oab/shared package: schemas used by both agent and web: widgets, workspace
                       edits, the profile and the agent persona (profile.ts), curated onboarding lists per
                       country (onboarding.ts), flights, list and search types (lists.ts), shell URL parsing
                       (routes.ts); import as `@oab/shared/<file>`; relative imports use the .ts extension
                       (`tsc -b` rewrites them); the agent runs the built dist, web and tests read the source
supabase/
  migrations/          SQL applied in order with the Supabase MCP (file name = recorded version)
  scripts/             configure-auth (auth config as code), bootstrap-admin, dev-link, cleanup-e2e
  templates/           invite and magic-link email templates
web/
  proxy.ts             session refresh, route rules and the nonce CSP on every request
  app/                 login, request-access, auth confirm/callback/signout, admin
  app/(app)/           the shell routes: /, /chats, /chats/[id], /reports, /reports/[id],
                       /search; one layout keeps the shell and chats mounted
  app/api/             thin proxies to the agent with the user's token (lib/agentServer.ts)
  components/shell/    app shell: rail, sidebar, phone top bar, tabs and drawer, account menu and sheet,
                       overlays (focus trap, Escape, inert background), ShellProvider (chat controller)
  components/agent/    the agent's orb, name, look and tone pickers
  components/chat/     chat host and panes (one per running thread), session, turns, chat list
  components/reports/, components/search/   the section views
  components/widgets/  one component per widget kind
  components/profile/  onboarding slides (onboarding/, sections shared with the drawer),
                       profile drawer, model management
  lib/                 pure helpers (turn building, sources, onboarding, persona), profile client,
                       API clients, lib/shell/ (breakpoints, chat controller, sidebar preference)
e2e/                   Playwright demo and preview checks against a preview stack (see README "End-to-end demo")
```

### Hosted boundary

Core never depends on the hosted implementation; the hosted code depends on core only through its ports.

- Hosted files import core as `@oab/core/<path>.js` (a self-reference through the `exports` map in `packages/core/package.json`) and other hosted files by relative path. No relative import in `hosted/` leaves `hosted/`.
- `@oab/core/hosted/*` and `@oab/core/scripts/*` are blocked: the `exports` map sets them to `null`, and the boundary test refuses them in any letter case. Hosted code never imports `@oab/core/identity/local*`.
- Outside `hosted/`, nothing imports `hosted/` (except the entries `server.ts` and `scripts/rotateCredentials.ts`), `@supabase/*`, `jose` or `@oab/core/*`.
- Rules B1–B6 (spec `docs/superpowers/specs/2026-11-02-m1-seams-design.md`, "Boundary rules") are enforced by `packages/core/test/lint/hostedBoundary.test.ts` over every `src/**/*.ts` and by `noRestrictedImports` overrides in `packages/core/biome.json`.

## Adding a tool

1. Add `packages/core/src/tools/<name>.ts` that exports a factory returning `defineTool({...})`. Take network access (`fetch`) and other services as injectable deps so tests can fake them.
2. Validate URLs from the model with `publicHttpUrlError` and fetch them with `fetchPublic` from `lib/net.ts`. Never call `fetch` on a model-supplied URL directly.
3. Register it in `tools/index.ts`. Wrap it in `withBudget` if it costs a network round trip.
4. If it returns structured data for a card, add a renderer in `render/registry.ts` and a schema in `packages/shared/src/widgets.ts`.
5. Add a step label in `web/lib/steps.ts` and tests under `packages/core/test/tools/`.

## Adding a source

Every provider (a store, a stay site, a flight search) is a `Source` in `packages/core/src/sources/`: `{ id, vertical, regions, capabilities, defaultFor?, search(q, ctx) }`. Tools never name providers; they ask the registry (`sources/registry.ts`) with `select({ vertical, region, capability })` or `defaults({ vertical, region, kind })`. `regions` are country codes (`"*"` for anywhere). `defaultFor` lists the region tags (`"IN"`, or `"US:grocery"` with a kind, or `"*"`) where the source is a default. Register it in `sources/index.ts`. A test can register a source on `createRegistry()` instead, as `packages/core/test/sources/registry.test.ts` does.

### A store

1. Add a `browserStore({...})` to `packages/core/src/sources/retail/stores.ts` (or its own file for one that needs special reading, like `shipt.ts`): `id`, `label`, `home`, `searchUrl(q)`, `regions`, and `defaultFor` if it is a regional default. `domains` defaults to `<id>.com`; set it for others (`amazon.in`). `aliases` are extra spoken names.
2. Add it to `SIMPLE_STORES`.
3. Add a resolution case to `packages/core/test/sources/registry.test.ts`.

A store with no entry still works: `shop` reads any unknown domain through its schema.org JSON-LD (`sources/jsonld.ts`, `sources/retail/jsonldStore.ts`): it finds product pages with a `site:` search, reads their offers, and reports a block with a link when the site denies access. `fetch_page` appends the same data as `structured:` lines.

### A stay site

1. Create `packages/core/src/sources/stays/<site>.ts` that exports `staySource({...})` (see `sources/stays/define.ts` and `stays/types.ts`):
   - `id`, `label`, `site` (domain, used for the favicon), and `lists` (`"hotel"`, `"rental"` or both, also its capabilities)
   - `searchUrl(q)`: the site's search URL for `q.location`, `q.checkin`, `q.checkout`, `q.adults`, `q.rooms` and `q.currency`
   - `read(page, q)` (optional): pulls listings from the loaded results page. Leave it out and the site is offered as a link the user opens, which is the right choice for sites that block automated browsers (see `expedia.ts`).
2. Split `read` in two, like `booking.ts`: a `collect` function that runs in the page and returns plain objects, and a pure `parse<Site>Card(card, q)` that turns one into a `Stay`. Prefer `data-testid` or ARIA labels over class names, which change often. Use the helpers in `stays/parse.ts` for prices, review counts and cleaning tracking parameters off links.
3. Add it to `STAY_SOURCES` in `sources/stays/index.ts`.
4. Add `parse` cases to `packages/core/test/stays/parse.test.ts` with card text copied from the real site, and a fixture-page case to `sources.int.test.ts`.

Check that the site's search results load for the agent's browser first: run the stack, ask for stays somewhere, and look at the stays card. Sites that blocked the browser or returned nothing readable are listed in its footer as links.

### A flight search

Export a `FlightSource` like `sources/flights/google.ts` and register it. The `flights` tool uses the first registered source (or pass `source` to `flightsTool`).

## Adding a country to onboarding

Onboarding chips come from `packages/shared/src/onboarding.ts`: one `CURATED` entry per country code (airlines, hotel chains, extra booking sites, groceries, other shops, delivery apps), with `"*"` as the fallback. Adding a country is adding an entry. Travel sites read by a source in `packages/core/src/sources/` are tagged "searched" automatically; the rest are "linked". Nearby grocery stores come from Overpass and fall back to the country's list.

## Conventions

- TypeScript strict mode everywhere. Prefer small pure functions; keep I/O at the edges.
- Code explains itself through names. Add a comment only for a non-obvious reason.
- Every rendered HTML element in `web/` has a unique, stable `id` derived from its parent's id. Ids inside a chat pane start with `chat-pane-<threadId>-`, because up to three panes can be mounted.
- Context for an agent run goes through `useThreadContext` (scoped to one chat's agent). `useAgentContext` is blocked by lint because it reaches every mounted chat.
- Keys are added in the app and stored encrypted by the agent. Settings live in `deploy-config/.env-*` and `deploy-config/env-files/.env-*`, which are git-ignored; never commit them. Templates with names only are in `deploy-config/env.examples/`.
- Every agent data access goes through `forUser(db, userId)` with the id from the verified token. Never read a user id from a body, a header or a thread id.
- Commit messages follow `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`).

## Safety rails

The agent is read-only by design: it never logs in, adds to cart, pays, or books. Changes that weaken `browser/policy.ts`, `browser/guard.ts` or `lib/net.ts` need a clear reason in the pull request and tests that pin the new behavior.
