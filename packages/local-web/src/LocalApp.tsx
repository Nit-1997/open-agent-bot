import { parseRoute } from "@oab/shared/routes";
import { AppShell } from "@oab/ui/components/shell/AppShell.tsx";
import { type Platform, PlatformProvider, type PlatformRouter, usePathname, useSearchParams } from "@oab/ui/platform";
import { ChatRuntime } from "@oab/ui/platform/chat";
import { NotFoundView } from "@oab/ui/views/NotFoundView.tsx";
import { RouteView } from "@oab/ui/views/RouteView.tsx";
import { useMemo } from "react";

const LOCAL_USER = Object.freeze({ name: "", email: "" });
const NO_SLOTS = Object.freeze({});

function LocalRoute() {
  const route = parseRoute(usePathname(), useSearchParams());
  if (!route || route.section === "admin") return <NotFoundView />;
  return <RouteView route={route} />;
}

export function LocalApp({ router }: { router: PlatformRouter }) {
  const platform = useMemo<Platform>(() => ({ router, user: LOCAL_USER, slots: NO_SLOTS }), [router]);
  return (
    <PlatformProvider platform={platform}>
      <ChatRuntime>
        <AppShell>
          <LocalRoute />
        </AppShell>
      </ChatRuntime>
    </PlatformProvider>
  );
}
