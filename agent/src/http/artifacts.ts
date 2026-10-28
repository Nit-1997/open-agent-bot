import { Hono } from "hono";
import { ARTIFACT_CSP } from "../../../shared/artifacts.js";
import { type ArtifactStore, slugify } from "../artifacts/store.js";

export function artifactRoutes(artifacts?: ArtifactStore) {
  const app = new Hono();

  app.get("/artifacts/:file", async (c) => {
    if (!artifacts) return c.notFound();
    const file = c.req.param("file");
    const isPdf = file.endsWith(".pdf");
    const id = isPdf ? file.slice(0, -4) : file;
    if (isPdf) {
      const meta = await artifacts.get(id);
      const pdf = meta && (await artifacts.renderPdf(id));
      if (!meta || !pdf) return c.notFound();
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${slugify(meta.title)}.pdf"`,
        },
      });
    }
    const a = await artifacts.get(id);
    if (!a) return c.notFound();
    return new Response(a.html, {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
    });
  });

  return app;
}
