# First-run Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up -d` works on a fresh clone with no env files, and a new user is walked through a tap-first slideshow whose answers the agent stores and uses in every chat.

**Architecture:** The agent generates the web↔agent secret on a `shared` volume, owns a `profile.json` behind a `ProfileStore`, and serves `/profile`, `/places` (Photon), `/onboarding/options` (Overpass + curated lists + source registry) and `/settings`. The web proxies those routes and replaces the local-storage profile and old onboarding with a slideshow built from shared section components that the profile drawer reuses.

**Tech Stack:** Node 22, Hono, typebox (shared schemas), pi runtime, Next.js 16, React 19, vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-30-first-run-onboarding-design.md`

## Global Constraints

- Compose runs with no env files: every `env_file` is `required: false`; LiteLLM is `profiles: ["litellm"]`.
- No server default model: `AGENT_MODEL`, `chat-default` fallback and `defaultModelRef(cfg, …)` go; run without a model fails with "Pick a model in Settings → Models".
- Secrets generated on first start: shared secret 32 random bytes, owner/group-only; SearXNG secret kept on a volume.
- Jev candidates: `typesafe/jev-latest`, then `openrouter/typesafe/jev-1.14`; `JEV_MODEL` pins one.
- Codemode default: Claude Sonnet models from any provider; `AGENT_MODEL_CAPS` entries override.
- Prompt gets city, region, country only, never the street address.
- `user_context.profile` overrides the stored profile per run (eval harness sends `profile.home` as a string).
- Every HTML element has a unique `id` (`onboarding-*`, `profile-*`).
- Ports stay on 127.0.0.1. No migration of the old browser profile.

## Review Focus

- Free-text home that Photon can't match: stored as `{ label }` only; prompt omits home, tools geocode the label (test in Task 4 prompt builder).
- Overpass slow/502 (common on the public instance): options still return curated groceries within ~3 s (test in Task 5).
- Photon down or returning junk: `/places` returns `[]` with 200, not a 500 (test in Task 5).
- Profile PUT with oversize/unknown fields: cleaned and capped, never written raw (test in Task 2).
- Stored `defaultModel` that is no longer enabled: `/models` reports `default: null` and the run errors with the pick-a-model message (test in Task 3).

---

### Task 1: Zero-setup compose and generated secrets

**Files:** `docker-compose.yml`, `agent/Dockerfile`, `web/Dockerfile`, `deploy-config/searxng/entrypoint.sh` (new), `agent/src/lib/secret.ts` (new), `agent/src/config.ts`, `agent/src/server.ts`, `web/lib/agentServer.ts`, `web/app/api/copilotkit/[[...slug]]/route.ts`, `.github/workflows/ci.yml`, tests `agent/test/lib/secret.test.ts`, `agent/test/deploy/searxngEntrypoint.test.ts`, `agent/test/config.test.ts`.

**Interfaces:**
- Produces: `ensureSharedSecret(path: string): Promise<string>`; `AgentConfig.sharedSecretFile` (default `$(dirname dataDir)/shared/agent-secret`, env `AGENT_SECRET_FILE`); `AgentConfig.jevModels: string[]`; `hasCap` Sonnet default; `cfg.model`, `cfg.braveApiKey` removed; `AGENT_MODELS` only seeds LiteLLM (empty ⇒ discovered from `/model/info`).
- Web: `agentHeaders()` reads `AGENT_SHARED_SECRET` or the file at `AGENT_SECRET_FILE` (default `/data/shared/agent-secret`), cached once read.

- [ ] Tests: secret created once (64 hex chars, mode 0640), reused on second call; entrypoint script creates a secret file, reuses it, exports `SEARXNG_SECRET` and execs its args; config defaults without `AGENT_MODEL`; `hasCap(cfg, "openrouter/anthropic/claude-sonnet-5.5", "codemode")` true by default, `=none` disables.
- [ ] Compose: optional env files, `shared` + `searxng-data` volumes, web mounts `shared` read-only, `AGENT_URL` in `environment`, llm profile, no `depends_on: llm`. Dockerfiles create group `agentsecret` (gid 1500) for `pwuser` and `node`; `/data/shared` setgid 2750.
- [ ] CI job `compose`: `docker compose config` with no env files.
- [ ] Commit `build(compose): run with no env files and generate secrets on first start`.

### Task 2: Shared profile schema and agent ProfileStore

**Files:** `shared/profile.ts`, `agent/src/profile/store.ts`, `agent/src/http/handlers.ts` (extract `safe`, `body` from `http/providers.ts`), `agent/src/http/profile.ts`, `agent/src/app.ts`, tests `agent/test/shared/profile.test.ts`, `agent/test/profile/store.test.ts`, `agent/test/http/profile.test.ts`.

**Interfaces:**
- `ProfileSchema`, `type Profile`, `type Home = { label; city?; region?; country?; lat?; lon? }`, `emptyProfile(): Profile`, `parseProfile(v: unknown): Profile | null` (Clean + caps: tags ≤ 60 chars, ≤ 20 per list, name ≤ 80, notes ≤ 1000).
- `interface ProfileStore { get(): Promise<Profile>; put(p: Profile): Promise<Profile> }`, `FileProfileStore.at(dataDir)` writing `profile.json` atomically.
- `GET /profile`, `PUT /profile` behind the secret; invalid body ⇒ 400.

- [ ] Tests, implement, commit `feat(agent): store the user profile behind ProfileStore`.

### Task 3: Default model from the profile, TypeSafe, Brave setting, Jev resolver

**Files:** `agent/src/session/createSession.ts`, `agent/src/http/defaultModel.ts` (delete), `agent/src/http/providers.ts`, `agent/src/providers/catalog.ts`, `agent/src/providers/hub.ts`, `agent/src/http/settings.ts`, `agent/src/judge/index.ts`, `agent/src/server.ts`, `agent/src/tools/index.ts`.

**Interfaces:**
- `pickModel(hub, ref: string | undefined, fallback: string | undefined): Model` throws `Pick a model in Settings → Models.`
- `GET /models` ⇒ `{ default: profile.defaultModel if resolvable else null, models }`.
- Catalog `typesafe` entry (`note: "Used for Jev; no chat models"`); `ProviderView.note`.
- `hub.secret(name)`, `hub.setSecret(name, value)`, `hub.removeSecret(name)`; `GET /settings` ⇒ `{ braveSearch: boolean }`, `POST /settings/brave-search/key`, `DELETE /settings/brave-search`.
- `createJudgeFrom(runtime, refs[], concurrency)` returns the first available.

- [ ] Tests for each, implement, commit `feat(agent): default model lives in the profile; TypeSafe and Brave keys in the app`.

### Task 4: Agent uses the profile per run

**Files:** `agent/src/agui/runHandler.ts`, `agent/src/agui/input.ts`, `agent/src/prompt/userContext.ts`, `agent/src/prompt/region.ts`, `agent/src/prompt/systemPrompt.ts`, `agent/src/profile/prompt.ts`, `agent/src/profile/defaults.ts`, `agent/src/tools/index.ts`, `agent/src/tools/shop.ts`, `agent/src/tools/stays.ts`.

**Interfaces:**
- `RunOptions.profiles?: ProfileStore`; effective profile = `{ ...stored, ...override }`; `UserContext.profile?: Profile`.
- `profileLines(p: Profile): string[]` (one line per area; home as `city, region, country`; label-only home omitted).
- `regionFor(ctx)` prefers `profile.home.country`.
- `shopDefaults(profile, region)` ⇒ `{ grocery: string[]; general: string[] }` (user's stores with a registered reader first, then regional defaults, max 3); `staysDefaults(profile)` ⇒ `{ type; sources; brands }`.
- Tools: home lat/lon used directly for drives and airports.

- [ ] Tests: prompt never contains the street label; override wins; shop/stays defaults; commit `feat(agent): use the stored profile in prompts and tool defaults`.

### Task 5: Places and onboarding options

**Files:** `shared/onboarding.ts` (curated US, IN, GB, `*`; fixed chip rows), `agent/src/onboarding/places.ts`, `agent/src/onboarding/groceries.ts`, `agent/src/onboarding/options.ts`, `agent/src/http/onboarding.ts`.

**Interfaces:**
- `searchPlaces(q, f?)` ⇒ `Place[]` (≤ 5) from Photon; `GET /places?q=` (q < 3 chars ⇒ `[]`).
- `nearbyGroceries(lat, lon, f?, timeoutMs = 3000)` ⇒ `string[] | null` (Overpass, brand counts, top 6).
- `onboardingOptions({ lat?, lon?, country? }, deps)` ⇒ `OnboardingOptions` with `airports`, `currency`, `units`, rows `airlines`, `hotelChains`, `sites` (`access: "searched" | "linked"` from the registry), `groceries` (`nearby` flag), `retail`, `delivery`.

- [ ] Tests with fake fetch, commit `feat(agent): place typeahead and onboarding options`.

### Task 6: Web slideshow, drawer, proxies

**Files:** delete `web/components/profile/Onboarding.tsx`, `fields.tsx`, `web/lib/profile.ts` (rewritten); new `web/lib/onboarding.ts`, `web/components/profile/onboarding/*`, `web/components/profile/sections/*`, proxies `web/app/api/{profile,places,onboarding/options,settings/[[...path]]}/route.ts`; modify `Chat.tsx`, `ProfileDrawer.tsx`, `ModelsPanel.tsx` (export `ProvidersList`), `ProviderRow.tsx`, `ChatSession.tsx`, `Composer.tsx`, `lib/userContext.ts`.

- [ ] Tests: `slideOrder`, `summaryLines`, `starters`, chip toggles incl. exclusive chips and "+ add", address typeahead with mocked fetch; commit `feat(web): tap-first onboarding slideshow`.

### Task 7: Docs, examples, containers

- [ ] README Run/settings table, CONTRIBUTING layout, remove `deploy-config/*.example`, evals read the secret from the container; rebuild containers; fresh-volume run with a throwaway project; commit `docs: zero-setup run and settings reference`.
