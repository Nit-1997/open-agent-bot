import type { WeatherCard as WeatherCardData } from "@shared/widgets";
import { Card } from "./Card";

export function WeatherCard({ toolCallId, widget }: { toolCallId: string; widget: WeatherCardData }) {
  const id = `weather-card-${toolCallId}`;
  const deg = widget.units === "imperial" ? "°F" : "°C";
  return (
    <Card id={id} title={widget.location} subtitle={`Source: ${widget.source}`}>
      <div id={`${id}-now`} className="mt-2 flex items-baseline gap-2">
        <span id={`${id}-temp`} className="text-3xl font-semibold">{`${Math.round(widget.current.temp)}${deg}`}</span>
        <span id={`${id}-condition`} className="text-sm text-neutral-600 dark:text-neutral-300">
          {widget.current.condition}
        </span>
      </div>
      <ul id={`${id}-days`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {widget.days.map((d, i) => (
          <li id={`${id}-day-${i}`} key={d.date} className="rounded-lg bg-neutral-100 p-2 text-sm dark:bg-neutral-800">
            <span id={`${id}-day-${i}-date`} className="block font-medium">
              {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span id={`${id}-day-${i}-range`} className="block">{`${Math.round(d.low)}–${Math.round(d.high)}${deg}`}</span>
            <span id={`${id}-day-${i}-condition`} className="block text-xs text-neutral-500">
              {d.condition}
              {d.precipChance != null ? ` · ${d.precipChance}% rain` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
