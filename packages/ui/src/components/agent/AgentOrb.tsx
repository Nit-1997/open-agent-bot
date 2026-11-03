import type { AgentLook } from "@oab/shared/profile";
import { initials } from "../../lib/profile.ts";

export type OrbSize = 22 | 26 | 28 | 30 | 36 | 40 | 44 | 72 | 112;

const SIZE: Record<OrbSize, string> = {
  22: "h-[22px] w-[22px] text-[9px]",
  26: "h-[26px] w-[26px] text-[10px]",
  28: "h-7 w-7 text-[11px]",
  30: "h-[30px] w-[30px] text-[11px]",
  36: "h-9 w-9 text-[13px]",
  40: "h-10 w-10 text-sm",
  44: "h-11 w-11 text-[15px]",
  72: "h-[72px] w-[72px] orb-glow",
  112: "h-28 w-28 orb-glow",
};

const DISPLAY_CLASS = /(^|\s)(hidden|block|inline-block|flex|inline-flex)(\s|$)/;

export function AgentOrb(props: { id: string; look: AgentLook; size: OrbSize; name?: string; breathing?: boolean; className?: string }) {
  const dp = props.name !== undefined;
  const display = DISPLAY_CLASS.test(props.className ?? "") ? "" : dp ? "inline-flex" : "inline-block";
  return (
    <span
      id={props.id}
      aria-hidden="true"
      data-look={props.look}
      className={`${dp ? "agent-dp items-center justify-center font-semibold leading-none" : "orb"} ${display} shrink-0 ${SIZE[props.size]} ${props.breathing ? "animate-breathe" : ""} ${props.className ?? ""}`}
    >
      {dp ? initials(props.name) : null}
    </span>
  );
}
