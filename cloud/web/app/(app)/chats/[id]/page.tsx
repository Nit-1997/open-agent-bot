import { normalizeId } from "@oab/shared/ids";
import { RouteView } from "@oab/ui/views/RouteView.tsx";
import { notFound } from "next/navigation";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const chatId = normalizeId((await params).id);
  if (!chatId) notFound();
  return <RouteView route={{ section: "chat", chatId, report: null }} />;
}
