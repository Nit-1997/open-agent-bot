import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/authForms";

const ip = (headers: Record<string, string>) => clientIp(new Headers(headers));

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for, then the first x-forwarded-for hop", () => {
    expect(ip({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe("198.51.100.4");
    expect(ip({ "x-vercel-forwarded-for": "2001:db8::1, 10.0.0.1" })).toBe("2001:db8::1");
    expect(ip({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe("203.0.113.9");
  });

  it("falls back to x-forwarded-for when the Vercel header isn't an IP, and answers null without a usable header", () => {
    expect(ip({ "x-vercel-forwarded-for": "not an ip", "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
    expect(ip({ "x-forwarded-for": "evil<script>" })).toBeNull();
    expect(ip({ "x-client-ip": "203.0.113.9" })).toBeNull();
    expect(ip({})).toBeNull();
  });
});
