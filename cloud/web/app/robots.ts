import type { MetadataRoute } from "next";
import { appOrigin } from "@/lib/env";
import { PRIVATE_PATHS } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = appOrigin();
  return { rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }, sitemap: `${origin}/sitemap.xml`, host: origin };
}
