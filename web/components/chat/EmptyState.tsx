import type { AgentPersona } from "@shared/profile";
import { PartyPopper, Plane, ShoppingBag, Telescope } from "lucide-react";
import { AgentOrb } from "@/components/agent/AgentOrb";

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

export function EmptyState(props: {
  id: string;
  name?: string;
  persona: AgentPersona;
  heading: "h1" | "h2";
  memory: string | null;
  onOpenProfile: () => void;
  onPick: (text: string) => void;
}) {
  const { id, name, persona } = props;
  const Heading = props.heading;
  return (
    <div id={id} className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-3 py-5 sm:px-6 sm:py-10">
      <div id={`${id}-hero`} className="flex flex-col items-center gap-3 text-center sm:gap-3.5">
        <AgentOrb id={`${id}-orb`} look={persona.look} size={72} className="hidden sm:inline-block" />
        <AgentOrb id={`${id}-orb-small`} look={persona.look} size={44} className="sm:hidden" />
        <Heading
          id={`${id}-title`}
          className="font-display text-[30px] leading-[1.1] text-text-primary text-balance sm:text-[44px] sm:leading-[1.1]"
        >
          {`${greeting(new Date().getHours())}${name ? `, ${name}` : ""}. `}
          <span id={`${id}-title-sub`} className="italic text-text-muted">
            What should I look into?
          </span>
        </Heading>
        {props.memory ? (
          <p id={`${id}-memory`} className="max-w-[560px] text-[14px] leading-relaxed text-text-muted">
            {props.memory}
          </p>
        ) : (
          <p id={`${id}-memory`} className="max-w-[560px] text-[14px] leading-relaxed text-text-muted">
            <span id={`${id}-memory-text`}>
              {"Tell "}
              <bdi id={`${id}-memory-name`}>{persona.name}</bdi>
              {" about yourself in your profile so plans start from your home and tastes. "}
            </span>
            <button
              id={`${id}-memory-open`}
              type="button"
              onClick={props.onOpenProfile}
              className="text-mist-600 underline underline-offset-2 hover:text-text-primary"
            >
              Open profile
            </button>
          </p>
        )}
      </div>
      <ul id={`${id}-suggestions`} aria-label="Suggestions" className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:gap-3">
        {SUGGESTIONS.map((s, i) => (
          <li id={`${id}-suggestion-${i}`} key={s.label}>
            <button
              id={`${id}-suggestion-${i}-button`}
              type="button"
              onClick={() => props.onPick(s.text)}
              className="group flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-surface-accent bg-surface p-3 text-left transition hover:-translate-y-0.5 hover:border-border hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 sm:p-4"
            >
              <span id={`${id}-suggestion-${i}-head`} className="flex items-center gap-2">
                <s.icon id={`${id}-suggestion-${i}-svg`} aria-hidden="true" size={14} className="text-text-faint" />
                <span id={`${id}-suggestion-${i}-label`} className="eyebrow">
                  {s.label}
                </span>
              </span>
              <span
                id={`${id}-suggestion-${i}-prompt`}
                className="line-clamp-3 text-[13px] leading-snug text-text-primary sm:line-clamp-none sm:text-[14px] sm:leading-[1.45]"
              >
                {s.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
