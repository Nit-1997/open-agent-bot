import { afterEach, describe, expect, it } from "vitest";
import type { ServicePins } from "../src/main/services.ts";
import {
  ASSET_PREFIX,
  CHECK_INTERVAL_MS,
  checkForUpdates,
  compareSemver,
  type FetchLike,
  incompatibleText,
  MANIFEST_ASSET,
  MAX_MANIFEST_BYTES,
  MAX_RELEASE_BYTES,
  RELEASE_API_URL,
  RELEASE_LIST_URL,
  shouldAutoCheck,
} from "../src/main/updateCheck.ts";
import { LATEST_PATH, type MockReleases, startMockReleases } from "./support/mockReleases.ts";

const SHA = "c".repeat(64);
const AGENT = `ghcr.io/nit-1997/open-agent@sha256:${"1".repeat(64)}`;
const SEARCH = `ghcr.io/nit-1997/open-agent-search@sha256:${"2".repeat(64)}`;
const NEW_AGENT = `ghcr.io/nit-1997/open-agent@sha256:${"3".repeat(64)}`;
const NEW_SEARCH = `ghcr.io/nit-1997/open-agent-search@sha256:${"4".repeat(64)}`;
const PAGE = "https://github.com/Nit-1997/open-agent-bot/releases/tag/v1.5.0";
const ASSET = `${ASSET_PREFIX}v1.5.0/${MANIFEST_ASSET}`;

const current: ServicePins = {
  kind: "release",
  version: "1.4.0",
  composeSha256: SHA,
  images: { agent: AGENT, search: SEARCH },
  pull: true,
};

const manifest = (o: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "release",
  version: "1.5.0",
  composeSha256: SHA,
  images: { agent: NEW_AGENT, search: NEW_SEARCH },
  minShellVersion: "1.0.0",
  ...o,
});

const release = (o: Record<string, unknown> = {}) => ({
  tag_name: "v1.5.0",
  html_url: PAGE,
  draft: false,
  prerelease: false,
  assets: [{ name: MANIFEST_ASSET, browser_download_url: ASSET }],
  ...o,
});

type Route = Response | (() => Response | Promise<Response>) | Error;
type Call = { url: string; init: RequestInit };

function fakeFetch(routes: Record<string, Route>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (r === undefined) throw new TypeError("fetch failed");
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  };
  return { fetch, calls };
}

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

const run = (routes: Record<string, Route>, o: Partial<Parameters<typeof checkForUpdates>[0]> = {}) => {
  const f = fakeFetch(routes);
  return checkForUpdates({
    fetch: f.fetch,
    url: RELEASE_API_URL,
    shellVersion: "1.4.0",
    services: current,
    composeSha256: SHA,
    test: false,
    ...o,
  }).then((result) => ({ result, calls: f.calls }));
};

describe("compareSemver", () => {
  it.each([
    ["1.10.0", "1.9.9", 1],
    ["1.9.9", "1.10.0", -1],
    ["2.0.0", "2.0.0", 0],
    ["0.0.0-dev", "0.0.1", -1],
    ["0.0.1", "0.0.0-dev", 1],
    ["1.0.0-rc1", "1.0.0", -1],
  ] as const)("%s vs %s → %d", (a, b, r) => {
    expect(compareSemver(a, b)).toBe(r);
  });
});

describe("checkForUpdates: the release", () => {
  it("sends one GET with the GitHub headers, no credentials and manual redirects", async () => {
    const { result, calls } = await run({ [RELEASE_API_URL]: ok(release({ assets: [] })) });
    expect(result).toEqual({ ok: true, shell: { version: "1.5.0", pageUrl: PAGE } });
    expect(calls).toHaveLength(1);
    const init = calls[0]!.init;
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("user-agent")).toBe("OpenAgent/1.4.0");
    expect([...headers.keys()].sort()).toEqual(["accept", "user-agent"]);
  });

  it("reports nothing when the release is not newer than the app", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release({ tag_name: "v1.4.0", assets: [] })) });
    expect(result).toEqual({ ok: true });
  });

  it("treats a prerelease app version as older than the release", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release({ tag_name: "v0.0.1", assets: [] })) }, { shellVersion: "0.0.0-dev" });
    expect(result).toMatchObject({ ok: true, shell: { version: "0.0.1" } });
  });

  it.each(["1.2.3", "v1.2", "v1.2.3-rc1", "v01.2.3x", "", 5])("refuses the tag %j", async (tag) => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release({ tag_name: tag })) });
    expect(result).toEqual({ ok: false, reason: "bad_tag" });
  });

  it("refuses a draft or prerelease marked latest", async () => {
    expect((await run({ [RELEASE_API_URL]: ok(release({ draft: true })) })).result).toEqual({ ok: false, reason: "not_final" });
    expect((await run({ [RELEASE_API_URL]: ok(release({ prerelease: true })) })).result).toEqual({ ok: false, reason: "not_final" });
  });

  it.each([
    "https://evil.example/Nit-1997/open-agent-bot/releases/tag/v1.5.0",
    "https://github.com/Nit-1997/open-agent-bot-evil/releases/tag/v1.5.0",
    "http://github.com/Nit-1997/open-agent-bot/releases/tag/v1.5.0",
    "javascript:alert(1)",
    42,
  ])("falls back to the fixed release list for html_url %j", async (html) => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release({ html_url: html, assets: [] })) });
    expect(result).toEqual({ ok: true, shell: { version: "1.5.0", pageUrl: RELEASE_LIST_URL } });
  });

  it("maps 403 and 429 to rate_limited and other statuses to http_<code>", async () => {
    expect((await run({ [RELEASE_API_URL]: new Response("{}", { status: 403 }) })).result).toEqual({ ok: false, reason: "rate_limited" });
    expect((await run({ [RELEASE_API_URL]: new Response("{}", { status: 429 }) })).result).toEqual({ ok: false, reason: "rate_limited" });
    expect((await run({ [RELEASE_API_URL]: new Response("{}", { status: 404 }) })).result).toEqual({ ok: false, reason: "http_404" });
  });

  it("maps a network failure to offline and bad JSON to bad_json", async () => {
    expect((await run({})).result).toEqual({ ok: false, reason: "offline", detail: "TypeError: fetch failed" });
    expect((await run({ [RELEASE_API_URL]: ok("{not json") })).result).toEqual({ ok: false, reason: "bad_json" });
    expect((await run({ [RELEASE_API_URL]: ok([1, 2]) })).result).toEqual({ ok: false, reason: "bad_json" });
  });

  it("refuses a release body over 1 MiB, by header or by streamed size", async () => {
    const big = "x".repeat(MAX_RELEASE_BYTES + 1);
    expect((await run({ [RELEASE_API_URL]: ok(big) })).result).toEqual({ ok: false, reason: "too_large" });
    const lying = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(big));
            c.close();
          },
        }),
        { status: 200, headers: { "content-length": "10" } },
      );
    expect((await run({ [RELEASE_API_URL]: lying })).result).toEqual({ ok: false, reason: "too_large" });
    const declared = new Response("{}", { status: 200, headers: { "content-length": String(MAX_RELEASE_BYTES + 1) } });
    expect((await run({ [RELEASE_API_URL]: declared })).result).toEqual({ ok: false, reason: "too_large" });
  });

  it("gives up after the timeout and passes an abort signal", async () => {
    let signal: AbortSignal | undefined;
    const hang: FetchLike = (_url, init) =>
      new Promise((_res, rej) => {
        signal = init.signal ?? undefined;
        init.signal?.addEventListener("abort", () => rej(init.signal?.reason));
      });
    const t0 = Date.now();
    const result = await checkForUpdates({
      fetch: hang,
      url: RELEASE_API_URL,
      shellVersion: "1.4.0",
      services: current,
      composeSha256: SHA,
      test: false,
      timeoutMs: 150,
    });
    expect(result).toEqual({ ok: false, reason: "timeout", detail: expect.stringMatching(/^TimeoutError/) });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(signal?.aborted).toBe(true);
  });

  it("uses a 5 s timeout by default", async () => {
    const mod = await import("../src/main/updateCheck.ts");
    expect(mod.TIMEOUT_MS).toBe(5000);
    expect(MAX_RELEASE_BYTES).toBe(1024 * 1024);
    expect(MAX_MANIFEST_BYTES).toBe(64 * 1024);
  });
});

describe("checkForUpdates: redirects are manual", () => {
  const hop = (n: number) => `https://objects.githubusercontent.com/hop${n}`;

  it("follows an allowed chain of 3 hops", async () => {
    const { result, calls } = await run({
      [RELEASE_API_URL]: redirect(hop(1)),
      [hop(1)]: redirect(hop(2), 301),
      [hop(2)]: redirect("https://release-assets.githubusercontent.com/final", 307),
      "https://release-assets.githubusercontent.com/final": ok(release({ assets: [] })),
    });
    expect(result).toMatchObject({ ok: true, shell: { version: "1.5.0" } });
    expect(calls.map((c) => c.init.redirect)).toEqual(["manual", "manual", "manual", "manual"]);
  });

  it("refuses a 4th hop", async () => {
    const { result, calls } = await run({
      [RELEASE_API_URL]: redirect(hop(1)),
      [hop(1)]: redirect(hop(2)),
      [hop(2)]: redirect(hop(3)),
      [hop(3)]: redirect(hop(4)),
      [hop(4)]: ok(release()),
    });
    expect(result).toEqual({ ok: false, reason: "redirect_refused" });
    expect(calls.map((c) => c.url)).not.toContain(hop(4));
  });

  it.each([
    "http://objects.githubusercontent.com/x",
    "https://evil.example/x",
    "https://github.com.evil.example/x",
    "https://user:pw@github.com/x",
    "https://github.com:8443/x",
    "file:///etc/hosts",
  ])("refuses a redirect to %s without requesting it", async (to) => {
    const { result, calls } = await run({ [RELEASE_API_URL]: redirect(to), [to]: ok(release()) });
    expect(result).toEqual({ ok: false, reason: "redirect_refused" });
    expect(calls).toHaveLength(1);
  });

  it("resolves a relative Location against the current URL and refuses a missing one", async () => {
    const rel = await run({
      [RELEASE_API_URL]: redirect("/repos/Nit-1997/open-agent/releases/latest"),
      "https://api.github.com/repos/Nit-1997/open-agent/releases/latest": ok(release({ assets: [] })),
    });
    expect(rel.result).toMatchObject({ ok: true, shell: { version: "1.5.0" } });
    const none = await run({ [RELEASE_API_URL]: new Response(null, { status: 302 }) });
    expect(none.result).toEqual({ ok: false, reason: "redirect_refused" });
  });

  it("treats a browser-style opaque redirect as refused", async () => {
    const fetch: FetchLike = async () => {
      const r = new Response(null, { status: 200 });
      Object.defineProperty(r, "type", { value: "opaqueredirect" });
      Object.defineProperty(r, "status", { value: 0 });
      return r;
    };
    const result = await checkForUpdates({
      fetch,
      url: RELEASE_API_URL,
      shellVersion: "1.4.0",
      services: current,
      composeSha256: SHA,
      test: false,
    });
    expect(result).toEqual({ ok: false, reason: "redirect_refused" });
  });
});

describe("checkForUpdates: the services manifest", () => {
  it("offers a newer, compatible manifest", async () => {
    const { result, calls } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok(manifest()) });
    expect(result).toEqual({
      ok: true,
      shell: { version: "1.5.0", pageUrl: PAGE },
      services: {
        kind: "release",
        version: "1.5.0",
        composeSha256: SHA,
        images: { agent: NEW_AGENT, search: NEW_SEARCH },
        pull: true,
        minShellVersion: "1.0.0",
      },
    });
    expect(calls.map((c) => c.url)).toEqual([RELEASE_API_URL, ASSET]);
    expect(calls[1]!.init.redirect).toBe("manual");
  });

  it("ignores assets with other names and makes no second request", async () => {
    const { result, calls } = await run({
      [RELEASE_API_URL]: ok(
        release({
          assets: [
            { name: "open-agent-services.json.sig", browser_download_url: ASSET },
            { name: "Open-Agent-1.5.0-arm64.dmg", browser_download_url: ASSET },
          ],
        }),
      ),
    });
    expect(result).toEqual({ ok: true, shell: { version: "1.5.0", pageUrl: PAGE } });
    expect(calls).toHaveLength(1);
  });

  it.each([
    "https://github.com/Nit-1997/open-agent-bot/releases/tag/v1.5.0/open-agent-services.json",
    "https://github.com/Other/open-agent-bot/releases/download/v1.5.0/open-agent-services.json",
    "https://objects.githubusercontent.com/open-agent-services.json",
    "http://github.com/Nit-1997/open-agent-bot/releases/download/v1.5.0/open-agent-services.json",
  ])("refuses an asset URL outside the release downloads: %s", async (url) => {
    const { result, calls } = await run({
      [RELEASE_API_URL]: ok(release({ assets: [{ name: MANIFEST_ASSET, browser_download_url: url }] })),
      [url]: ok(manifest()),
    });
    expect(result).toMatchObject({ ok: true, incompatible: "asset_url" });
    expect(result).not.toHaveProperty("services");
    expect(calls).toHaveLength(1);
  });

  it("follows the asset download redirect to the GitHub object host", async () => {
    const obj = "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc";
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: redirect(obj), [obj]: ok(manifest()) });
    expect(result).toMatchObject({ ok: true, services: { version: "1.5.0" } });
  });

  it("refuses an asset redirect to another host", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: redirect("https://evil.example/m.json") });
    expect(result).toMatchObject({ ok: true, incompatible: "manifest_redirect_refused" });
  });

  it("refuses a manifest over 64 KiB", async () => {
    const big = JSON.stringify({ ...manifest(), pad: "x".repeat(MAX_MANIFEST_BYTES) });
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok(big) });
    expect(result).toMatchObject({ ok: true, incompatible: "manifest_too_large" });
  });

  it("refuses a manifest whose version differs from the tag", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok(manifest({ version: "1.5.1" })) });
    expect(result).toMatchObject({ ok: true, incompatible: "manifest_tag_mismatch" });
    expect(result).not.toHaveProperty("services");
  });

  it.each([
    ["compose_mismatch", { composeSha256: "d".repeat(64) }],
    ["shell_too_old", { minShellVersion: "9.0.0" }],
    ["min_shell_version", { minShellVersion: undefined }],
    ["release_refs", { images: { agent: "ghcr.io/nit-1997/open-agent:1.5.0", search: NEW_SEARCH } }],
    ["release_refs", { images: { agent: `ghcr.io/evil/open-agent@sha256:${"3".repeat(64)}`, search: NEW_SEARCH } }],
    ["release_refs", { images: { agent: `ghcr.io/nit-1997/open-agent@sha256:${"A".repeat(64)}`, search: NEW_SEARCH } }],
    ["manifest_kind", { kind: "local", images: { agent: "open-agent:local", search: "open-agent-search:local" } }],
    ["dev_outside_test", { kind: "dev" }],
    ["no_pins", { images: null }],
    ["schema", { schema: 2 }],
  ])("refuses an incompatible manifest: %s", async (reason, patch) => {
    const m = manifest(patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (m as Record<string, unknown>)[k];
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok(m) });
    expect(result).toMatchObject({ ok: true, incompatible: reason });
    expect(result).not.toHaveProperty("services");
  });

  it("never offers a downgrade or the same version", async () => {
    for (const version of ["1.4.0", "1.3.9"]) {
      const { result } = await run(
        {
          [RELEASE_API_URL]: ok(release({ tag_name: `v${version}` })),
          [`${ASSET_PREFIX}v${version}/${MANIFEST_ASSET}`]: ok(manifest({ version })),
        },
        {},
      );
      expect(result).toEqual({ ok: true });
    }
  });

  it("never replaces a local build's lock, and makes no manifest request for it", async () => {
    const local: ServicePins = {
      ...current,
      kind: "local",
      images: { agent: "open-agent:local", search: "open-agent-search:local" },
      pull: false,
    };
    const { result, calls } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok(manifest()) }, { services: local });
    expect(result).toEqual({ ok: true, shell: { version: "1.5.0", pageUrl: PAGE } });
    expect(calls).toHaveLength(1);
  });

  it("maps a manifest that is not JSON to manifest_bad_json", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release()), [ASSET]: ok("<html>") });
    expect(result).toMatchObject({ ok: true, incompatible: "manifest_bad_json" });
  });
});

describe("incompatibleText", () => {
  it.each([
    ["compose_mismatch", "Service update not compatible: it needs a different compose file; update Open Agent first (compose_mismatch)"],
    ["shell_too_old", "Service update not compatible: it needs a newer Open Agent (shell_too_old)"],
    ["manifest_tag_mismatch", "Service update not compatible: its version doesn't match the release (manifest_tag_mismatch)"],
    ["release_refs", "Service update not compatible: its images are not from Open Agent's registry (release_refs)"],
    ["something_new", "Service update not compatible: something_new"],
  ])("%s", (reason, text) => {
    expect(incompatibleText(reason)).toBe(text);
  });
});

describe("shouldAutoCheck (24 h throttle)", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  it("checks when enabled and never checked", () => {
    expect(shouldAutoCheck({ checkForUpdates: true }, now)).toBe(true);
  });
  it("skips within 24 h and checks after", () => {
    expect(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: new Date(now - CHECK_INTERVAL_MS + 1000).toISOString() }, now)).toBe(
      false,
    );
    expect(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: new Date(now - CHECK_INTERVAL_MS - 1000).toISOString() }, now)).toBe(
      true,
    );
  });
  it("checks again when the stored time is in the future or unreadable", () => {
    expect(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: new Date(now + 3_600_000).toISOString() }, now)).toBe(true);
    expect(shouldAutoCheck({ checkForUpdates: true, lastUpdateCheck: "yesterday" }, now)).toBe(true);
  });
  it("never checks when disabled", () => {
    expect(shouldAutoCheck({ checkForUpdates: false }, now)).toBe(false);
  });
  it("is 24 hours", () => {
    expect(CHECK_INTERVAL_MS).toBe(24 * 3600 * 1000);
  });
});

describe("test-mode URL rules", () => {
  let mock: MockReleases | undefined;
  afterEach(async () => {
    await mock?.stop();
    mock = undefined;
  });

  const dev = (version: string, digit: string) => ({
    schema: 1,
    kind: "dev",
    version,
    composeSha256: SHA,
    images: {
      agent: `127.0.0.1:18477/oab-m4-agent@sha256:${digit.repeat(64)}`,
      search: `127.0.0.1:18477/oab-m4-search@sha256:${digit.repeat(64)}`,
    },
    pull: true,
    minShellVersion: "0.0.0-dev",
  });
  const devCurrent: ServicePins = { kind: "dev", version: "0.0.0-a", composeSha256: SHA, images: dev("0.0.0-a", "a").images, pull: true };
  const nodeFetch: FetchLike = (url, init) => fetch(url, init);
  const check = (url: string, test = true) =>
    checkForUpdates({ fetch: nodeFetch, url, shellVersion: "0.0.0-dev", services: devCurrent, composeSha256: SHA, test });

  it("refuses a production check against a non-GitHub URL and a test check against anything but 127.0.0.1:18xxx", async () => {
    let called = 0;
    const counting: FetchLike = async () => {
      called += 1;
      return ok(release());
    };
    const base = { fetch: counting, shellVersion: "1.4.0", services: current, composeSha256: SHA };
    expect(await checkForUpdates({ ...base, url: "http://127.0.0.1:18441/x", test: false })).toEqual({ ok: false, reason: "url_refused" });
    expect(await checkForUpdates({ ...base, url: "https://github.com/x", test: false })).toEqual({ ok: false, reason: "url_refused" });
    expect(await checkForUpdates({ ...base, url: RELEASE_API_URL, test: true })).toEqual({ ok: false, reason: "url_refused" });
    expect(await checkForUpdates({ ...base, url: "http://localhost:18441/x", test: true })).toEqual({ ok: false, reason: "url_refused" });
    expect(await checkForUpdates({ ...base, url: "http://127.0.0.1:8080/x", test: true })).toEqual({ ok: false, reason: "url_refused" });
    expect(called).toBe(0);
  });

  it("against the mock server: a prerelease test tag, a same-origin redirect and a same-origin asset", async () => {
    mock = await startMockReleases({ port: 18443 });
    const asset = mock.asset(MANIFEST_ASSET, dev("0.0.0-b", "c"));
    mock.route("/real-latest", {
      status: 200,
      body: JSON.stringify(
        release({ tag_name: "v0.0.0-b", html_url: PAGE, assets: [{ name: MANIFEST_ASSET, browser_download_url: asset }] }),
      ),
    });
    mock.redirect(LATEST_PATH, "/real-latest");
    const result = await check(mock.latestUrl);
    expect(result).toEqual({
      ok: true,
      services: expect.objectContaining({ kind: "dev", version: "0.0.0-b", images: dev("0.0.0-b", "c").images }),
    });
    expect(mock.requests().map((r) => r.path)).toEqual([LATEST_PATH, "/real-latest", `/assets/${MANIFEST_ASSET}`]);
    expect(mock.requests()[0]!.headers["user-agent"]).toBe("OpenAgent/0.0.0-dev");
    expect(mock.requests()[0]!.headers.cookie).toBeUndefined();
  });

  it("against the mock server: a redirect to another origin and an asset on another origin are refused", async () => {
    mock = await startMockReleases({ port: 18443 });
    mock.redirect(LATEST_PATH, "http://127.0.0.1:18444/latest");
    expect(await check(mock.latestUrl)).toEqual({ ok: false, reason: "redirect_refused" });
    mock.release(
      release({ tag_name: "v0.0.0-b", assets: [{ name: MANIFEST_ASSET, browser_download_url: "http://127.0.0.1:18444/assets/x" }] }),
    );
    expect(await check(mock.latestUrl)).toMatchObject({ ok: true, incompatible: "asset_url" });
  });

  it("refuses a prerelease tag outside test mode", async () => {
    const { result } = await run({ [RELEASE_API_URL]: ok(release({ tag_name: "v0.0.0-b" })) });
    expect(result).toEqual({ ok: false, reason: "bad_tag" });
  });

  it("against the mock server: a stopped server is offline", async () => {
    mock = await startMockReleases({ port: 18443 });
    const url = mock.latestUrl;
    await mock.stop();
    mock = undefined;
    expect(await check(url)).toEqual({ ok: false, reason: "offline", detail: "TypeError: fetch failed" });
  });
});
