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
| `agent` | `npm run typecheck && npm test && npm run build` |
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
                       browsePolicy.ts (what the browser may not do), budget.ts
  shop/                catalog tile extraction, ranking and the per-chat cart
  grounding/           checks prices, ratings and links against tool evidence
  render/              tool data → widget payloads
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

## Conventions

- TypeScript strict mode everywhere. Prefer small pure functions; keep I/O at the edges.
- Code explains itself through names. Add a comment only for a non-obvious reason.
- Every rendered HTML element in `web/` has a unique, stable `id` derived from its parent's id.
- Secrets live in `deploy-config/.env-*` files, which are git-ignored. Only commit the `.example` files.
- Commit messages follow `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`).

## Safety rails

The agent is read-only by design: it never logs in, adds to cart, pays, or books. Changes that weaken `tools/browsePolicy.ts` or `tools/net.ts` need a clear reason in the pull request and tests that pin the new behavior.
