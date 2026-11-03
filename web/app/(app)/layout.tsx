import { AppShell } from "@oab/ui/components/shell/AppShell.tsx";
import { requireUser } from "@/lib/auth";
import { HostedPlatform } from "@/lib/platform/hosted";
import { ChatRuntime } from "@oab/ui/platform";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <HostedPlatform user={{ email: user.email, name: user.name, isAdmin: user.isAdmin }}>
      <ChatRuntime>
        <AppShell>{children}</AppShell>
      </ChatRuntime>
    </HostedPlatform>
  );
}
