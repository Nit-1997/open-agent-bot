import type { AgentLook } from "@shared/profile";

export type OrbSize = 22 | 26 | 28 | 30 | 36 | 40 | 44 | 72 | 112;

const SIZE: Record<OrbSize, string> = {
  22: "h-[22px] w-[22px]",
  26: "h-[26px] w-[26px]",
  28: "h-7 w-7",
  30: "h-[30px] w-[30px]",
  36: "h-9 w-9",
  40: "h-10 w-10",
  44: "h-11 w-11",
  72: "h-[72px] w-[72px] orb-glow",
  112: "h-28 w-28 orb-glow",
};

export function AgentOrb(props: { id: string; look: AgentLook; size: OrbSize; breathing?: boolean; className?: string }) {
  return (
    <span
      id={props.id}
      aria-hidden="true"
      data-look={props.look}
      className={`orb inline-block shrink-0 ${SIZE[props.size]} ${props.breathing ? "animate-breathe" : ""} ${props.className ?? ""}`}
    />
  );
}
