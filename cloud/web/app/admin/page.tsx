import { AdminView } from "@/components/admin/AdminView";
import { requireAdmin } from "@/lib/auth";
import { listRequests, listUsage, listUsers, usageSummary } from "./actions";

export default async function AdminPage() {
  const me = await requireAdmin();
  const [requests, users, summary, usage] = await Promise.all([
    listRequests("pending", 1),
    listUsers(1, ""),
    usageSummary(),
    listUsage(1, "", "all"),
  ]);
  return <AdminView email={me.email} selfId={me.id} requests={requests} users={users} usageSummary={summary} usage={usage} />;
}
