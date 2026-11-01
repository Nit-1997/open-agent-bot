"use client";

import type { ReactNode } from "react";
import { ChatHost } from "@/components/chat/ChatHost";
import { useBreakpoint } from "@/lib/shell/breakpoints";
import { MobileTabs } from "./MobileTabs";
import { MobileTopBar } from "./MobileTopBar";
import { SHELL_FRAME_ID } from "./Overlay";
import { Rail } from "./Rail";
import { useShell } from "./ShellProvider";
import { Sidebar } from "./Sidebar";

export function ShellFrame({ children }: { children: ReactNode }) {
  const breakpoint = useBreakpoint();
  const { sidebar, overlay, open, close } = useShell();
  const desktop = breakpoint === "desktop";
  const phone = breakpoint === "phone";
  const railSidebarOpen = desktop ? sidebar.open : overlay === "sidebar";
  const toggle = desktop ? sidebar.toggle : () => (overlay === "sidebar" ? close() : open("sidebar"));

  return (
    <div
      id={SHELL_FRAME_ID}
      data-breakpoint={breakpoint}
      className={`flex h-dvh w-full overflow-hidden bg-bg ${phone ? "flex-col" : "flex-row"}`}
    >
      {phone ? null : <Rail sidebarOpen={railSidebarOpen} onToggleSidebar={toggle} showNewChat={!desktop || !sidebar.open} />}
      {desktop ? <Sidebar open={sidebar.open} /> : null}
      {phone ? <MobileTopBar /> : null}
      <main id="shell-main" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHost />
        {children}
      </main>
      {phone ? <MobileTabs /> : null}
    </div>
  );
}
