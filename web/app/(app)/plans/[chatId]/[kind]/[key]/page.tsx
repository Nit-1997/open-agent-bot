import { parseRoute } from "@shared/routes";
import { notFound } from "next/navigation";
import { PlanDetail } from "@/components/plans/PlanDetail";

export default async function PlanPage({ params }: { params: Promise<{ chatId: string; kind: string; key: string }> }) {
  const { chatId, kind, key } = await params;
  const route = parseRoute(`/plans/${chatId}/${kind}/${key}`);
  if (route?.section !== "plan") notFound();
  return <PlanDetail key={`${route.chatId}/${route.kind}/${route.key}`} chatId={route.chatId} kind={route.kind} planKey={route.key} />;
}
