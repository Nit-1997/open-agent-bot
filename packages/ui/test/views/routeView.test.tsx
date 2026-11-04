import type { Route } from "@oab/shared/routes";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ChatsView } from "../../src/components/chat/ChatsView.tsx";
import { ReportDetail } from "../../src/components/reports/ReportDetail.tsx";
import { ReportsView } from "../../src/components/reports/ReportsView.tsx";
import { SearchView } from "../../src/components/search/SearchView.tsx";
import { RouteView } from "../../src/views/RouteView.tsx";

const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT = "e2eReport001";

const tree = (node: ReactNode) => {
  if (node === null || node === undefined) return null;
  if (!isValidElement(node)) throw new Error(`not an element: ${String(node)}`);
  const el = node as ReactElement;
  return { type: el.type, key: el.key, props: el.props };
};

const CASES: ReadonlyArray<readonly [string, Route, ReactNode]> = [
  ["new chat", { section: "chat", chatId: null, report: null }, null],
  ["chat", { section: "chat", chatId: CHAT, report: null }, null],
  ["chat with a report", { section: "chat", chatId: CHAT, report: REPORT }, null],
  ["chats page 1", { section: "chats", page: 1 }, <ChatsView page={1} />],
  ["chats page 4", { section: "chats", page: 4 }, <ChatsView page={4} />],
  ["reports page 1", { section: "reports", page: 1 }, <ReportsView page={1} />],
  ["reports page 2", { section: "reports", page: 2 }, <ReportsView page={2} />],
  ["report", { section: "report", id: REPORT }, <ReportDetail key={REPORT} reportId={REPORT} />],
  ["search", { section: "search", q: "big sur", scope: "reports", page: 2 }, <SearchView q="big sur" scope="reports" page={2} />],
  ["search without a query", { section: "search", q: null, scope: "all", page: 1 }, <SearchView q="" scope="all" page={1} />],
  ["admin", { section: "admin" }, null],
];

describe("RouteView", () => {
  it.each(CASES)("%s renders the same element tree as the Next page", (_, route, expected) => {
    expect(tree(RouteView({ route }))).toEqual(tree(expected));
  });

  it("covers every route section", () => {
    const sections = new Set(CASES.map(([, route]) => route.section));
    expect([...sections].sort()).toEqual(["admin", "chat", "chats", "report", "reports", "search"]);
  });
});
