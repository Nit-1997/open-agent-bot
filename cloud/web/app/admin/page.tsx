import { AdminView } from "@/components/admin/AdminView";
import { requireAdmin } from "@/lib/auth";
import { listRequests, listUsers } from "./actions";

export default async function AdminPage() {
  const me = await requireAdmin();
  const [requests, users] = await Promise.all([listRequests("pending", 1), listUsers(1, "")]);
  return <AdminView email={me.email} selfId={me.id} requests={requests} users={users} />;
}
