import { validateWidget } from "@shared/widgets";
import type { CartEdits, PlanEdits } from "@shared/workspace";
import { AskCard } from "./AskCard";
import { CartCard } from "./CartCard";
import { FlightList } from "./FlightList";
import { GroundingNote } from "./GroundingNote";
import { PlanCard } from "./PlanCard";
import { StayList } from "./StayList";
import { UiCard } from "./UiCard";
import { WeatherCard } from "./WeatherCard";

export function WidgetRenderer(props: { toolCallId: string; args: unknown; locale: string; answered?: boolean; onAnswer?: (text: string) => void; staleCart?: boolean; onCartEdit?: (e: CartEdits) => void; stalePlan?: boolean; onPlanEdit?: (e: PlanEdits) => void }) {
  const { toolCallId, args, locale } = props;
  const r = validateWidget((args as { widget?: unknown } | undefined)?.widget);
  if (!r.ok) return null;
  const w = r.value;
  switch (w.kind) {
    case "weather_card":
      return <WeatherCard toolCallId={toolCallId} widget={w} />;
    case "flight_list":
      return <FlightList toolCallId={toolCallId} widget={w} locale={locale} />;
    case "ui":
      return <UiCard toolCallId={toolCallId} widget={w} />;
    case "grounding_note":
      return <GroundingNote toolCallId={toolCallId} widget={w} />;
    case "ask":
      return <AskCard toolCallId={toolCallId} widget={w} locale={locale} answered={props.answered} onAnswer={props.onAnswer} />;
    case "followups":
      return null;
    case "stay_list":
      return <StayList toolCallId={toolCallId} widget={w} locale={locale} />;
    case "plan":
      return <PlanCard toolCallId={toolCallId} widget={w} stale={props.stalePlan} onEdit={props.stalePlan ? undefined : props.onPlanEdit} />;
    case "cart":
      return <CartCard toolCallId={toolCallId} widget={w} locale={locale} stale={props.staleCart} onEdit={props.staleCart ? undefined : props.onCartEdit} />;
  }
}
