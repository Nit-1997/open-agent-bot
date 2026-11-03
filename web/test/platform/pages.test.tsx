import { ChatsView } from "@oab/ui/components/chat/ChatsView.tsx";
import { ReportDetail } from "@oab/ui/components/reports/ReportDetail.tsx";
import { ReportsView } from "@oab/ui/components/reports/ReportsView.tsx";
import { SearchView } from "@oab/ui/components/search/SearchView.tsx";
import { RouteView } from "@oab/ui/views/RouteView.tsx";
import { type ComponentProps, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import NewChatPage from "@/app/(app)/page";
import ChatPage from "@/app/(app)/chats/[id]/page";
import ChatsPage from "@/app/(app)/chats/page";
import ReportPage from "@/app/(app)/reports/[id]/page";
import ReportsPage from "@/app/(app)/reports/page";
import SearchPage from "@/app/(app)/search/page";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());

const CHAT = "AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPORT = "e2eReport001";

function expand(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ route: Parameters<typeof RouteView>[0]["route"] }>;
  return el.type === RouteView ? expand(RouteView(el.props)) : el;
}

const tree = (node: ReactNode) => {
  const el = expand(node);
  if (el === null || el === undefined) return null;
  if (!isValidElement(el)) throw new Error(`not an element: ${String(el)}`);
  return { type: el.type, key: el.key, props: el.props };
};

const search = (q: Record<string, string | string[]>) => ({ searchParams: Promise.resolve(q) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Next (app) pages render the ui route views", () => {
  it("renders nothing for a new chat and a valid chat", async () => {
    expect(tree(NewChatPage())).toBeNull();
    expect(tree(await ChatPage(params(CHAT)))).toBeNull();
  });

  it("keeps not-found for an invalid chat or report id", async () => {
    await expect(ChatPage(params("not-a-uuid"))).rejects.toThrow("notFound");
    await expect(ReportPage(params("BAD!"))).rejects.toThrow("notFound");
  });

  it.each([
    [{}, 1],
    [{ page: "3" }, 3],
    [{ page: ["2", "5"] }, 2],
    [{ page: "0" }, 1],
    [{ page: "x" }, 1],
  ])("chats and reports read page from %j", async (q, page) => {
    expect(tree(await ChatsPage(search(q)))).toEqual(tree(<ChatsView page={page} />));
    expect(tree(await ReportsPage(search(q)))).toEqual(tree(<ReportsView page={page} />));
  });

  it("renders the report detail keyed by its id", async () => {
    expect(tree(await ReportPage(params(REPORT)))).toEqual(tree(<ReportDetail key={REPORT} reportId={REPORT} />));
  });

  it.each<[Record<string, string | string[]>, ComponentProps<typeof SearchView>]>([
    [{}, { q: "", scope: "all", page: 1 }],
    [
      { q: "  Big Sur ", scope: "reports", page: "2" },
      { q: "  Big Sur ", scope: "reports", page: 2 },
    ],
    [
      { q: ["x", "y"], scope: "nope" },
      { q: "x", scope: "all", page: 1 },
    ],
  ])("search passes q, scope and page from %j", async (q, props) => {
    expect(tree(await SearchPage(search(q)))).toEqual(tree(<SearchView {...props} />));
  });
});
