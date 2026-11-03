import type { Route } from "@oab/shared/routes";
import type { ReactElement } from "react";
import { ChatsView } from "../components/chat/ChatsView.tsx";
import { ReportDetail } from "../components/reports/ReportDetail.tsx";
import { ReportsView } from "../components/reports/ReportsView.tsx";
import { SearchView } from "../components/search/SearchView.tsx";

export function RouteView({ route }: { route: Route }): ReactElement | null {
  switch (route.section) {
    case "chats":
      return <ChatsView page={route.page} />;
    case "reports":
      return <ReportsView page={route.page} />;
    case "report":
      return <ReportDetail key={route.id} reportId={route.id} />;
    case "search":
      return <SearchView q={route.q ?? ""} scope={route.scope} page={route.page} />;
    case "chat":
    case "admin":
      return null;
  }
}
