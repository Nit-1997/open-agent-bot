# Install Open Agent

Version in this guide: 1.0.0

Open Agent is a research and planning agent that runs on your computer. This guide installs the Mac app. To run it in a browser on any computer with Docker, go to [section 9](#9-no-mac-app-any-os-with-docker).

Text in quotes is what you see on screen. The wording macOS and Docker use may differ slightly between versions.

## 1. What you need

- A Mac with macOS 13 (Ventura) or later.
- About 3 GB of free disk space. The first start downloads about 2 GB.
- One Docker engine. Open Agent runs its services in Docker. Pick one of the three below.

### Docker Desktop

Docker Desktop is free for personal use, education, open source projects and small businesses. Larger companies need a paid plan: see [Docker's pricing page](https://www.docker.com/pricing/).

1. Download Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop/) and drag it to Applications.
2. Open Docker Desktop once from Applications.
3. Accept the terms.
4. Skip or finish the sign-in. You don't need a Docker account.
5. Wait until Docker Desktop shows "Engine running".

### OrbStack

OrbStack is free for personal use. Download it from [orbstack.dev](https://orbstack.dev/), open it once and wait until it says it's running.

### Colima

Colima is free and open source. You install it with [Homebrew](https://brew.sh/). In Terminal:

```bash
brew install colima docker docker-compose
colima start
```

**Advanced (Colima only):** Docker Compose must be a Docker CLI plugin. Add this to `~/.docker/config.json` (create the file if it doesn't exist):

```json
{
  "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]
}
```

If the file already has settings, add only the `"cliPluginsExtraDirs"` line inside its outer braces. Without it, Open Agent shows "Docker Compose is too old".

## 2. Download

1. Open the [latest release](https://github.com/Nit-1997/open-agent-bot/releases/latest).
2. Pick the file for your Mac. To check which Mac you have, open the Apple menu → "About This Mac" and look at "Chip" (older Macs say "Processor"):
   - "Apple M1" or later (Apple silicon): `Open-Agent-1.0.0-arm64.dmg`
   - "Intel": `Open-Agent-1.0.0-x64.dmg`

### Check the download (optional)

Download `SHA256SUMS` from the same release into the same folder (usually Downloads). Then in Terminal:

```bash
cd ~/Downloads
shasum -a 256 -c SHA256SUMS --ignore-missing
```

You should see `Open-Agent-1.0.0-arm64.dmg: OK` (or the `-x64` name). This only catches a broken or incomplete download. `SHA256SUMS` sits next to the files it lists, so it doesn't prove who made them.

To check that the file really was built by this project's release workflow, use the GitHub CLI (`gh`). The commands below install it with [Homebrew](https://brew.sh/), so you need Homebrew first. Install or upgrade `gh` to the current version, then sign in:

```bash
brew install gh
brew upgrade gh
gh auth login
gh auth status
```

Then, in the folder with the download:

```bash
gh attestation verify Open-Agent-1.0.0-arm64.dmg --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners
```

For the Intel file, use `Open-Agent-1.0.0-x64.dmg` instead. The check ends with "Verification succeeded!". Any other result means: don't open the file.

## 3. Install

1. Open the DMG.
2. Drag "Open Agent" to the "Applications" folder.

If you open the app from somewhere else, it shows "Open Agent works best from your Applications folder" and offers "Move to Applications".

## 4. First open ("Open Anyway")

The app is not signed with an Apple Developer ID, so macOS blocks the first open. You only do this once. To check what you downloaded, see [section 2](#check-the-download-optional).

**macOS 15 or later:**

1. Double-click "Open Agent" in Applications. macOS says it could not verify that "Open Agent" is free of malware. Click "Done".
2. Open System Settings → Privacy & Security.
3. Scroll down to the message "Open Agent was blocked…" and click "Open Anyway".
4. Enter your password (or use Touch ID).
5. Click "Open Anyway" again in the dialog.

**macOS 13 or 14:**

1. In Finder, open Applications.
2. Control-click (or right-click) "Open Agent" and choose "Open".
3. Click "Open" in the dialog.

If that dialog only offers "Move to Trash", click "Done" and use System Settings → Privacy & Security → "Open Anyway" as for macOS 15.

**Or in Terminal (any macOS version):**

```bash
xattr -dr com.apple.quarantine "/Applications/Open Agent.app"
```

To check, this no longer lists `com.apple.quarantine`:

```bash
xattr -l "/Applications/Open Agent.app"
```

## 5. What happens next

1. The app shows "Getting your agent ready" with three steps:
   - "Docker": the app checks your Docker engine.
   - "Downloading services": the app downloads its services (about 2 GB, only the first time).
   - "Starting": the services start on your Mac.
2. Then you choose a model. Add an API key from a model provider, or use a model that runs on this Mac with Ollama or LM Studio.
3. Then you can chat.

If the app shows "Docker isn't running", start Docker Desktop, OrbStack or Colima. The app continues by itself once Docker is running.

## 6. Updates

The app checks GitHub for a new version once a day. To turn this off, open Open Agent → "Services & data…" and turn off "Check for new versions". To check now, use Open Agent → "Check for updates…".

- **A new app:** the Open Agent menu shows "Open Agent 1.0.1 is available…" (with the new version number). Click it, then "Download". Download the new DMG, open it and drag "Open Agent" to Applications again. Choose "Replace" when asked. Your chats stay.
- **New services only:** "Services & data…" shows "Update services (1.0.1 available)" (with the new version number). Click it to download the new service images. You don't need a new app for this.

## 7. Where things are

- Chats, reports and your profile: the Docker volume `open-agent-data`.
- Saved model keys (encrypted): the Docker volume `open-agent-keys`.
- App settings: `~/Library/Application Support/Open Agent`.
- Logs: `~/Library/Logs/Open Agent`. Or open "Services & data…" → "View logs" → "Save logs…".

## 8. Remove everything

1. Open "Services & data…" → "Delete all data…". Type `delete` and click "Delete all data". This removes your chats, reports and saved keys.
2. Quit Open Agent.
3. Drag "Open Agent" from Applications to the Trash.
4. Remove the app's settings and logs. In Terminal:

```bash
rm -rf ~/Library/Application\ Support/Open\ Agent ~/Library/Logs/Open\ Agent
```

5. Optional: remove the service images. List them with:

```bash
docker image ls -a --digests 'ghcr.io/nit-1997/*'
```

Then remove each one with `docker image rm` and its IMAGE ID from the list.

## 9. No Mac app (any OS with Docker)

You can run Open Agent in your browser on any computer with Docker and Git. You need Docker Compose 2.24 or later.

**Build it from source:**

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/Nit-1997/open-agent-bot
cd open-agent-bot
docker compose up -d --build
```

The first build takes a few minutes. Then open http://127.0.0.1:3000 in your browser. On a Mac, this opens it:

```bash
open http://127.0.0.1:3000
```

To check that it's running:

```bash
curl -fsS http://127.0.0.1:3000/health
docker compose ps
```

**Prebuilt images instead of building:** take the two image references from the release's `open-agent-services.json` (`images.agent` and `images.search`). The release notes print them too. Always use these `@sha256:` references, never a tag. In the `open-agent-bot` folder, put them in a `.env` file. The line below names the images of version 1.0.0; if it still shows `<agent-digest>` and `<search-digest>`, replace them with the digests from the release:

```bash
printf 'OPEN_AGENT_IMAGE=ghcr.io/nit-1997/open-agent@sha256:<agent-digest>\nOPEN_AGENT_SEARCH_IMAGE=ghcr.io/nit-1997/open-agent-search@sha256:<search-digest>\n' > .env
docker compose pull agent search
docker compose up -d --no-build
```

Optional: check an image before you use it, the same way as the download in section 2:

```bash
gh attestation verify oci://ghcr.io/nit-1997/open-agent@sha256:<agent-digest> --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref refs/tags/v1.0.0 --deny-self-hosted-runners
```

**Update** to a new version (replace `1.0.1` with the new version number):

```bash
git fetch --tags
git checkout v1.0.1
```

Then run the same `docker compose up` line as before. With prebuilt images, first put the new version's two references in `.env`.

**Stop** (keeps your data):

```bash
docker compose down
```

**Delete everything** (chats, reports and saved keys):

Warning: the Mac app uses the same Docker volumes, so this also deletes the Mac app's chats, reports and saved keys on this computer.

```bash
docker compose down -v
```

Don't run the Mac app and this at the same time on the same computer: they use the same data volumes. The app then shows "Open Agent's services were started elsewhere" and offers "Use the app's services".

## 10. Security

Everything stays on your computer. The services listen on 127.0.0.1 only, so other computers can't reach them. There is no account and no telemetry. Other programs that run as you can still call the local API, and in the browser-only path so can other user accounts on the same computer. The Mac app protects its services with a launch key that only the app knows, which keeps other accounts out. Details: [SECURITY.md](../SECURITY.md).

## 11. Troubleshooting

- **"Open Agent needs Docker":** install one of the engines in section 1, then click "Retry".
- **"Docker isn't running":** start your Docker engine. With Colima, run `colima start` in Terminal. The app continues by itself.
- **"Open Agent only runs its services on a Docker engine on this Mac that belongs to you":** switch to a local Docker context (`docker context use desktop-linux`, `orbstack` or `colima`), then click "Retry".
- **"Docker Compose is too old":** update Docker Desktop or OrbStack. With Colima, run `brew upgrade docker-compose` and check the advanced note in section 1.
- **"Port … is taken":** another program uses the port. Click "Pick another port". In the browser-only path, add a line `OPEN_AGENT_PORT=3001` to `.env` and open http://127.0.0.1:3001 instead.
- **"Docker's disk is full" or "Not enough free space on this Mac":** free some space. In Docker Desktop you can also raise the disk limit in its settings under Resources.
- **The app says it couldn't start its services, for example "Your database is damaged":** the [startup errors table](../README.md#startup-errors) explains each one.
- **No "Open Anyway" button in Privacy & Security:** double-click the app in Applications once first, then look again.
- **An Intel Mac won't open the app:** you downloaded the Apple silicon file. Download `Open-Agent-1.0.0-x64.dmg` instead.
