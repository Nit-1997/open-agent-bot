import { describe, expect, it } from "vitest";
import { fetchPublic, publicHttpUrlError, readCapped, resolvesInternal } from "../../src/lib/net.js";

describe("publicHttpUrlError", () => {
  it.each([
    "http://localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://192.0.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[ff02::1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[2001:db8::1]/",
  ])("refuses %s", (url) => {
    expect(publicHttpUrlError(url)).toMatch(/refusing internal or private address/);
  });

  it.each(["https://example.com/a?b=c", "http://93.184.216.34/", "http://172.32.0.1/", "http://[2606:4700:4700::1111]/"])(
    "allows %s",
    (url) => {
      expect(publicHttpUrlError(url)).toBeNull();
    },
  );

  it("rejects other schemes and junk, and allows private hosts only when asked", () => {
    expect(publicHttpUrlError("file:///etc/passwd")).toMatch(/unsupported url scheme/);
    expect(publicHttpUrlError("not a url")).toMatch(/invalid url/);
    expect(publicHttpUrlError("http://127.0.0.1/", { allowPrivateHosts: true })).toBeNull();
  });
});

describe("resolvesInternal", () => {
  it("is true when any DNS answer is private and false when all are public or lookup fails", async () => {
    expect(await resolvesInternal("rebind.example", async () => ["93.184.216.34", "10.0.0.5"])).toBe(true);
    expect(await resolvesInternal("v6.example", async () => ["::1"])).toBe(true);
    expect(await resolvesInternal("example.com", async () => ["93.184.216.34"])).toBe(false);
    expect(
      await resolvesInternal("gone.example", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).toBe(false);
  });
});

describe("fetchPublic", () => {
  const publicDns = async () => ["93.184.216.34"];

  it("follows redirects but refuses one that lands on a private address", async () => {
    const f = (async (url: string) =>
      url.startsWith("https://a.example")
        ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })
        : new Response("ok")) as typeof fetch;
    await expect(fetchPublic(f, "https://a.example/start", {}, { lookup: publicDns })).rejects.toThrow(
      /refusing internal or private address/,
    );
  });

  it("refuses a public name that resolves to a private address", async () => {
    const f = (async () => new Response("ok")) as typeof fetch;
    await expect(fetchPublic(f, "https://rebind.example/", {}, { lookup: async () => ["127.0.0.1"] })).rejects.toThrow(
      /resolves to a private address/,
    );
  });

  it("stops after too many redirects", async () => {
    let n = 0;
    const f = (async () => new Response(null, { status: 302, headers: { location: `https://loop.example/${n++}` } })) as typeof fetch;
    await expect(fetchPublic(f, "https://loop.example/", {}, { lookup: publicDns })).rejects.toThrow(/too many redirects/);
  });

  it("returns the final response and URL", async () => {
    const f = (async (url: string) =>
      url.endsWith("/old") ? new Response(null, { status: 301, headers: { location: "/new" } }) : new Response("hi")) as typeof fetch;
    const { res, url } = await fetchPublic(f, "https://site.example/old", {}, { lookup: publicDns });
    expect(url).toBe("https://site.example/new");
    expect(await res.text()).toBe("hi");
  });
});

describe("readCapped", () => {
  it("reads at most maxBytes", async () => {
    expect(await readCapped(new Response("abcdefghij"), 4)).toBe("abcd");
    expect(await readCapped(new Response(null), 4)).toBe("");
  });
});
