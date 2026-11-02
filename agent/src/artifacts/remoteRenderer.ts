import type { Renderer } from "./store.js";

export function remoteRenderer(cfg: { url: string; secret: string }, f: typeof fetch = fetch): { pdf: Renderer; thumb: Renderer } {
  const call =
    (kind: "pdf" | "thumb"): Renderer =>
    async (html, signal) => {
      const res = await f(`${cfg.url}/render/${kind}`, {
        method: "POST",
        body: html,
        signal,
        headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "text/html; charset=utf-8" },
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`renderer answered ${res.status}`);
      }
      return Buffer.from(await res.arrayBuffer());
    };
  return { pdf: call("pdf"), thumb: call("thumb") };
}
