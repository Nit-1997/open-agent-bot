import { Hono } from "hono";
import { ARTIFACT_CSP } from "../../../shared/artifacts.js";
import { type ArtifactOwner, type ArtifactStore, slugify } from "../artifacts/store.js";
import type { AuthEnv } from "../auth/middleware.js";
import { LIMITS, type RateLimiter, rateLimitError } from "../lib/rateLimit.js";
import { limitBy, safe } from "./handlers.js";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const notFound = { error: "not_found", message: "That report doesn't exist." };

export function artifactRoutes(deps: { artifacts: ArtifactStore; owner: (userId: string) => ArtifactOwner; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.use("/artifacts/*", limitBy<AuthEnv>(deps.limiter, "artifacts"));

  app.get(
    "/artifacts/:file",
    safe<AuthEnv>(async (c) => {
      const userId = c.get("user").id;
      const owner = deps.owner(userId);
      const file = c.req.param("file") ?? "";
      const beforeRender = () => {
        const verdict = deps.limiter.take(`renders:${userId}`, LIMITS.renders);
        if (!verdict.ok) throw rateLimitError(verdict.retryAfter);
      };
      if (file.endsWith(".pdf")) {
        const out = await deps.artifacts.renderPdf(owner, file.slice(0, -4), { beforeRender });
        if (!out) return c.json(notFound, 404);
        return new Response(new Uint8Array(out.pdf), {
          headers: {
            ...PRIVATE,
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${slugify(out.title)}.pdf"`,
          },
        });
      }
      if (file.endsWith(".jpg")) {
        const jpg = await deps.artifacts.thumbnail(owner, file.slice(0, -4), { beforeRender });
        if (!jpg) return c.json(notFound, 404);
        return new Response(new Uint8Array(jpg), { headers: { ...PRIVATE, "content-type": "image/jpeg" } });
      }
      const a = await deps.artifacts.get(owner, file);
      if (!a) return c.json(notFound, 404);
      return new Response(a.html, {
        headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
      });
    }),
  );

  return app;
}
