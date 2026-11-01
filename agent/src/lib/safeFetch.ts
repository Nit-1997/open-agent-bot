import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { BlockedAddressError, fetchPublic, isBlockedAddress } from "./net.js";

export type Resolve = (hostname: string) => Promise<LookupAddress[]>;

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

const systemResolve: Resolve = (hostname) => lookup(hostname, { all: true, verbatim: true });

export function guardedLookup(resolve: Resolve = systemResolve) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    resolve(hostname).then(
      (addresses) => {
        if (!addresses.length) return callback(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }), []);
        if (addresses.some((a) => isBlockedAddress(a.address)))
          return callback(new BlockedAddressError(`refusing ${hostname}: it resolves to a private address`), []);
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err, []),
    );
  };
}

export function guardedTransport(resolve?: Resolve): typeof fetch {
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(resolve) } });
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1],
    )) as unknown as typeof fetch;
}

export const guardedFetch = guardedTransport();

export function publicTransport(allowPrivateHosts: boolean | undefined): typeof fetch {
  return allowPrivateHosts ? fetch : guardedFetch;
}

const urlOf = (input: Parameters<typeof fetch>[0]) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

export function createSafeFetch(transport: typeof fetch = guardedFetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const base = input instanceof Request ? { method: input.method, headers: input.headers, body: input.body, signal: input.signal } : {};
    const { res } = await fetchPublic(transport, urlOf(input), { ...base, ...init }, { lookup: async () => [] });
    return res;
  }) as typeof fetch;
}
