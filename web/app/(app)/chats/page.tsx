import { parsePage } from "@oab/shared/pages";
import { ChatsView } from "@/components/chat/ChatsView";

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const raw = (await searchParams).page;
  return <ChatsView page={parsePage(Array.isArray(raw) ? raw[0] : raw) ?? 1} />;
}
