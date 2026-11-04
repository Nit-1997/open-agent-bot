# Contributing

Thanks for helping out. This guide covers local setup, where code lives, and what a pull request needs.

## Setup

You need Node 22 (see `.nvmrc`), Docker, and optionally Ollama for a local model. The repo is one npm workspace (`packages/shared`, `packages/core`, `packages/ui`, `packages/bff`, `packages/local-web`, `apps/desktop`, `e2e`, and the hosted `cloud/agent`, `cloud/web`, `cloud/e2e`, `cloud/deploy-config`) with a single root `package-lock.json`; install from the root.

```bash
npm ci && npx playwright install chromium
```

To run the local stack, follow the [README](README.md). To run or develop the hosted stack (Supabase, the web app, Caddy), see "Develop the hosted stack" in [cloud/README.md](cloud/README.md). Every host-run agent, script and eval needs `COPILOTKIT_TELEMETRY_DISABLED=true` (`COPILOTKIT_TELEMETRY_DISABLED=true npx tsx evals/run.ts ...`); the agent refuses to start without it, and the images set it already.

## Checks

CI runs these on every pull request. Run them from the repo root before you push (`npm run format -w <package>` fixes formatting); `npm run lint && npm run format:check && npm run typecheck && COPILOTKIT_TELEMETRY_DISABLED=true npm test && COPILOTKIT_TELEMETRY_DISABLED=true npm run build` runs all of them across the workspaces.

| Package | Commands |
| --- | --- |
| `@oab/shared` | `npm run build -w @oab/shared` (also built by the agent's `tsc -b`) |
| `@oab/core` | `npm run lint -w @oab/core && npm run format:check -w @oab/core && npm run typecheck -w @oab/core && npm test -w @oab/core && npm run build -w @oab/core` |
| `@oab/ui` | `npm run lint -w @oab/ui && npm run format:check -w @oab/ui && npm run typecheck -w @oab/ui && npm test -w @oab/ui` (no build: consumed as TypeScript source) |
| `@oab/bff` | `npm run lint -w @oab/bff && npm run format:check -w @oab/bff && npm run typecheck -w @oab/bff && npm test -w @oab/bff && npm run build -w @oab/bff` |
| `@oab/local-web` | `npm run lint -w @oab/local-web && npm run format:check -w @oab/local-web && npm run typecheck -w @oab/local-web && npm test -w @oab/local-web && npm run build -w @oab/local-web` (the Vite build lands in `packages/local-web/dist/`, which the local agent serves) |
| `@oab/cloud-agent` | `npm run lint -w @oab/cloud-agent && npm run format:check -w @oab/cloud-agent && npm run typecheck -w @oab/cloud-agent && npm test -w @oab/cloud-agent && npm run build -w @oab/cloud-agent` (the hosted agent; unit tests only) |
| `@oab/cloud-web` | `npm run lint -w @oab/cloud-web && npm run format:check -w @oab/cloud-web && npm run typecheck -w @oab/cloud-web && npm test -w @oab/cloud-web && npm run build -w @oab/cloud-web` (the hosted Next.js app; Vercel builds it from Root Directory `cloud/web`) |
| `@oab/cloud-e2e` | `npm run lint -w @oab/cloud-e2e && npm run format:check -w @oab/cloud-e2e && npm run typecheck -w @oab/cloud-e2e && npm test -w @oab/cloud-e2e` (the hosted Playwright specs; `test` runs only the unit tests, never a browser) |
| `@oab/cloud-deploy` | `npm run lint -w @oab/cloud-deploy && npm run format:check -w @oab/cloud-deploy && npm test -w @oab/cloud-deploy` (hosted deploy checks: cloud workspaces and Dockerfiles, the hosted compose file against its pre-M6 baseline fixture, preflight, the `local/` twins, migrations pinned by a SHA-256 fixture, the hosted docs, `scripts/env-files.mjs` and `scripts/env-check.mjs`; the hosted compose checks need Docker Compose 5 or later, which CI installs with `scripts/ci/compose-plugin.sh`) |
| root | `npm run lint:scripts && npm run format:check:scripts` (Biome over `scripts/**/*.mjs`, also run by the root `lint` and `format:check`) and `node --test scripts/test/*.test.mjs` (workspace layout, the CSS selector script, the root `Makefile`, and the unique-id scan over `packages/ui/src`, `packages/local-web/src` and `apps/desktop/src/screens`; `node scripts/ids-static.mjs` prints `ids: N/N`; `cloud/web/test/idsStatic.test.ts` scans those plus `cloud/web/app` and `cloud/web/components`) |
| e2e | local only, `make test-e2e`, ~15 min: the Mac app's Electron e2e with the fake docker CLI and against real Docker (project `oab-e2e-desktop`, ports 18480–18485, a private 0700 temp folder; set `OAB_E2E_TMP_PARENT` if `$TMPDIR` is writable by others), then the hosted preview smoke (`make web`, `/health` and `/login`) when `cloud/deploy-config/env-files/{backend,frontend}/.env` exist (skipped otherwise). Run it before you push a change to `apps/desktop/`, `docker-compose.yml` or the hosted stack. The DMGs are built and verified by `release.yml` on tags |

The required pull request checks are the CI jobs `core`, `cloud`, `compose`, `sqlite-node24`, `local-stack`, `standalone` and `desktop` (lint, typecheck, unit tests and build of `@oab/desktop`; no Electron e2e). CI stays quick: end-to-end tests run locally only.

Agent tests marked `.int.test.ts` start a real Chromium against local fixture servers. Tests under `test/pi/` call a live model and are skipped unless `LLM_BASE_URL` is set. Tests under `cloud/agent/test/supabase/` run against the real Supabase project with `npm run test:supabase -w @oab/cloud-agent`; they create `oab-test+<uuid>@example.test` users with the admin API (no email is sent) and delete them afterwards.

The local stack's store uses `node:sqlite`. The host and CI run Node 22, but the agent image runs Node 24, so CI's `sqlite-node24` job also runs the SQLite store and local entry tests in the agent's base image (Node 24). Run the same check from the repo root before you change `src/local/`:

```bash
docker run --rm --user pwuser -v "$PWD":/src:ro -e ELECTRON_SKIP_BINARY_DOWNLOAD=1 -e COPILOTKIT_TELEMETRY_DISABLED=true mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea sh -ec '
  mkdir -p /tmp/repo && cd /src && tar --exclude=./node_modules --exclude="./*/node_modules" --exclude="./*/*/node_modules" --exclude=./.git --exclude=./.factory -cf - . | tar -C /tmp/repo -xf -
  cd /tmp/repo && node --version && case "$(node -p process.versions.node)" in 24.*) ;; *) echo "Node 24 required, got $(node -p process.versions.node)" >&2; exit 1 ;; esac
  npm ci -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root
  npm run build -w @oab/core
  cd packages/core && npx vitest run test/local test/store'
```

It copies the source without `node_modules` and runs `npm ci` inside the container, because the host's macOS `node_modules` don't run on Linux. The build compiles `@oab/shared` and `@oab/bff` (which the local entry imports from `dist/`) and `packages/core/dist/local/main.js`, which the entry tests start. It runs as `pwuser`, not root, because root can read the mode-0000 key files the tests expect to be refused.

## Releases

The owner makes releases from a `v*` tag with `.github/workflows/release.yml`; every step, the GitHub settings and the rollback are in [docs/RELEASING.md](docs/RELEASING.md).

- Release logic lives in `scripts/release/`, one script per step, and is tested by `scripts/test/release.test.mjs`, `scripts/test/releaseWorkflow.test.mjs`, `scripts/test/dryRunWorkflow.test.mjs` and `scripts/test/workflowPins.test.mjs`. The workflow only calls those scripts (plus `gh` and `docker`); don't add release logic inline in a `run:` step. `npm run lint:workflows` runs actionlint from a pinned image over every workflow.
- `.github/CODEOWNERS` names the owner for the workflows, `scripts/release/`, `scripts/docs/`, `scripts/demo/`, `docs/INSTALL.md`, `README.md` and `apps/desktop/release-policy.json` (the `minShellVersion` every release manifest carries).
- **Dry run.** It runs every workflow step that doesn't need GitHub on this Mac: builds and pushes both images for both platforms to a local registry, writes the release lock and manifest, builds and checks both DMGs, and writes `SHA256SUMS`, the notes and the draft release. The DMG checks and the `SHA256SUMS` line are `release.yml`'s own `verify-dmgs` and `attest` run blocks, read from the workflow and run verbatim, so the dry run tests what a release runs. It needs test mode, a `0.0.0-dryrun.<n>` version, a registry on `127.0.0.1:18xxx` and an `oab-` builder:

```bash
docker run -d --name oab-factory-m5-registry -p 127.0.0.1:18501:5000 registry:2@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373
printf '[registry."127.0.0.1:18501"]\n  http = true\n  insecure = true\n' > /tmp/oab-buildkitd.toml
docker buildx create --name oab-factory-m5-builder --driver docker-container --driver-opt network=host --buildkitd-config /tmp/oab-buildkitd.toml
OPEN_AGENT_SHELL_TEST=1 npm run release:dry-run -- --version 0.0.0-dryrun.1 --registry 127.0.0.1:18501 --builder oab-factory-m5-builder --out .factory/m5/release-dry-run/0.0.0-dryrun.1
```

The output folder holds `lock/`, `dmgs/`, `release/` (the four release assets, `draft-release.json` and `notes.md`) and `mock-release/`. `--services-only` skips the DMGs, and `--platforms linux/arm64` builds one platform while you iterate (the lock step then refuses the index, as a release would). The amd64 agent image builds under emulation on an Apple silicon Mac and takes a while. Afterwards: `docker rm -f -v oab-factory-m5-registry && docker buildx rm oab-factory-m5-builder`.

## End-to-end tests and evals on the local stack

`e2e/playwright.local.config.ts` drives the local stack (no Supabase, no sign-in) on a desktop viewport with video on. It has two projects:

- `local`: the stub-model subset in `e2e/local/` (every spec but `demo.spec.ts`): onboarding, streaming and Stop, a report with its PDF, search and the shell.
- `local-demo`: `e2e/local/demo.spec.ts`, the recorded demo on a real model, including the check that pages on other origins can't use the API.

`APP_ORIGIN` must be set on the command to the local stack, and must be `http://127.0.0.1` or `http://localhost` on a port in 18000–19999 (this config has no `E2E_ALLOW_LIVE` opt-in). Run a separate stack on a test port with its own project and `oab-` volumes, so the run starts from an empty database and never touches your own:

```bash
OPEN_AGENT_PORT=18330 OPEN_AGENT_DATA_VOLUME=oab-e2e-data OPEN_AGENT_KEYS_VOLUME=oab-e2e-keys docker compose -p oab-e2e up -d --build --wait
npx tsx e2e/support/stubModel.ts &
APP_ORIGIN=http://127.0.0.1:18330 npm run local -w e2e
```

- **Stub model.** `e2e/support/stubModel.ts` is an OpenAI-compatible server that streams scripted replies and creates a report on request, so `local` needs no key and costs nothing. It listens on `STUB_PORT` (default 18341, 18000–19999 only) and binds `127.0.0.1` unless `STUB_BIND` says otherwise; set `STUB_BIND=0.0.0.0` where the agent container can't reach the host's loopback (Linux). The specs connect it in onboarding as a custom provider at `http://$STUB_HOST:$STUB_PORT/v1` (`STUB_HOST` defaults to `host.docker.internal`).
- **After a restart.** `npm run local -w e2e` skips the tests tagged `@after-restart`. Run `docker compose -p oab-e2e down` and the same `up` command (the volumes are kept), then `APP_ORIGIN=http://127.0.0.1:18330 npm run local:after-restart -w e2e` checks that the chat, the report and the provider survived and that a new reply streams.
- **Demo.** `APP_ORIGIN=http://127.0.0.1:18330 E2E_ENV_FILE=/absolute/path/to/key-file npm run local:demo -w e2e -- --grep-invert @after-restart` runs the demo on a fresh stack; after a down and up, `-- --grep @after-restart` runs its second part. It needs `E2E_OPENROUTER_KEY`, from the environment or from the file named by `E2E_ENV_FILE` (`KEY=value` lines; `APP_ORIGIN` is never read from it), which it saves through the API before the UI opens (never typed or logged). `DEMO_SLOWMO=<ms>` slows it down for recording.

Remove the test stack and its volumes afterwards with `docker compose -p oab-e2e down -v`.

`npx tsx evals/run.ts --target local --origin http://127.0.0.1:3000 --openrouter-key-env OPENROUTER_API_KEY --model openrouter/deepseek/deepseek-v4-flash` (from `packages/core`, with `COPILOTKIT_TELEMETRY_DISABLED=true`) runs the scenarios in `packages/core/evals/scenarios/` against the local stack with no Supabase: it saves the key from the named variable through the app, then posts each run to `/api/copilotkit/agent/openagent/run`. Live runs cost money; `--only a,b` and `--runs N` keep them small. `local` is core's only target; the signed-in `--target hosted` runs from `cloud/agent` (cloud/README.md "Evals").

## Mac app

`apps/desktop` (`@oab/desktop`) is a thin Electron shell: it starts the local Docker stack (agent, search, renderer) from the bundled `docker-compose.yml` and shows the UI from `127.0.0.1`. The agent never runs inside Electron.

**Build.** Electron's binary is not downloaded by `npm ci`; fetch it once, then build and stage the stack files:

```bash
npm run electron:install -w @oab/desktop
npm run build -w @oab/desktop && npm run stage -w @oab/desktop
npm run lint -w @oab/desktop && npm run format:check -w @oab/desktop && npm run typecheck -w @oab/desktop && npm test -w @oab/desktop
npm run dist -w @oab/desktop -- --arm64 --x64   # macOS only: both DMGs in apps/desktop/release/, ad-hoc signed, fuses flipped
```

**Test mode.** Every test runs the app with `OPEN_AGENT_SHELL_TEST=1` and a separate state dir (`OPEN_AGENT_SHELL_STATE_DIR`), an `oab-…` project and volumes, and a port range inside 18000–19999. Test mode never touches `~/Library/Application Support/Open Agent` or the real `open-agent` project. The window title ends in " — test" and the window shows "TEST MODE". Two test-only knobs keep tests from sleeping or depending on this Mac: `OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS` (the external-link rate and de-duplication window) and `OPEN_AGENT_SHELL_FAKE_APPS` (`docker-desktop`, `orbstack`; which Docker apps the screens offer to open).

**Tests with the fake docker CLI** (no Docker needed; `apps/desktop/test/fake-docker/` emulates the CLI and the agent). On Linux run it under `xvfb-run -a`:

```bash
(cd e2e && npx playwright test -c playwright.desktop.config.ts --project desktop-fake)
```

**Packaged smoke** (macOS, after `npm run dist`): fuses, `Info.plist`, `lipo -archs`, `codesign --verify --deep --strict`, the bundled stack hashes and the size budget, then a test-mode launch of each `.app` with the fake CLI (polls `status.json` for `app`, `curl`s `/health`, sends SIGTERM and checks the recorded `compose … stop`). No debugger is attached, so it works with the fuses on. The x64 app runs under Rosetta. `--moved` also copies each app to a second folder and checks the stack stays ours; `--static` skips the launches.

```bash
node apps/desktop/scripts/packagedSmoke.mjs --app "apps/desktop/release/mac-arm64/Open Agent.app" --app "apps/desktop/release/mac/Open Agent.app" \
  --dmg apps/desktop/release/Open-Agent-0.0.0-dev-arm64.dmg --dmg apps/desktop/release/Open-Agent-0.0.0-dev-x64.dmg --moved
```

**Real Docker smoke** (your own engine; `oab-` names and 184xx ports only). Build two dev images, describe them in a dev services file, then run the `desktop-real` project. It covers the lifecycle (stop on quit, token reuse, `kek_missing` reset, watchdog), a smoke with onboarding on the stub model and a streamed reply, Services & data, and the local build. Each spec removes its project and volumes when it ends.

```bash
docker build -f packages/core/Dockerfile --build-arg OPEN_AGENT_VERSION=0.0.0-dev -t oab-dev-agent:dev .
docker build --build-arg OPEN_AGENT_VERSION=0.0.0-dev -t oab-dev-search:dev local/searxng
node -e 'const c=require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync("docker-compose.yml")).digest("hex");require("node:fs").writeFileSync("/tmp/oab-dev-services.json",JSON.stringify({schema:1,kind:"dev",version:"0.0.0-dev",composeSha256:c,images:{agent:"oab-dev-agent:dev",search:"oab-dev-search:dev"},pull:false}))'
cd e2e && DESKTOP_REAL_DOCKER=1 DESKTOP_REAL_SERVICES=/tmp/oab-dev-services.json DESKTOP_REAL_PROJECT=oab-dev-desktop \
  DESKTOP_REAL_RANGE=18480-18482 DESKTOP_LOCAL_RANGE=18484-18485 STUB_PORT=18483 DESKTOP_REAL_AGENT_IMAGE=oab-dev-agent:dev \
  npx playwright test -c playwright.desktop.config.ts --project desktop-real
cd .. && DESKTOP_REAL_DOCKER=1 DESKTOP_REAL_AGENT_IMAGE=oab-dev-agent:dev DESKTOP_REAL_SEARCH_IMAGE=oab-dev-search:dev \
  DESKTOP_REAL_PROJECT=oab-dev-contract DESKTOP_REAL_PORT=18487 npm test -w @oab/desktop -- compose.contract
```

The compose contract test needs both image variables and fails without them. The same packaged smoke runs against real Docker with `--docker /usr/local/bin/docker --services /tmp/oab-dev-services.json` (project `oab-smoke-<arch>`, port 18486). Afterwards remove the dev images with `docker image rm oab-dev-agent:dev oab-dev-search:dev`. On Linux the engine socket belongs to root, so a run there also sets `OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET=1`, `DESKTOP_REAL_DOCKER_CLI=/usr/bin/docker`, `DESKTOP_REAL_ENGINE=Docker` and `STUB_BIND=0.0.0.0` (the agent container reaches the stub through `host.docker.internal`).

**Local build (Gate 4: dogfood the DMG before any GHCR publish).** `npm run dist:local -w @oab/desktop` builds `open-agent:local` and `open-agent-search:local` from your checkout with plain `docker build` (no compose project is created), writes a `kind:"local"` lock with their image Ids, and packages a DMG for your Mac's arch. The app shows "Local build (`local-<sha>`)" and "Open Agent — Local build" in its title, and refuses to start (`local_images_changed`) if either image is later rebuilt or removed; run `dist:local` again then. "Update services" is not available for local builds.

1. `git clone https://github.com/Nit-1997/open-agent-bot && cd open-agent-bot && git checkout <merged M4 commit>`
2. `npm ci`
3. `npm run dist:local -w @oab/desktop` (Docker running; about 10 minutes the first time)
4. Open `apps/desktop/release/Open-Agent-0.0.0-dev-<arch>.dmg` and drag the app to Applications. A locally built file isn't quarantined, so there is no "Open Anyway".
5. Launch: the title shows "Local build"; onboarding; chat.
6. This uses the real project `open-agent` and the real volumes `open-agent-data`/`open-agent-keys`. Use Delete all data to start over, or `docker compose -p open-agent down -v` from the clone.

Tests never write `open-agent:local`: with `OPEN_AGENT_SHELL_TEST=1` the script refuses to run without `--tag-prefix oab-…` (for example `--tag-prefix oab-dev- --lock-out /tmp/oab-local.lock.json --no-dist`, which `e2e/desktop/localBuild.spec.ts` uses), and such a lock is only accepted in test mode.

## Layout

```
packages/core/src/
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
  local/               the local single-user stack (one container, SQLite, no Supabase)
    main.ts            entry (Docker CMD node dist/local/main.js): sets umask 077 first, then startLocal,
                       refuses with a fixed exit code, and closes on SIGINT/SIGTERM
    start.ts           startLocal(env): opens the store, ensures the fixed local user, loads the key files,
                       makes the agent secret in memory, starts the core with no listener and reaches it
                       in process through @oab/bff (localAuth), then serves the front
    config.ts          LocalConfig: data, keys, renderer and UI dirs, published and listen ports, launch
                       token, credential reset; refuses hosted settings
    front.ts           the front Hono app: GET /health, the Host guard, the request log, /api to the bff,
                       the static UI build with the page CSP and headers (ui_missing without index.html)
    hosts.ts           the Host allowlist and app origins derived from the published port (127.0.0.1:P,
                       localhost:P); hostGuard answers 421 misdirected to anything else
    keyFiles.ts        the credential key (/keys/kek) and the renderer secret, through lib/secretFile.ts;
                       kek_missing over saved credentials and the OPEN_AGENT_RESET_CREDENTIALS path
    refusal.ts         StartupRefusal, the refusal codes and exit codes, the one redacted refusal line
    requestLog.ts      one `[http] METHOD path status ms` line per request, with no query and ids scrubbed
    store/             the Store port over node:sqlite (the only place that imports it)
      sqliteStore.ts   openSqliteStore: the data dir with reports/ and backups/, pragmas (WAL, foreign keys),
                       integrity check and migrations, forUser, ensureUser, credential count and reset
      schema.ts        the SQL migrations (STRICT tables with CHECKs that match the Postgres rules)
      migrate.ts       user_version migrations in a transaction, a VACUUM INTO backup first, quick_check;
                       db_corrupt, db_newer and db_migration
      repos.ts         the per-user repositories (chats, messages, artifacts, profile, providers, credentials)
      search.ts        chat, message and report search in SQL with a case-folding function and snippets
      files.ts         report files (html, pdf, jpg) under reports/<user id>/, with checked ids and paths
      errors.ts        StoreOpenError for the open-time refusals, and sqliteError (SQLite codes → user errors)
      clock.ts         a monotonic ISO clock, so timestamps never repeat or go backwards
  http/                artifacts, chats, providers (model admin), profile, settings, onboarding
                       (places, chip options), reports, search, agui (chat stream), copilotkit (the
                       CopilotKit runtime at /copilotkit: allowlist, owner checks, connect cap, heartbeat);
                       handlers.ts holds shared helpers
  copilot/             the in-process CopilotKit agent (CoreRunAgent), thread owners and connect slots,
                       the caller-scoped runner, the SSE heartbeat
  agui/                run lifecycle (runHandler, startRun shared by /agui and CoreRunAgent), input
                       parsing, pi events → AG-UI events, typed event builders (events.ts), run stats
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
                       safe fetch), retry, fx, concurrency, rate limits, keyed mutex, log redaction,
                       secretFile.ts (key files shared by the renderer and local/: created once, 0600 and
                       exclusive, read with symlink, mode, owner and format checks; keyfile_invalid otherwise)
packages/shared/src/   the @oab/shared package: schemas used by both agent and web: widgets, workspace
                       edits, the profile and the agent persona (profile.ts), curated onboarding lists per
                       country (onboarding.ts), flights, list and search types (lists.ts), shell URL parsing
                       (routes.ts); import as `@oab/shared/<file>`; relative imports use the .ts extension
                       (`tsc -b` rewrites them); the agent runs the built dist, web and tests read the source
cloud/supabase/
  migrations/          SQL applied in order with the Supabase MCP (file name = recorded version)
  scripts/             configure-auth (auth config as code), bootstrap-admin, dev-link, cleanup-e2e
  templates/           invite and magic-link email templates
packages/ui/src/        the @oab/ui package: the chat UI with no Next, Supabase or cloud imports; consumed
                       as TypeScript source (`@oab/ui/platform`, `@oab/ui/platform/api`,
                       `@oab/ui/platform/chat`, `@oab/ui/components/<path>.tsx`, `@oab/ui/lib/<path>.ts`,
                       `@oab/ui/views/<path>.tsx`, `@oab/ui/styles/<file>.css`); imports into
                       `@oab/shared` stay extensionless, so every consumer aliases
                       `@oab/shared/<file>` → `packages/shared/src/<file>`
  platform/            PlatformProvider (router, Link, history, user, cloud slots), the API client
                       (api.ts, `@oab/ui/platform/api`), historyRouter/memoryRouter; ChatRuntime
                       (the CopilotKit provider) is its own entry, `@oab/ui/platform/chat`
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
  views/RouteView.tsx  a Route from @oab/shared/routes → its section view
  styles/              theme.css (tokens, base layer, utilities, the backdrop.jpg it references) and
                       fonts.css (self-hosted fonts)
packages/bff/src/      the @oab/bff package: the framework-free /api handler (createBff) for the API
                       routes: route table (routes.ts), same-origin, body cap, timeout and passthrough
                       (forward.ts), artifact formats and the framed error page (artifacts.ts), the
                       /api/copilotkit streaming proxy and its allowlist (copilotkit.ts), Next-compatible
                       params (params.ts); built with `tsc -b` to dist
packages/local-web/src/ the @oab/local-web package: the Vite app for the local UI (main.tsx, LocalApp.tsx,
                       theme.ts); @oab/ui with no login or cloud slots, built to dist/ and served by the local agent
cloud/web/
  proxy.ts             session refresh, route rules and the nonce CSP on every request
  app/                 login, request-access, auth confirm/callback/signout, admin
  app/(app)/           the shell routes: /, /chats, /chats/[id], /reports, /reports/[id],
                       /search; each validates its params and renders RouteView; one layout keeps
                       the shell and chats mounted
  app/api/             one-line adapters to the @oab/bff handler (lib/bff.ts)
  app/globals.css      imports tailwindcss with `source(none)` and @oab/ui's styles; `@source` lists
                       exactly app/, components/, lib/ and packages/ui/src (never tests or fixtures)
  components/          cloud-only UI: admin, landing, auth, session (the hosted platform slots)
  lib/                 hosted platform (platform/hosted.tsx), Supabase auth, route rules, CSP, env
cloud/agent/src/       the @oab/cloud-agent package: the hosted (Supabase) implementation, built from cloud/agent/Dockerfile
  server.ts            entry (Docker CMD node dist/server.js): loadHostedConfig → hostedAgentDeps → startAgent → signals
  deps.ts, config.ts, gateway.ts, routes.ts, ambientEnv.ts
  store/               Supabase client, the Store over Supabase, admin and rotation repositories
  identity/            JWT verification (JWKS, ES256), active-user cache, capabilities, admin guard
  admin/               approve/invite/deactivate/delete, Supabase Auth admin adapter
  access/              request-access and email-link service (IP pepper, padding, limits)
  http/                the access and admin routes
  secrets/             credential key rotation
  scripts/             operator scripts run inside the container (rotateCredentials.ts)
cloud/agent/test/      the hosted tests and their harness (fixtures/hostedApp.ts wraps core's makeApp); evals/run.ts
                       registers --target hosted on core's evals runner
e2e/                   Playwright checks: the local stack (see "End-to-end tests and evals on the local stack") and the Mac
                       app (playwright.desktop.config.ts); support/ also holds origin.ts and onboarding.ts for cloud/e2e
cloud/e2e/             the @oab/cloud-e2e package: hosted preview Playwright specs (the "End-to-end demo" section of cloud/README.md)
cloud/deploy-config/   the one deployment folder, the @oab/cloud-deploy package: the hosted compose file and its preview
                       override, caddy/, litellm/, renderer/, searxng/, scripts/env-files.mjs and env-check.mjs,
                       doc-commands.json (the owner-only commands of cloud/README.md), the hosted deploy tests, and
                       env-files/{backend,frontend,ops}/: a tracked .env.example (names only) beside each git-ignored .env
cloud/README.md        the hosted deployment: run, develop, e2e, evals, and the Gate 6/7 switch-over runbook
cloud/SECURITY.md      the hosted threat model and known limitations
scripts/release/       one script per release step (gate, image checks, index and lock checks, notes, sums, dry run);
                       release.yml and the dry run call only these, and scripts/test/ tests each one
scripts/docs/          the docs-commands extractor, its manifest (doc-commands.json), the scratch-clone runner and
                       fill-digests.mjs (the release digests in INSTALL section 9)
scripts/demo/          the milestone demo parts the verifier records (m<n>/part-<n>.sh, m<n>/lib.sh) and their
                       static checks (partChecks.mjs)
scripts/boundary/      the cloud boundary check (cloud-boundary.mjs, allow.json) and the stale-path guard (moved-paths.*)
scripts/move/          verify-move.mjs: classifies the commits of a move PR (renames, import lines, path lines, other)
scripts/ci/            standalone.sh: removes cloud/ from a fresh clone and checks, builds and runs the rest
scripts/test/          node --test suites for the root scripts, the workflows, the base pins and the docs
```

### Hosted boundary

Core never depends on the hosted implementation; the hosted code in `cloud/agent` depends on core only through its ports.

- Hosted files import core as `@oab/core/<path>.js` (core's `exports` map in `packages/core/package.json`; `cloud/agent` builds against core's declarations through a project reference) and other hosted files by relative path.
- `@oab/core/scripts/*` and `@oab/core/local/*` are blocked: the `exports` map sets them to `null`. Core has no hosted modules. Hosted code never imports `@oab/core/identity/local*`, `@oab/core/local/*` or `node:sqlite` (`noRestrictedImports` in `cloud/agent/biome.json`).
- Nothing in `packages/core` imports `cloud/`, `@supabase/*`, `jose` or `@oab/core/*`, with no exceptions: `noRestrictedImports` in `packages/core/biome.json` over all of `src/**`, and `packages/core/test/lint/noHostedInCoreTests.test.ts` over `src`, `test`, `evals` and `package.json`.
- Rules B1–B6 are checked by `cloud/agent/test/lint/hostedBoundary.test.ts` over core's `src/**/*.ts` together with `cloud/agent/src` (as `hosted/`), with the refusal fixtures in `packages/core/test/lint/hostedBoundary.test.ts`.

### Cloud boundary

Everything hosted lives in `cloud/`, and the open-source app builds, tests and runs with `cloud/` deleted. Nothing outside `cloud/` imports, builds from or points into it; code inside `cloud/` may use the rest of the repo.

- **Static check.** `node scripts/boundary/cloud-boundary.mjs` (run by `npm run lint:boundary`, the last step of the root `npm run lint`) parses every tracked and untracked (not ignored) file outside `cloud/`: imports in code and CSS (Rule A, never allowlisted), build inputs such as `package.json`, `tsconfig*.json`, bundler and test configs, Dockerfiles, compose files and `local/` (Rule B), string literals in code and shell scripts that name a `cloud/` path (Rule C), and tracked symlinks into `cloud/` plus `cloud/*/package.json` names that don't start with `@oab/cloud-` (Rule D). Each hit prints `VIOLATION <file>:<line> <rule> <token> -> <resolved>`. Rules B and C may be exempted file by file, with a reason, in `scripts/boundary/allow.json`.
- **Stale paths.** `scripts/boundary/moved-paths.json` lists every path M6 moved; `scripts/test/movedPaths.test.mjs` fails if an old path is still tracked or named outside its row's reasoned allow list.
- **Tests.** Tests outside `cloud/` never read files under `cloud/`; a test that checks a cloud file lives in `cloud/*/test`.
- **Standalone job.** `scripts/ci/standalone.sh` removes `cloud/` with `git rm` in a fresh clone under the temp folder (or a CI runner) and then runs `npm ci`, lint, format, typecheck, tests, build and the boundary check; `--hosted-free` also checks that core's build has no hosted code, and `--docker` builds the local images and starts the local stack on an `oab-` project. It refuses (exit 2, before deleting anything) without `OAB_STANDALONE_ALLOW_DELETE=1`, in a linked worktree, in a dirty tree or with ignored files under `cloud/`. CI's `standalone` job runs it with `--docker --hosted-free`; locally: `D=$(mktemp -d) && git clone -q "file://$PWD" "$D/oss" && cd "$D/oss" && OAB_STANDALONE_ALLOW_DELETE=1 bash scripts/ci/standalone.sh`.

## Adding a tool

1. Add `packages/core/src/tools/<name>.ts` that exports a factory returning `defineTool({...})`. Take network access (`fetch`) and other services as injectable deps so tests can fake them.
2. Validate URLs from the model with `publicHttpUrlError` and fetch them with `fetchPublic` from `lib/net.ts`. Never call `fetch` on a model-supplied URL directly.
3. Register it in `tools/index.ts`. Wrap it in `withBudget` if it costs a network round trip.
4. If it returns structured data for a card, add a renderer in `render/registry.ts` and a schema in `packages/shared/src/widgets.ts`.
5. Add a step label in `packages/ui/src/lib/steps.ts` and tests under `packages/core/test/tools/`.

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
- Every rendered HTML element in `cloud/web/` and `packages/ui/` has a unique, stable `id` derived from its parent's id. Ids inside a chat pane start with `chat-pane-<threadId>-`, because up to three panes can be mounted.
- Context for an agent run goes through `useThreadContext` (scoped to one chat's agent). `useAgentContext` is blocked by lint because it reaches every mounted chat.
- Keys are added in the app and stored encrypted by the agent. Settings live in three git-ignored files, `cloud/deploy-config/env-files/backend/.env` (every backend container; compose hands each service only its own names), `frontend/.env` (the Next.js app) and `ops/.env` (scripts, evals and e2e on the owner's machine); never commit them. The names are in the tracked `.env.example` beside each one. Merge the files of an older checkout into them with `cloud/deploy-config/scripts/env-files.mjs` (see cloud/README.md).
- Every agent data access goes through `forUser(db, userId)` with the id from the verified token. Never read a user id from a body, a header or a thread id.
- **Base pins.** The Playwright base image (the `v<x>-noble` tag with its `@sha256:` digest, as in the Node 24 command above) is the same everywhere it appears (the agent Dockerfile, the workflows, this file, the README, `docs/` and `scripts/`), and `<x>` equals the `playwright` pin in `packages/core/package.json` and `@playwright/test` in `e2e/package.json`; the SearXNG base is pinned by digest, and no workflow image runs without a digest. `scripts/test/basePins.test.mjs` enforces it, so a base change is one PR that updates all of them.
- **Docs commands.** Every line in a fenced `bash`, `sh` or `zsh` block of `README.md` and `docs/INSTALL.md` must be listed in `scripts/docs/doc-commands.json` with its mode (`run`, `env`, `subst` with the named substitutions, or `owner` with a reason); `scripts/test/docCommands.test.mjs` fails on a missing or stale entry. After a release dry run, `node scripts/docs/run-doc-commands.mjs --scratch "$(mktemp -d)" --release-dir <dry-run out> --log <file> --tsv <file> --branch <your branch>` runs them in a scratch clone of the committed branch (scratch `HOME` and Docker config, project `oab-factory-m5-clone` on port 18520). The shell blocks of `cloud/README.md` (the Gate 7 runbook) are listed in `cloud/deploy-config/doc-commands.json`, every one `owner` with a reason (`cloud/deploy-config/test/docs.test.mjs` checks it); pass `--owner-docs cloud/deploy-config/doc-commands.json` to the runner to list them in its log and TSV. Keep other docs' commands in inline code or non-shell blocks.
- Commit messages follow `type(scope): summary` (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`).

## Safety rails

The agent is read-only by design: it never logs in, adds to cart, pays, or books. Changes that weaken `browser/policy.ts`, `browser/guard.ts` or `lib/net.ts` need a clear reason in the pull request and tests that pin the new behavior.
