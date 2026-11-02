"use client";

import { clearedProfile } from "@/lib/profile";
import { useBreakpoint } from "@/lib/shell/breakpoints";
import { ModelsPanel } from "@/components/profile/ModelsPanel";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { AccountSheet } from "./AccountSheet";
import { MobileDrawer } from "./MobileDrawer";
import { Overlay } from "./Overlay";
import { useShell } from "./ShellProvider";
import { SidebarContent } from "./Sidebar";

export function ShellOverlays() {
  const shell = useShell();
  const breakpoint = useBreakpoint();
  const { overlay, close, open, profile, saveProfile } = shell;
  switch (overlay) {
    case "sidebar":
      return breakpoint === "tablet" || (breakpoint === "desktop" && shell.report.inline) ? (
        <Overlay
          id="sidebar-overlay"
          label="Chats"
          side="left"
          onClose={close}
          panelClassName="!w-[300px] border-r border-surface-accent bg-sidebar"
        >
          <div id="sidebar" className="flex min-h-0 flex-1 flex-col gap-[18px] px-3.5 py-[18px]">
            <SidebarContent onNavigate={close} />
          </div>
        </Overlay>
      ) : null;
    case "drawer":
      return breakpoint === "phone" ? <MobileDrawer /> : null;
    case "account":
      return <AccountSheet />;
    case "models":
      return <ModelsPanel onClose={close} onChanged={shell.reloadModels} />;
    case "profile":
      return (
        <ProfileDrawer
          profile={profile}
          models={shell.models}
          focus={shell.profileFocus}
          onClose={close}
          onSave={async (p) => {
            await saveProfile(p);
            close();
          }}
          onRestart={() => {
            void saveProfile({ ...profile, onboardedAt: undefined, skipped: [] });
            close();
          }}
          onClear={() => {
            void saveProfile(clearedProfile(profile));
            close();
          }}
          onManageModels={() => open("models")}
        />
      );
    default:
      return null;
  }
}
