import { Hono } from "hono";
import { ARTIFACT_CSP } from "../../../shared/artifacts.js";
import { type ArtifactOwner, type ArtifactStore, slugify } from "../artifacts/store.js";
import type { AuthEnv } from "../auth/middleware.js";
import { safe } from "./handlers.js";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const notFound = { error: "not_found", message: "That report doesn't exist." };

export function artifactRoutes(deps: { artifacts: ArtifactStore; owner: (userId: string) => ArtifactOwner }) {
  const app = new Hono<AuthEnv>();

  app.get(
    "/artifacts/:file",
    safe<AuthEnv>(async (c) => {
      const owner = deps.owner(c.get("user").id);
      const file = c.req.param("file") ?? "";
      if (file.endsWith(".pdf")) {
        const out = await deps.artifacts.renderPdf(owner, file.slice(0, -4));
        if (!out) return c.json(notFound, 404);
        return new Response(new Uint8Array(out.pdf), {
          headers: {
            ...PRIVATE,
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${slugify(out.title)}.pdf"`,
          },
        });
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
