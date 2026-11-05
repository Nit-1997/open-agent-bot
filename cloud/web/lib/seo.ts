import type { Metadata } from "next";

export const SITE_TITLE = "Open Agent · A personal agent you can see think";

export const SITE_DESCRIPTION =
  "An open-source personal research agent that shows every source it reads and every claim it checks. Try the hosted sandbox or run it on your Mac.";

export const PRIVATE_PATHS = ["/api/", "/admin", "/account", "/auth/", "/chats", "/reports", "/search", "/landing"];

export const SITEMAP_PATHS = [
  { path: "/", priority: 1 },
  { path: "/terms", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
] as const;

export function originFrom(value: string | undefined): string | undefined {
  return value && URL.canParse(value) ? new URL(value).origin : undefined;
}

export function siteMetadata(origin: string | undefined): Metadata {
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    applicationName: "Open Agent",
    openGraph: {
      type: "website",
      siteName: "Open Agent",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "Open Agent: a personal agent you can see think" }],
    },
    twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: ["/og.jpg"] },
  };
}
