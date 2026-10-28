import type { Metadata, Viewport } from "next";
import { DM_Mono, DM_Sans, Instrument_Serif } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-dm-mono" });

export const metadata: Metadata = {
  title: "Open Agent",
  description: "Personal research and planning agent",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html id="root-html" lang="en" className={`${display.variable} ${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head id="root-head">
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body id="root-body" className="h-full text-text-primary">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
