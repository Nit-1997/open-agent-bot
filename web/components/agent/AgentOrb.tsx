import type { AgentLook } from "@shared/profile";
import { initials } from "@/lib/profile";

export type OrbSize = 22 | 26 | 28 | 30 | 36 | 40 | 44 | 72 | 112;

const SIZE: Record<OrbSize, string> = {
  22: "h-[22px] w-[22px] text-[9px]",
  26: "h-[26px] w-[26px] text-[10px]",
  28: "h-7 w-7 text-[11px]",
  30: "h-[30px] w-[30px] text-[11px]",
  36: "h-9 w-9 text-[13px]",
  40: "h-10 w-10 text-sm",
  44: "h-11 w-11 text-[15px]",
  72: "h-[72px] w-[72px] text-2xl orb-glow",
  112: "h-28 w-28 text-4xl orb-glow",
};

export function AgentOrb(props: { id: string; look: AgentLook; size: OrbSize; name?: string; breathing?: boolean; className?: string }) {
  return (
    <span
      id={props.id}
      aria-hidden="true"
      data-look={props.look}
      className={`orb inline-flex shrink-0 items-center justify-center font-semibold leading-none ${SIZE[props.size]} ${props.breathing ? "animate-breathe" : ""} ${props.className ?? ""}`}
    >
      {initials(props.name)}
    </span>
  );
}
