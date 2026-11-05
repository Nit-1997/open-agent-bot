import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/env";
import { SITEMAP_PATHS } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = appOrigin();
  return SITEMAP_PATHS.map(({ path, priority }) => ({ url: `${origin}${path === "/" ? "" : path}`, priority }));
}
