import { validateWidget } from "@shared/widgets";
import { AskCard } from "./AskCard";
import { type CartEdits, CartCard } from "./CartCard";
import { FlightList } from "./FlightList";
import { GroundingNote } from "./GroundingNote";
import { UiCard } from "./UiCard";
import { WeatherCard } from "./WeatherCard";

export function WidgetRenderer(props: { toolCallId: string; args: unknown; locale: string; answered?: boolean; onAnswer?: (text: string) => void; staleCart?: boolean; onCartEdit?: (e: CartEdits) => void }) {
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
    case "cart":
      return <CartCard toolCallId={toolCallId} widget={w} stale={props.staleCart} onEdit={props.staleCart ? undefined : props.onCartEdit} />;
  }
}
