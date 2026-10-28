import type { WeatherCard as WeatherCardData } from "@shared/widgets";

export function WeatherCard({ toolCallId, widget }: { toolCallId: string; widget: WeatherCardData }) {
  const id = `weather-card-${toolCallId}`;
  const deg = widget.units === "imperial" ? "°F" : "°C";
  const typical = widget.mode === "typical";
  return (
    <section id={id} className="w-full rounded-2xl border border-border bg-paper p-4">
      <div id={`${id}-head`} className="flex items-start justify-between gap-3">
        <div id={`${id}-titles`} className="min-w-0">
          <h3 id={`${id}-title`} className="text-[17px] font-medium text-text-primary">
            {widget.location}
          </h3>
          <p id={`${id}-subtitle`} className="text-xs text-text-muted">
            {typical ? `Averaged over ${widget.basis ?? "past years"} · Open-Meteo` : "Forecast · Open-Meteo"}
          </p>
        </div>
        {typical && (
          <span id={`${id}-badge`} className="shrink-0 rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-medium text-warn-fg">
            Typical, not a forecast
          </span>
        )}
      </div>
      {widget.current && (
        <div id={`${id}-now`} className="mt-2 flex items-baseline gap-2">
          <span id={`${id}-temp`} className="text-3xl font-semibold">{`${Math.round(widget.current.temp)}${deg}`}</span>
          <span id={`${id}-condition`} className="text-sm text-text-secondary">
            {widget.current.condition}
          </span>
        </div>
      )}
      <ul id={`${id}-days`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {widget.days.map((d, i) => (
          <li id={`${id}-day-${i}`} key={d.date} className="rounded-xl bg-surface p-2.5 text-sm">
            <span id={`${id}-day-${i}-date`} className="block font-medium">
              {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </span>
            <span id={`${id}-day-${i}-range`} className="block">{`${Math.round(d.low)}–${Math.round(d.high)}${deg}`}</span>
            <span id={`${id}-day-${i}-condition`} className="block text-xs text-text-muted">
              {typical ? `Usually ${d.condition.toLowerCase()}` : d.condition}
              {d.precipChance != null ? (typical ? ` · rain ${d.precipChance}% of past years` : ` · ${d.precipChance}% rain`) : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
