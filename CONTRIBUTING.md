# Contributing

Thanks for helping out. This guide covers local setup, where code lives, and what a pull request needs.

## Setup

You need Node 22 (see `.nvmrc`), Docker, and optionally Ollama for a local model.

```bash
cd agent && npm ci && npx playwright install chromium
cd ../web && npm ci
```

To run the whole stack, follow **Run** in the [README](README.md). To work on one side, run the other in Docker and point at it:

- Agent: `cd agent && npm run build && set -a && . ../deploy-config/.env-agent && set +a && npm start` (settings in the README's reference table)
- Web: `cd web && set -a && . ../deploy-config/.env-nextjs && set +a && AGENT_URL=http://localhost:8000 npm run dev`

Both need the same `AGENT_SERVICE_SECRET` and a Supabase project (see **Run** in the README). Sign-in cookies are `Secure`, so use the Caddy stack at https://app.localhost for anything that needs a session.

## Checks

CI runs these on every pull request. Run them before you push (`npm run format` fixes formatting):

| Package | Commands |
| --- | --- |
| `agent` | `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` |
| `web` | `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build` |

Agent tests marked `.int.test.ts` start a real Chromium against local fixture servers. Tests under `test/pi/` call a live model and are skipped unless `LLM_BASE_URL` is set. Tests under `test/supabase/` run against the real Supabase project with `npm run test:supabase`; they create `oab-test+<uuid>@example.test` users with the admin API (no email is sent) and delete them afterwards.

## Layout

```
agent/src/
  server.ts            process wiring: config, Supabase clients, per-user hubs, session store, shutdown
  app.ts               composes the HTTP routes in http/ behind the auth guards
  auth/                service secret, JWT verification (JWKS, ES256), active-user cache, guards,
                       the ambient provider env refusal
  db/                  the only Supabase access: forUser(userId) repositories, admin repository,
                       error mapping; db/client.ts may be imported only here and by entry points
  crypto/              envelope AES-256-GCM for provider credentials, key wrapper, hints
  access/              request-access and email-link service (IP pepper, padding, limits)
  admin/               approve/invite/deactivate/delete, Supabase Auth admin adapter
  scripts/             operator scripts run inside the container (credential key rotation)
  http/                artifacts, chats, providers (model admin), profile, settings, onboarding
                       (places, chip options), access, admin, agui (chat stream); handlers.ts
                       holds shared helpers
  agui/                run lifecycle (runHandler), input parsing, pi events → AG-UI events,
                       typed event builders (events.ts), run stats
  pi/                  creating and disposing pi agent sessions
  providers/           model provider catalog, per-user hubs (LRU), the encrypted pi CredentialStore,
                       OAuth sign-in flows bound to their user
  profile/             ProfileStore (Supabase), the prompt lines built from it, and the tool
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
  workspace/           per-chat saved plan state (Supabase): store, summary, edits, cart binding
  grounding/           checks prices, ratings and links against tool evidence
  render/              tool data shapes (data.ts) → widget payloads
  artifacts/           report storage in Supabase Storage, thumbnail and PDF requests to the renderer
                       (remoteRenderer.ts), and the report kit (reportKit.ts: CSS components plus the
                       guide the model sees in create_artifact)
  renderer/            the separate renderer service (main.ts): sandboxed Chromium for thumbnails and PDFs
                       with the egress lock-down (chromium.ts, sanitize.ts), behind a shared secret (server.ts)
  lib/                 small shared helpers with no tool dependencies: net.ts (URL guard,
                       safe fetch), retry, fx, concurrency, rate limits, keyed mutex, log redaction
shared/                schemas used by both agent and web: widgets, workspace edits, the profile and
                       the agent persona (profile.ts), curated onboarding lists per country (onboarding.ts),
                       flights, list and search types (lists.ts), shell URL parsing (routes.ts);
                       relative imports use the .ts extension (the agent build rewrites them)
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
e2e/                   Playwright demo against the local stack (see README "End-to-end demo")
```

## Adding a tool

1. Add `agent/src/tools/<name>.ts` that exports a factory returning `defineTool({...})`. Take network access (`fetch`) and other services as injectable deps so tests can fake them.
2. Validate URLs from the model with `publicHttpUrlError` and fetch them with `fetchPublic` from `lib/net.ts`. Never call `fetch` on a model-supplied URL directly.
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

## Adding a country to onboarding

Onboarding chips come from `shared/onboarding.ts`: one `CURATED` entry per country code (airlines, hotel chains, extra booking sites, groceries, other shops, delivery apps), with `"*"` as the fallback. Adding a country is adding an entry. Travel sites read by a source in `agent/src/sources/` are tagged "searched" automatically; the rest are "linked". Nearby grocery stores come from Overpass and fall back to the country's list.

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
