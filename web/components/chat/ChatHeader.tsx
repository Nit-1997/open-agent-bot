import type { AgentPersona } from "@shared/profile";
import { AgentOrb } from "@/components/agent/AgentOrb";

export const UNTITLED = "Untitled chat";

export function ChatHeader(props: { id: string; title: string; running: boolean; persona: AgentPersona }) {
  const { id } = props;
  const title = props.title.trim() || UNTITLED;
  return (
    <header id={id} className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-surface-accent px-6 lg:px-7">
      <h1 id={`${id}-title`} title={title} className="min-w-0 truncate font-display text-[26px] leading-none text-text-primary">
        <bdi id={`${id}-title-text`}>{title}</bdi>
      </h1>
      {props.running && (
        <p id={`${id}-status`} role="status" className="flex shrink-0 items-center gap-2 text-[13px] text-text-muted">
          <AgentOrb id={`${id}-status-orb`} look={props.persona.look} name={props.persona.name} size={22} breathing />
          <span id={`${id}-status-text`}>
            <bdi id={`${id}-status-name`}>{props.persona.name}</bdi> is working on this
          </span>
        </p>
      )}
    </header>
  );
}
