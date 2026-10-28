import { validateWidget } from "@shared/widgets";
import { FlightList } from "./FlightList";
import { GroundingNote } from "./GroundingNote";
import { UiCard } from "./UiCard";
import { WeatherCard } from "./WeatherCard";

export function WidgetRenderer({ toolCallId, args, locale }: { toolCallId: string; args: unknown; locale: string }) {
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
  }
}
