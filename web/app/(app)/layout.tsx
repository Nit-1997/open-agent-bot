import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/auth";
import { Providers } from "../providers";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <Providers>
      <AppShell user={{ email: user.email, name: user.name, isAdmin: user.isAdmin }}>{children}</AppShell>
    </Providers>
  );
}
