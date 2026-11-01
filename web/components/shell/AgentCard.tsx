"use client";

import { AgentOrb } from "@/components/agent/AgentOrb";
import { knowsSummary } from "@/lib/persona";
import { useShell } from "./ShellProvider";

export function AgentCard({ id }: { id: string }) {
  const { persona, profile, open } = useShell();
  const knows = knowsSummary(profile);
  const line = knows ? `Your agent · knows ${knows.text}` : "Your agent · tell it about you";
  return (
    <button
      id={id}
      type="button"
      title={knows ? `Your agent knows ${knows.full}` : undefined}
      onClick={() => open("profile", { focus: "agent" })}
      className="mt-auto flex w-full items-center gap-2.5 rounded-2xl border border-surface-accent bg-surface p-3 text-left transition hover:border-border"
    >
      <AgentOrb id={`${id}-orb`} look={persona.look} size={36} />
      <span id={`${id}-text`} className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-name`} className="truncate text-[14px] font-semibold text-text-primary">
          <bdi id={`${id}-name-bdi`}>{persona.name}</bdi>
        </span>
        <span id={`${id}-knows`} className="truncate text-[12px] text-text-muted">
          {line}
        </span>
      </span>
    </button>
  );
}
