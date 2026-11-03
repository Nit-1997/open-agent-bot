import { normalizeId } from "@oab/shared/ids";
import { notFound } from "next/navigation";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  if (!normalizeId((await params).id)) notFound();
  return null;
}
