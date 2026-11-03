import { net, type Session } from "electron";
import type { FetchLike } from "./updateCheck.ts";

const NULL_BODY = new Set([204, 205, 304]);

export function sessionFetch(ses: Session): FetchLike {
  return (url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal ?? undefined;
      if (signal?.aborted) return reject(signal.reason);
      const req = net.request({
        url,
        method: "GET",
        session: ses,
        redirect: "manual",
        credentials: "omit",
        useSessionCookies: false,
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
      for (const [k, v] of new Headers(init.headers)) req.setHeader(k, v);
      let settled = false;
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      const settle = (f: () => void) => {
        if (settled) return;
        settled = true;
        f();
      };
      const onAbort = () => {
        req.abort();
        stream?.error(signal?.reason);
        settle(() => reject(signal?.reason));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      req.on("redirect", (status, _method, location) => {
        req.abort();
        settle(() => resolve(new Response(null, { status, headers: { location } })));
      });
      req.on("response", (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode;
        if (NULL_BODY.has(status) || status < 200 || status > 599) {
          req.abort();
          settle(() => resolve(new Response(null, { status: status < 200 || status > 599 ? 502 : status, headers })));
          return;
        }
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            stream = c;
            res.on("data", (b: Buffer) => c.enqueue(new Uint8Array(b)));
            res.on("end", () => {
              signal?.removeEventListener("abort", onAbort);
              c.close();
            });
            res.on("error", (e: Error) => c.error(e));
          },
          cancel() {
            req.abort();
          },
        });
        settle(() => resolve(new Response(body, { status, headers })));
      });
      req.on("error", (e) => settle(() => reject(e)));
      req.end();
    });
}
