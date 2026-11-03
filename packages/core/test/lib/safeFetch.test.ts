import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBlockedError } from "../../src/lib/net.js";
import { createSafeFetch, guardedLookup, guardedTransport } from "../../src/lib/safeFetch.js";

let server: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++;
    res.end("secret");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const lookupOnce = (addresses: string[]) => (hostname: string, all: boolean) =>
  new Promise<{ err: Error | null; address: unknown }>((resolve) =>
    guardedLookup(async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))(
      hostname,
      { all },
      (err, address) => resolve({ err, address }),
    ),
  );

describe("guardedLookup", () => {
  it("pins the checked public address", async () => {
    expect(await lookupOnce(["93.184.216.34"])("site.example", false)).toEqual({ err: null, address: "93.184.216.34" });
    expect((await lookupOnce(["93.184.216.34", "2606:4700::1"])("site.example", true)).address).toHaveLength(2);
  });

  it.each([["127.0.0.1"], ["169.254.169.254"], ["10.0.0.2"], ["::1"], ["fd00::5"], ["93.184.216.34", "172.17.0.1"]])(
    "refuses a name that resolves to %s",
    async (...addresses) => {
      const { err } = await lookupOnce(addresses)("rebind.example", true);
      expect(isBlockedError(err)).toBe(true);
    },
  );
});

describe("guardedTransport", () => {
  it("refuses at connect time when DNS answers with a private address (rebinding)", async () => {
    const f = guardedTransport(async () => [{ address: "127.0.0.1", family: 4 }]);
    const before = hits;
    const err = await f(`http://rebind.example:${port}/`).catch((e: unknown) => e);
    expect(isBlockedError(err)).toBe(true);
    expect(hits).toBe(before);
  });
});

describe("createSafeFetch", () => {
  it("refuses a redirect to an internal address without following it", async () => {
    const calls: string[] = [];
    const transport = (async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }) as typeof fetch;
    const err = await createSafeFetch(transport)("https://models.example/v1/models").catch((e: unknown) => e);
    expect(isBlockedError(err)).toBe(true);
    expect(calls).toEqual(["https://models.example/v1/models"]);
  });

  it("refuses internal URLs before any request", async () => {
    const calls: string[] = [];
    const transport = (async (url: string) => {
      calls.push(url);
      return new Response("x");
    }) as typeof fetch;
    for (const url of [`http://127.0.0.1:${port}/`, "http://[::ffff:127.0.0.1]/", "http://metadata.internal/"]) {
      expect(isBlockedError(await createSafeFetch(transport)(url).catch((e: unknown) => e))).toBe(true);
    }
    expect(calls).toEqual([]);
  });
});
