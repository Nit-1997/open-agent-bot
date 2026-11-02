"use client";

import { type AgentLook, type AgentTone, agentPersona, checkAgentName, type Profile } from "@shared/profile";
import { useState } from "react";
import { AgentOrb } from "./AgentOrb";
import { AgentNameField } from "./AgentNameField";
import { LookPicker } from "./LookPicker";
import { TonePicker } from "./TonePicker";

type Agent = NonNullable<Profile["agent"]>;

export function AgentSection(props: {
  scope: "onboarding" | "profile";
  agent: Agent | undefined;
  onChange: (agent: Agent) => void;
  onValidity: (valid: boolean) => void;
}) {
  const id = `agent-section-${props.scope}`;
  const persona = agentPersona({ agent: props.agent });
  const [raw, setRaw] = useState(persona.name);
  const check = checkAgentName(raw);
  const error = check.ok ? null : check.error;
  const shownName = check.ok ? check.name : persona.name;

  const setName = (next: string) => {
    setRaw(next);
    const r = checkAgentName(next);
    props.onValidity(r.ok);
    if (r.ok) props.onChange({ ...persona, name: r.name });
  };
  const setLook = (look: AgentLook) => props.onChange({ ...persona, look });
  const setTone = (tone: AgentTone) => props.onChange({ ...persona, tone });

  return (
    <div id={id} className="flex flex-col gap-6">
      {props.scope === "onboarding" && (
        <div id={`${id}-hero`} className="flex flex-col items-center gap-3 py-1 text-center">
          <AgentOrb id={`${id}-orb`} look={persona.look} name={persona.name} size={112} breathing />
          <h1 id={`${id}-title`} className="font-display text-[34px] leading-[1.1] text-text-primary">
            {"Hi, I'm "}
            <em id={`${id}-title-name`}>
              <bdi id={`${id}-title-bdi`}>{shownName}</bdi>
            </em>
            .
          </h1>
          <p id={`${id}-sub`} className="max-w-[420px] text-[14px] leading-relaxed text-text-muted">
            I&apos;ll research, compare and plan for you. Give me a name and a look you&apos;ll recognise.
          </p>
        </div>
      )}
      <AgentNameField id={`${id}-name`} value={raw} error={error} onChange={setName} />
      <LookPicker id={`${id}-look`} value={persona.look} onChange={setLook} />
      <TonePicker id={`${id}-tone`} name={shownName} value={persona.tone} onChange={setTone} />
    </div>
  );
}
