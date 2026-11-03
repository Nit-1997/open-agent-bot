type Handler = (url: URL) => Response | Promise<Response>;

export function fakeFetch(routes: Array<[RegExp, Handler]>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    for (const [re, h] of routes) if (re.test(url.href)) return h(url);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

export const html = (body: string, status = 200) =>
  new Response(`<html><head><title>T</title></head><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

export const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
