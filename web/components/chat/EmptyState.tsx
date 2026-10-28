import { PartyPopper, Plane, ShoppingBag, Telescope } from "lucide-react";

const SUGGESTIONS = [
  { icon: PartyPopper, label: "Plan", text: "Plan a Diwali party for 20 people at my place this Saturday" },
  { icon: ShoppingBag, label: "Shop", text: "Compare noise-cancelling headphones under $300 and where they're in stock" },
  { icon: Telescope, label: "Research", text: "Research the best indoor plants for low light and make me a one-page guide" },
  { icon: Plane, label: "Travel", text: "Find flights from SFO to Nashville next Friday and the weather there" },
];

function greeting(hour: number) {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function EmptyState({ name, onPick }: { name?: string; onPick: (text: string) => void }) {
  return (
    <div id="empty-state" className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-4 py-10">
      <p id="empty-eyebrow" className="eyebrow">
        Open Agent
      </p>
      <h2 id="empty-title" className="mt-3 font-display text-[44px] leading-[1.05] text-text-primary sm:text-[56px]">
        {`${greeting(new Date().getHours())}${name ? `, ${name}` : ""}.`}
        <br />
        <span id="empty-title-sub" className="italic text-text-muted">
          What should I look into?
        </span>
      </h2>
      <ul id="empty-suggestions" className="mt-8 grid gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => (
          <li id={`empty-suggestion-${i}`} key={s.label}>
            <button
              id={`empty-suggestion-${i}-button`}
              type="button"
              onClick={() => onPick(s.text)}
              className="group flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-paper p-3.5 text-left transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float"
            >
              <span id={`empty-suggestion-${i}-icon`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface text-text-primary">
                <s.icon id={`empty-suggestion-${i}-svg`} aria-hidden="true" size={16} />
              </span>
              <span id={`empty-suggestion-${i}-text`} className="min-w-0">
                <span id={`empty-suggestion-${i}-label`} className="eyebrow block">
                  {s.label}
                </span>
                <span id={`empty-suggestion-${i}-prompt`} className="mt-1 block text-sm leading-snug text-text-secondary group-hover:text-text-primary">
                  {s.text}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
