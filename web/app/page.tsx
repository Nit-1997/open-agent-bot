import { Chat } from "@/components/Chat";
import { requireUser } from "@/lib/auth";
import { Providers } from "./providers";

export default async function Home() {
  const user = await requireUser();
  return (
    <Providers>
      <Chat email={user.email} isAdmin={user.isAdmin} />
    </Providers>
  );
}
