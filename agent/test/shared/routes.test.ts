import { describe, expect, it } from "vitest";
import { hrefFor, parseRoute } from "../../../shared/routes.js";

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parse = (url: string) => {
  const u = new URL(url, "https://app.test");
  return parseRoute(u.pathname, u.searchParams);
};

describe("parseRoute and hrefFor", () => {
  it.each([
    "/",
    `/chats/${CHAT}`,
    `/chats/${CHAT}?report=AbCdEf_-1234`,
    "/chats",
    "/chats?page=3",
    "/reports",
    "/reports?page=2",
    "/reports/AbCdEf_-1234",
    "/search",
    "/search?q=big+sur",
    "/search?q=tacos&scope=reports&page=2",
    "/admin",
  ])("round-trips %s", (url) => {
    const route = parse(url);
    expect(route).not.toBeNull();
    expect(hrefFor(route!)).toBe(url);
  });

  it("canonicalises ids, drops defaults and unknown or invalid query values", () => {
    expect(hrefFor(parse(`/chats/${CHAT.toUpperCase()}`)!)).toBe(`/chats/${CHAT}`);
    expect(hrefFor(parse("/reports?page=1&x=1")!)).toBe("/reports");
    expect(hrefFor(parse(`/search?q=${"a".repeat(101)}&scope=plans`)!)).toBe("/search");
    expect(hrefFor(parse("/search?q=a")!)).toBe("/search");
    expect(hrefFor(parse("/search?q=%20big%20%20sur%20&scope=all")!)).toBe("/search?q=big+sur");
  });

  it("keeps a valid report on a chat and drops a bad one or one anywhere else", () => {
    expect(parse(`/chats/${CHAT}?report=AbCdEf_-1234`)).toEqual({ section: "chat", chatId: CHAT, report: "AbCdEf_-1234" });
    for (const bad of ["AbCdEf_-123", "AbCdEf_-12345", "..", "%2f", "abc%2fdefghij", "javascript:x", "abcd.efghijk"])
      expect(parse(`/chats/${CHAT}?report=${bad}`), bad).toEqual({ section: "chat", chatId: CHAT, report: null });
    expect(parse(`/chats/${CHAT}?report=AbCdEf_-1234&report=ZZZZZZZZZZZZ`)).toMatchObject({ report: "AbCdEf_-1234" });
    expect(hrefFor(parse(`/chats/${CHAT}?report=bad`)!)).toBe(`/chats/${CHAT}`);
    expect(parse("/?report=AbCdEf_-1234")).toEqual({ section: "chat", chatId: null, report: null });
    expect(hrefFor(parse("/?report=AbCdEf_-1234")!)).toBe("/");
    expect(hrefFor(parse("/reports?report=AbCdEf_-1234")!)).toBe("/reports");
  });

  it.each([
    "/chats/not-a-uuid",
    `/chats/${CHAT}/messages`,
    "/reports/short",
    "/plans",
    "/plans?kind=trip",
    `/plans/${CHAT}/trip/dDE`,
    "/search/x",
    "/settings",
    "/admin/users",
    "/login",
  ])("rejects %s", (url) => {
    expect(parse(url)).toBeNull();
  });
});
