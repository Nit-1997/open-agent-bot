import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Agent",
  description: "Personal research and planning agent",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html id="root-html" lang="en" className="h-full antialiased">
      <body id="root-body" className="h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
