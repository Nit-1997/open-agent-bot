import { describe, expect, it } from "vitest";
import { hrefFor, parseRoute } from "../../../shared/routes.js";
import { entityKey } from "../../../shared/workspace.js";

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parse = (url: string) => {
  const u = new URL(url, "https://app.test");
  return parseRoute(u.pathname, u.searchParams);
};

describe("parseRoute and hrefFor", () => {
  it.each([
    "/",
    `/chats/${CHAT}`,
    "/chats",
    "/chats?page=3",
    "/reports",
    "/reports?page=2",
    "/reports/AbCdEf_-1234",
    "/plans",
    "/plans?kind=trip",
    "/plans?kind=cart&page=2",
    `/plans/${CHAT}/trip/${entityKey("t1")}`,
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
    expect(hrefFor(parse("/plans?kind=boat&page=abc")!)).toBe("/plans");
    expect(hrefFor(parse(`/search?q=${"a".repeat(101)}&scope=plans`)!)).toBe("/search");
    expect(hrefFor(parse("/search?q=a")!)).toBe("/search");
    expect(hrefFor(parse("/search?q=%20big%20%20sur%20&scope=all")!)).toBe("/search?q=big+sur");
  });

  it.each([
    "/chats/not-a-uuid",
    `/chats/${CHAT}/messages`,
    "/reports/short",
    `/plans/${CHAT}/boat/${entityKey("t1")}`,
    `/plans/${CHAT}/trip/!!`,
    `/plans/${CHAT}/trip/${entityKey("x".repeat(101))}`,
    `/plans/not-a-uuid/trip/${entityKey("t1")}`,
    `/plans/${CHAT}/trip`,
    "/search/x",
    "/settings",
    "/admin/users",
    "/login",
  ])("rejects %s", (url) => {
    expect(parse(url)).toBeNull();
  });

  it.each(["..", ".", "a/b", "50%", "x?y#z", "Zürich trip", "y".repeat(100)])(
    "builds a plan href for the entity id %j with no %, / or dot segment",
    (id) => {
      const href = hrefFor({ section: "plan", chatId: CHAT, kind: "trip", key: entityKey(id), entityId: id });
      const key = href.split("/").at(-1)!;
      expect(href).not.toContain("%");
      expect(key).not.toContain("/");
      expect(key).not.toMatch(/^\.+$/);
      expect(parse(href)).toMatchObject({ section: "plan", entityId: id });
    },
  );
});
