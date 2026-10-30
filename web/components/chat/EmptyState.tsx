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
    <div id="empty-state" className="mx-auto flex w-full max-w-[680px] flex-1 flex-col justify-center px-3 py-5 sm:px-4 sm:py-10">
      <p id="empty-eyebrow" className="eyebrow hidden sm:block">
        Open Agent
      </p>
      <h2
        id="empty-title"
        className="font-display text-[30px] leading-[1.1] text-text-primary text-balance sm:mt-3 sm:text-[56px] sm:leading-[1.05]"
      >
        {`${greeting(new Date().getHours())}${name ? `, ${name}` : ""}.`}
        <br />
        <span id="empty-title-sub" className="italic text-text-muted">
          What should I look into?
        </span>
      </h2>
      <ul id="empty-suggestions" aria-label="Suggestions" className="mt-5 grid grid-cols-2 gap-2 sm:mt-8 sm:gap-2.5">
        {SUGGESTIONS.map((s, i) => (
          <li id={`empty-suggestion-${i}`} key={s.label}>
            <button
              id={`empty-suggestion-${i}-button`}
              type="button"
              onClick={() => onPick(s.text)}
              className="group flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-border bg-paper p-3 text-left transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 sm:flex-row sm:gap-3 sm:p-3.5"
            >
              <span
                id={`empty-suggestion-${i}-icon`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface text-text-primary sm:h-8 sm:w-8 sm:rounded-xl"
              >
                <s.icon id={`empty-suggestion-${i}-svg`} aria-hidden="true" size={16} />
              </span>
              <span id={`empty-suggestion-${i}-text`} className="min-w-0">
                <span id={`empty-suggestion-${i}-label`} className="eyebrow block">
                  {s.label}
                </span>
                <span
                  id={`empty-suggestion-${i}-prompt`}
                  className="mt-1 line-clamp-3 text-[13px] leading-snug text-text-secondary group-hover:text-text-primary sm:line-clamp-none sm:text-sm"
                >
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
