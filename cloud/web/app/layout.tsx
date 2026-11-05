import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { originFrom, siteMetadata } from "@/lib/seo";
import "./globals.css";

export function generateMetadata(): Metadata {
  return siteMetadata(originFrom(process.env.APP_ORIGIN));
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html id="root-html" lang="en" className="h-full" suppressHydrationWarning>
      <head id="root-head">
        <script id="theme-init" nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body id="root-body" className="h-full text-text-primary">
        {children}
      </body>
    </html>
  );
}
