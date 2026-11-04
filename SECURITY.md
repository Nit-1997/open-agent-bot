# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a vulnerability** button on the repository's Security tab, not in a public issue. Include steps to reproduce and the impact you see.

## Supported versions

Only the latest release is supported. Fixes ship as a new release, which the app's daily update check offers. Prereleases (`-rc.N` tags) are release rehearsals and are not supported. The hosted deployment runs `main`.

## Verifying a download

Every release has a `SHA256SUMS` file next to the two DMGs and `open-agent-services.json` (the manifest the app's update check reads).

- **Corruption check.** In the folder with your downloads, `shasum -a 256 -c SHA256SUMS --ignore-missing` must print `OK` for each file you have. This catches corruption only (a broken or incomplete download): `SHA256SUMS` sits next to the files it lists, so anyone who could replace a DMG could replace it too.
- **Authenticity check.** For authenticity, GitHub attestations prove a file was built by this repository's release workflow from the release tag on a GitHub-hosted runner. You need a current `gh` (`brew upgrade gh`), signed in (`gh auth login`; `gh auth status` shows it). Replace `1.0.0` with the version you downloaded:

```bash
gh attestation verify Open-Agent-1.0.0-arm64.dmg --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners
gh attestation verify open-agent-services.json --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners
gh attestation verify oci://ghcr.io/nit-1997/open-agent@sha256:<agent-digest> --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners
```

The image digests are `images.agent` and `images.search` in the release's `open-agent-services.json`; check the search image the same way. Keep all three flags: a bare `--repo` check accepts an attestation signed by any workflow of the repository on any branch, while `--signer-workflow` and `--source-ref` accept only the release workflow at that tag, and `--deny-self-hosted-runners` only GitHub's own runners.

## Local stack

The root `docker-compose.yml` runs Open Agent for one person on their own computer: no accounts, one fixed local user, and data in SQLite on a Docker volume. The design is `docs/superpowers/specs/2026-11-03-m3-local-stack-design.md` (D7, D10, D11, D14).

- **Port.** Compose publishes the agent's port on `127.0.0.1` only, so other computers can't connect.
- **Host allowlist.** Every request except `GET /health` must name `127.0.0.1:<port>` or `localhost:<port>` as its `Host`, where `<port>` is the published `OPEN_AGENT_PORT`. The set is derived from the port and can't be configured any other way (`hostGuard` in `packages/core/src/local/hosts.ts`; `@oab/bff` checks the same set). Anything else answers 421 `misdirected`, which refuses DNS rebinding.
- **Origin and fetch metadata.** `@oab/bff` refuses a write (any unsafe method) unless `Origin` is `http://127.0.0.1:<port>` or `http://localhost:<port>`; a missing or `null` Origin is refused. It also refuses any `/api` request whose `Sec-Fetch-Site` is present and not `same-origin` or `none`. Both answer 403 `bad_origin` (`packages/bff/src/forward.ts`, `packages/bff/src/local.ts`). No response carries CORS (`Access-Control-Allow-*`) headers.
- **Agent secret.** The core has no listener of its own; the bff calls it in process with an agent secret that is generated in memory for each process and never written to a file. The core refuses a call without it.
- **Accepted residual risk: local callers.** In plain `docker compose` the browser holds no credential. Any process, and any other OS user account, on the same computer can call `127.0.0.1:<port>` directly with a forged `Host` and `Origin` and no `Sec-Fetch-Site`, and gets full API access to the local user's chats, reports and saved model keys (used, never shown). This matches other local developer tools and is stated in the README.
- **Launch-token hook.** When `OPEN_AGENT_LAUNCH_TOKEN` is set (64 lowercase hex), every `/api` request must carry the cookie `oa_launch=<token>`, compared in constant time, or it gets 401 `launch_required`; pages and assets stay public. The Mac app sets the token and the cookie (`HttpOnly`, `SameSite=Strict`) in its own window (see Mac app below). The hook is inactive by default. It keeps out other OS user accounts and processes that can't use Docker, but not same-user processes with Docker access, which can read the token with `docker inspect`. While it is set, a plain browser still loads the pages but every API call fails, so unset it to use a browser.
- **Credential key.** Saved model keys are sealed under a key file, `/keys/kek`, on its own volume (`open-agent-keys`) that only the agent mounts. Key files are created once, exclusively, with mode 0600, and never replaced on their own. On every start they are opened without following symlinks, and a symlink, a non-regular file, a file readable by group or others, a file owned by another user or malformed content is refused with `keyfile_invalid` (`packages/core/src/lib/secretFile.ts`). If `/keys/kek` is missing while the database holds saved keys, the agent refuses to start with `kek_missing` rather than create a new key over them. `OPEN_AGENT_RESET_CREDENTIALS=1` deletes those saved keys and creates a new key file; it acts only while the key file is missing (`packages/core/src/local/keyFiles.ts`).
- **Renderer secret.** The agent creates the renderer's shared secret as a 0600 file, `/run/open-agent/renderer/secret`, with the same checks. The renderer reads it through `RENDERER_SECRET_FILE` from a read-only volume, with the same checks, and holds no other secret.
- **Sibling containers.** `search` (SearXNG) and `renderer` share compose networks with the agent and could reach its port inside Docker with a forged `Host`. They are trusted: both run images this stack pins, neither runs user or model code outside Chromium's sandbox, and neither mounts the data or keys volume (the renderer mounts only its secret, read-only).
- **The agent's own tools.** `browse` and `fetch_page` refuse loopback, the agent port and `localhost:<port>` inside the container (`packages/core/test/local/toolGuards.test.ts`), so a page or a model can't steer the agent into its own API. The front does not also refuse `/api` by source address: rootless Docker and Podman can forward host traffic from a loopback address, and such a rule would lock those users out.

## Mac app

`Open Agent.app` (`apps/desktop`) is a thin Electron shell that runs the local stack above in the user's own Docker and shows its UI from `127.0.0.1`. The agent never runs inside Electron. The design is `docs/superpowers/specs/2026-11-03-m4-mac-shell-design.md`.

- **Launch token and cookie.** The shell creates a fresh 64-hex token for every recreate, passes it to compose as `OPEN_AGENT_LAUNCH_TOKEN`, keeps it in `stack.json` (0600, in a 0700 state dir) and installs it only as the host-only cookie `oa_launch` (`HttpOnly`, `SameSite=Strict`) for `http://127.0.0.1:<port>` in the app window's own session. The cookie is removed whenever the app view is hidden. `status.json` never holds it, and the shell log and saved logs replace it with `[token]`.
- **Docker discovery fails closed.** The `docker` CLI is used only from fixed locations, and only if the file, its symlink target and every parent folder are owned by root or the user and not writable by others (group-writable only for `admin`). The engine socket must be a `unix://` socket owned by the user; a remote or other-user engine gets its own screen and no compose call. CLI plugins are checked the same way before any docker call: `~/.docker/cli-plugins`, the `cliPluginsExtraDirs` in `~/.docker/config.json`, the system plugin folders, and every plugin path `docker info` reports. Each docker call gets an environment built from scratch (no `COMPOSE_*`, no `DOCKER_CONFIG`, a `PATH` of trusted folders only).
- **Loopback firewall and navigation lockdown.** The app window's session cancels every request to a loopback host except the current app origin, and all loopback while no stack is shown. Windows run sandboxed with context isolation and no Node. Navigation stays on the app origin; links to other sites open in the default browser through a validated, rate-limited opener. Report windows open only `/api/artifacts/<id>`, never follow a page's own navigation to another site, and may open at most 3 external links each. Every permission request (camera, geolocation, HID, USB, serial, Bluetooth, notifications, display capture and the rest) is denied except a sanitized clipboard write from the app origin, and downloads are saved only from the app origin.
- **Fuses and signing.** The packaged app flips the Electron fuses: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, the app loads only from its asar and the asar integrity is checked. It is ad-hoc signed without the hardened runtime (a hardened, ad-hoc-signed Electron fails to launch).
- **Export without keys.** Export runs `dataTools` in a throwaway container from the pinned agent image with no network, a read-only root, no capabilities and only the data volume mounted, never the keys volume. The zip may hold only `export.json`, the database snapshot and report files, and its database must have zero saved credentials, or the file is deleted.
- **Release builds.** `release.yml` builds the release images with no build cache on GitHub-hosted runners, attests them, and the app pulls them pinned by digest. The services lock baked into both DMGs, and the update manifest built from it, are written only from attested digests pushed in the same run, and a separate job checks that each DMG carries exactly that lock. The DMGs and the manifest are attested too, and releases are immutable once published: their assets and tag can't change.
- **Residual risks.**
  - Same-user processes with Docker access can read the token (`docker inspect`) or run anything in Docker; the token stops other OS users and processes without Docker access.
  - A service update has no rollback; a failed one shows its logs and Retry.
  - The app is unsigned (no Developer ID), so Gatekeeper asks the user to allow it ("Open Anyway"), and its bundle is protected only by file permissions.
  - The DMG check proves the pins, not the app's JavaScript: a compromised build dependency could still alter the app. The attestation proves where and from which commit it was built.
  - Test mode (`OPEN_AGENT_SHELL_TEST=1`) works in packaged builds; it is set from the launching environment, so only the same user can use it, and it only narrows what the app touches.
  - The bundled stack files in `Contents/Resources/stack` are outside the asar integrity check; the shell stages them with a SHA-256 check, so a change is detected.
  - AppKit writes the app's `NSUserDefaults` plist under `~/Library/Preferences` whatever the state directory; it holds no app state.

## Hosted service

Hosted service: see [cloud/SECURITY.md](cloud/SECURITY.md).
