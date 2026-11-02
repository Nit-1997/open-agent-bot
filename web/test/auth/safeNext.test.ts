import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth";

const ORIGIN = "https://app.test";

describe("safeNext", () => {
  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["https://evil.com"],
    ["/%2F%2Fevil.com"],
    ["/%5Cevil.com"],
    ["/%2f%2fevil.com"],
    ["javascript:alert(1)"],
    [`/${"a".repeat(600)}`],
    ["/admin\u0000"],
    ["/\nadmin"],
    ["/%0aadmin"],
    ["/%E0%A4%A"],
    ["/settings"],
    [""],
    [undefined],
    [42],
  ])("sends %j to /", (raw) => {
    expect(safeNext(raw, ORIGIN)).toBe("/");
  });

  it.each([
    "/chats",
    "/chats?page=2",
    "/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?report=AbCdEf_-1234",
    "/reports?page=3",
    "/reports/AbCdEf_-1234",
    "/plans?kind=trip&page=2",
    "/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/trip/dDE",
    "/search?q=tacos&scope=chats&page=2",
    "/search?q=a%2Fb",
  ])("keeps the shell route %s with its query", (raw) => {
    expect(safeNext(raw, ORIGIN)).toBe(raw);
  });

  it("drops unknown or invalid query values and rejects invalid shell paths", () => {
    expect(safeNext("/reports?page=2&evil=1", ORIGIN)).toBe("/reports?page=2");
    expect(safeNext(`/search?q=${"a".repeat(101)}`, ORIGIN)).toBe("/search");
    expect(safeNext("/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/trip/%%%", ORIGIN)).toBe("/");
    expect(safeNext("/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/trip/!!", ORIGIN)).toBe("/");
    expect(safeNext("/chats/not-a-uuid", ORIGIN)).toBe("/");
    expect(safeNext("/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?report=..%2f..%2fx", ORIGIN)).toBe(
      "/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(safeNext("/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?report=javascript:x", ORIGIN)).toBe(
      "/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(safeNext("//evil.example/chats?report=AbCdEf_-1234", ORIGIN)).toBe("/");
    expect(safeNext("/\\evil.example?report=AbCdEf_-1234", ORIGIN)).toBe("/");
    expect(safeNext("https://evil.example/chats/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?report=AbCdEf_-1234", ORIGIN)).toBe("/");
  });

  it("keeps the allowed paths", () => {
    expect(safeNext("/", ORIGIN)).toBe("/");
    expect(safeNext("/admin", ORIGIN)).toBe("/admin");
    expect(safeNext("/admin?tab=users", ORIGIN)).toBe("/admin");
  });
});
