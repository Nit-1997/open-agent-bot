# Releasing Open Agent

This is the owner's runbook. A `v*` tag on `main` runs `.github/workflows/release.yml` (`gate → push → merge → lock → desktop → verify-dmgs → attest → release`). One run builds and attests both images for `linux/amd64` and `linux/arm64`, writes the services lock from the digests it just pushed, builds both DMGs with that lock, checks them, and ends with a **draft** release holding exactly four files: `Open-Agent-<v>-arm64.dmg`, `Open-Agent-<v>-x64.dmg`, `open-agent-services.json` and `SHA256SUMS`. Nothing is public until you make the two GHCR packages public and publish the draft.

Homebrew tap: not built (deferred, spec A13).

## Prerequisites

On your Mac:

```bash
brew upgrade gh
gh --version
gh auth status
gh auth refresh -s read:packages
```

- `gh` must be current: the attestation checks below use `--signer-workflow`, `--source-ref` and `--deny-self-hosted-runners`. Current `gh` releases have all three; at Gate 5a, confirm with `gh attestation verify --help` that each one is listed before you rely on those lines. Write the version you used in the checklist.
- The factory checked the `gh run`, `gh release` and `gh api` commands below against gh 2.44.1 (the version on the factory Mac). It could not run the attestation checks for real: no attestation exists before the first release, so Gate 5a is the first real run of those lines.
- `gh auth status` must show you signed in with the `repo` and `read:packages` scopes; `gh auth refresh -s read:packages` adds the second.
- `jq`, Docker, and a clone of the repository with `origin` pointing at `Nit-1997/open-agent-bot`.

## Repository settings

Do these once, before the first tag. The labels are GitHub's.

The repository must be **public**. The `gate` job fetches the tag without credentials (`persist-credentials: false`), which only works on a public repository, and public repositories get the arm and macOS runners and attestations at no cost.

1. Settings → Actions → General → **Actions permissions**: "Allow Nit-1997, and select non-Nit-1997, actions and reusable workflows", with "Allow actions created by GitHub" checked and the pattern `docker/*` in "Allow specified actions and reusable workflows". The workflows use only `actions/*` and `docker/*`.
2. Same page → **Workflow permissions**: "Read repository contents and packages permissions" (each job asks for what it needs). Leave "Allow GitHub Actions to create and approve pull requests" unchecked.
3. Settings → Rules → Rulesets → **New tag ruleset**: name "release tags", enforcement "Active", target tags by the pattern `v*`, rules "Restrict creations", "Restrict updates" and "Restrict deletions", bypass list: you only (the Repository admin role). Only you can then create, move or delete a release tag.
   - **3a.** Settings → Rules → Rulesets → **New branch ruleset**: name "main", enforcement "Active", target the default branch, rules "Restrict deletions", "Block force pushes" and "Require a pull request before merging" with 1 approval and "Require review from Code Owners", bypass list: you only.
   - **3b.** `.github/CODEOWNERS` is already committed: it names you for `/.github/workflows/`, `/scripts/release/`, `/apps/desktop/release-policy.json` and itself, so no workflow or release-script change reaches `main` without your review.
4. Settings → Environments → **New environment** named `release`: "Required reviewers" = you, with "Prevent self-review" off so you can approve your own tag; "Deployment branches and tags" → "Selected branches and tags" → add a **tag** rule `v*`; no environment secrets. The four jobs that hold write scopes (`push`, `merge`, `attest`, `release`) use this environment, so a run can't touch GHCR, attestations or releases until you approve it.
5. Settings → General → Releases → "Enable release immutability". This is **required before `v1.0.0`**: once a release is published, its assets and tag can't change, and a bad release is fixed with a new patch version.
6. If either GHCR package (`open-agent`, `open-agent-search`) already exists from an earlier push, open its package settings → "Manage Actions access" → add `Nit-1997/open-agent-bot` with the role **Write**. Otherwise the first run creates both packages linked to the repository.
7. Check that the `ubuntu-24.04-arm` and `macos-15` runners are available to the repository (free on a public repository). The rc rehearsal proves it.

## Dry run

Before a tag you can run every workflow step that doesn't need GitHub on your Mac against a local registry (`OPEN_AGENT_SHELL_TEST=1 npm run release:dry-run -- --version 0.0.0-dryrun.1 --registry 127.0.0.1:18501 --builder oab-factory-m5-builder --out .factory/m5/release-dry-run/0.0.0-dryrun.1`; setup and teardown in CONTRIBUTING.md "Releases"). The dry-run DMG runs only in test mode, so it is **not** a Gate 4 candidate.

## Gate 4: dogfood a local build

Before anything is published to GHCR, build the DMG from the merged commit and use it yourself for a few days:

```bash
git clone https://github.com/Nit-1997/open-agent-bot && cd open-agent-bot && git checkout <merged M5 commit>
npm ci
npm run dist:local -w @oab/desktop
```

Open `apps/desktop/release/Open-Agent-0.0.0-dev-<arch>.dmg` and drag the app to Applications. A locally built file isn't quarantined, so there is no "Open Anyway". The title shows "Local build". This uses the real `open-agent` project and the real volumes `open-agent-data` and `open-agent-keys`.

## The version in the docs

The guides name one version. Before each final tag, merge a pull request to `main` that:

- sets `Version in this guide: <v>` in `docs/INSTALL.md` and the same version in every DMG name, `--branch v…` and `refs/tags/v…` in `README.md`, `docs/INSTALL.md` and `SECURITY.md`;
- puts the placeholders back in INSTALL section 9 with `node scripts/docs/fill-digests.mjs --reset` (the new digests exist only after the run);
- passes `node --test scripts/test/docCommands.test.mjs` (it fails on a mixed version, an unpinned `gh attestation verify` or a command missing from `scripts/docs/doc-commands.json`).

For an rc the guides keep the final version (`1.0.0`); read the rc version wherever they name a file or a tag.

## Watching a run

Set `TAG` first, then wait for the run of that tag and follow it:

```bash
until id=$(gh run list --workflow release.yml --event push --branch "$TAG" --limit 1 --json databaseId -q '.[0].databaseId') && [ -n "$id" ]; do sleep 5; done
gh run watch --exit-status "$id"
```

**There are four approvals per run**, one per write job, each when that job starts: `push` (both matrix legs at once), `merge`, `attest` and `release`. Approve each on the run page: "Review deployments" → `release` → "Approve and deploy". A waiting run shows "Waiting for review" on its page, and this prints `release` while a job waits:

```bash
gh api "repos/Nit-1997/open-agent-bot/actions/runs/$id/pending_deployments" --jq '.[].environment.name'
```

**Transient failures** (a lost runner, the network, a GHCR 5xx): rerun the failed jobs of the same run with `gh run rerun "$id" --failed` and approve again. This is safe for any job while no release exists for the tag: a rerun of `push` or `merge` pushes new digests and the lock is rebuilt from them; the old per-arch digests stay unreferenced. If `release` failed **after** it created the draft, delete that draft and keep the tag (`gh release delete "$TAG" --yes`), then rerun the same run with `--failed`. That is a retry of one run, not a re-push; re-pushing a tag is covered under Rollback.

## Gate 5a: rehearsal (`v1.0.0-rc.1`)

1. Tag `main` and push the tag:

   ```bash
   TAG=v1.0.0-rc.1; git fetch origin && git tag -a "$TAG" -m "Open Agent 1.0.0-rc.1" origin/main && git push origin "$TAG"
   ```

2. Watch and approve (above). In the `desktop` job log both apps print `kind=release version=1.0.0-rc.1`, and `verify-dmgs` is green.
3. `gh release view "$TAG"` shows Draft, Pre-release and four assets. Draft assets download only when you are signed in: use `gh release download`, or a browser signed in to GitHub as you.
4. Run `gh attestation verify --help` and check that it lists `--signer-workflow`, `--source-ref` and `--deny-self-hosted-runners`. Then download and verify the checksums and the attestations:

   ```bash
   mkdir -p /tmp/oa-rc1 && gh release download "$TAG" -D /tmp/oa-rc1 && (cd /tmp/oa-rc1 && shasum -a 256 -c SHA256SUMS && for f in Open-Agent-*.dmg open-agent-services.json; do gh attestation verify "$f" --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref "refs/tags/$TAG" --deny-self-hosted-runners; done)
   ```

5. Make both packages public: github.com/users/Nit-1997/packages/container/open-agent/settings → "Change visibility" → Public, and the same for `open-agent-search`. This is only possible in the web UI; until then an installed app can't download its services.
6. Check that the images pull anonymously and verify one by digest:

   ```bash
   docker logout ghcr.io; docker pull "$(jq -r .images.agent /tmp/oa-rc1/open-agent-services.json)"
   docker pull "$(jq -r .images.search /tmp/oa-rc1/open-agent-services.json)"
   gh attestation verify "oci://$(jq -r .images.agent /tmp/oa-rc1/open-agent-services.json)" --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref "refs/tags/$TAG" --deny-self-hosted-runners
   ```

7. Install the rc DMG the way a user would: download it in a browser signed in to GitHub, so it is quarantined, then follow `docs/INSTALL.md` word by word, including "Open Anyway". This uses the real `open-agent` project and volumes, like Gate 4.
8. Leave the rc as an unpublished draft, or delete it (Rollback).

## Gate 5b: first public release (`v1.0.0`, irreversible)

1. Check that release immutability is on (setting 5).
2. Tag the commit that passed 5a and push the tag:

   ```bash
   TAG=v1.0.0; git tag -a "$TAG" -m "Open Agent 1.0.0" <the commit that passed 5a> && git push origin "$TAG"
   ```

3. Watch and approve; `gh release view "$TAG"`; edit the notes on the draft (on the release page, or `gh release edit "$TAG" --notes-file <file>`).
4. **Immediately before publishing**, download and verify again:

   ```bash
   rm -rf /tmp/oa-100 && mkdir /tmp/oa-100 && gh release download "$TAG" -D /tmp/oa-100 && (cd /tmp/oa-100 && shasum -a 256 -c SHA256SUMS && for f in Open-Agent-*.dmg open-agent-services.json; do gh attestation verify "$f" --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/.github/workflows/release.yml --source-ref "refs/tags/$TAG" --deny-self-hosted-runners; done)
   ```

5. Publish:

   ```bash
   gh release edit "$TAG" --draft=false --latest
   ```

6. Check: this prints `v1.0.0`, and an installed rc app's "Check for updates…" shows "Open Agent 1.0.0 is available…":

   ```bash
   curl -s https://api.github.com/repos/Nit-1997/open-agent-bot/releases/latest | jq -r .tag_name
   ```

7. Put the release's digests into INSTALL section 9 (until now it shows `<agent-digest>` and `<search-digest>`). `fill-digests.mjs` refuses a manifest for another version or refs that aren't `ghcr.io/nit-1997/…@sha256:`, and updates `scripts/docs/doc-commands.json` with the guide:

   ```bash
   git fetch origin && git switch -c docs/release-digests-1.0.0 origin/main
   node scripts/docs/fill-digests.mjs --manifest /tmp/oa-100/open-agent-services.json
   node --test scripts/test/docCommands.test.mjs
   git commit -am "docs: release digests for 1.0.0 in the install guide" && git push -u origin docs/release-digests-1.0.0
   ```

   Open the pull request and merge it. The app's "Install guide" opens `docs/INSTALL.md` on `main`.

## Checklist

- [ ] `brew upgrade gh` done; `gh --version` used: ______; `gh auth status` shows `repo` and `read:packages`
- [ ] Repository public; settings 1–7 done, including 3a (`main` ruleset) and 3b (CODEOWNERS)
- [ ] Release immutability on
- [ ] `Version in this guide` in INSTALL.md equals the tag, and `node --test scripts/test/docCommands.test.mjs` passes on `main`
- [ ] Tag on `main`, annotated, pushed by you
- [ ] Four environment approvals given; workflow green
- [ ] `kind=release version=1.0.0` in the `desktop` log for both apps, and `verify-dmgs` green
- [ ] The draft has exactly four assets
- [ ] `SHA256SUMS` and the attestations verify, and again in Gate 5b step 4 just before publishing
- [ ] Both packages public and pullable anonymously
- [ ] Notes edited
- [ ] Published as latest; `releases/latest` prints the tag
- [ ] Release digests filled into INSTALL section 9 and merged

## Rollback

**The tag rule.** An rc tag is never pushed twice: after a fix, the next rehearsal uses the next rc number (`v1.0.0-rc.1` → `v1.0.0-rc.2`). A final tag such as `v1.0.0` may be pushed again on the fixed commit only while no release (draft or published) was ever created for it; once any draft existed for it, the fix ships as the next patch, `v1.0.1`.

- **The workflow failed and no release exists for the tag.** First try `gh run rerun "$id" --failed`. If the code needs a fix, delete the tag (the ruleset lets only you do it), merge the fix to `main`, and tag again by the tag rule:

  ```bash
  git push origin :refs/tags/$TAG && git tag -d "$TAG"
  ```

  Nothing public references a tag without a release, and for a final tag the GHCR `:<version>` tag moves to the new index.
- **A bad draft.** Delete the draft and its tag, merge the fix to `main`, and tag by the tag rule (a draft existed, so a final becomes `v1.0.1`):

  ```bash
  gh release delete "$TAG" --yes --cleanup-tag
  ```

- **A bad published release.** Don't delete it or its images: installed apps pin those digests, and with immutability the tag name can't be reused anyway. Ship `v1.0.1`. If only the services are bad and the app is fine, `v1.0.1`'s manifest reaches installed apps through "Update services".
- **Image retention.** Delete a package version only for rc or abandoned tags:

  ```bash
  gh auth refresh -s read:packages,delete:packages
  gh api /user/packages/container/open-agent/versions --jq '.[] | [.id, (.metadata.container.tags | join(","))] | @tsv'
  gh api -X DELETE /user/packages/container/open-agent/versions/<id>
  ```

  Never delete untagged versions: the per-arch manifests and the attestations of every index are untagged, and deleting them breaks the index a release pins. Keep every digest named by any published release forever.
