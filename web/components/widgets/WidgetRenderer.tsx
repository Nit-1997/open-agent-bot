import { validateWidget } from "@shared/widgets";
import { FlightList } from "./FlightList";
import { PlanChecklist } from "./PlanChecklist";
import { ProductComparison } from "./ProductComparison";
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
    case "product_comparison":
      return <ProductComparison toolCallId={toolCallId} widget={w} locale={locale} />;
    case "plan_checklist":
      return <PlanChecklist toolCallId={toolCallId} widget={w} />;
  }
}
