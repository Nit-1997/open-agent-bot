import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/layout";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { decideRoute } from "@/lib/routeRules";
import { originFrom, PRIVATE_PATHS, siteMetadata } from "@/lib/seo";

const ORIGIN = "https://sandbox.example.com";
const signedOut = { user: null, unavailable: false } as const;

afterEach(() => vi.unstubAllEnvs());

describe("robots.txt and sitemap.xml", () => {
  it("lets signed-out visitors and crawlers reach both files", () => {
    expect(decideRoute("/robots.txt", signedOut)).toEqual({ kind: "pass" });
    expect(decideRoute("/sitemap.xml", signedOut)).toEqual({ kind: "pass" });
  });

  it("allows the public pages, blocks the signed-in app and points at the sitemap", () => {
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    const r = robots();
    expect(r.rules).toEqual({ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS });
    for (const p of ["/api/", "/admin", "/chats", "/reports", "/search", "/account"]) expect(PRIVATE_PATHS).toContain(p);
    for (const p of ["/terms", "/privacy", "/login"]) expect(PRIVATE_PATHS.some((d) => p.startsWith(d))).toBe(false);
    expect(r.sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });

  it("lists the home, terms and privacy pages on the app origin", () => {
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    expect(sitemap().map((e) => e.url)).toEqual([ORIGIN, `${ORIGIN}/terms`, `${ORIGIN}/privacy`]);
  });
});

describe("site metadata", () => {
  it("gives every page a description and a social preview on the app origin", () => {
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    const m = generateMetadata();
    expect(m.metadataBase?.toString()).toBe(`${ORIGIN}/`);
    expect(m.description).toMatch(/open-source/);
    expect(m.openGraph).toMatchObject({ siteName: "Open Agent", images: [{ url: "/og.jpg", width: 1200, height: 630 }] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(m.alternates).toBeUndefined();
  });

  it("still renders without APP_ORIGIN or with a bad one", () => {
    expect(originFrom(undefined)).toBeUndefined();
    expect(originFrom("not a url")).toBeUndefined();
    expect(siteMetadata(undefined).metadataBase).toBeUndefined();
  });

  it("ships the preview image", () => {
    expect(existsSync(resolve(__dirname, "../public/og.jpg"))).toBe(true);
  });
});
