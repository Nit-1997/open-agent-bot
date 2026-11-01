"use client";

import { Plus } from "lucide-react";
import { useShell } from "./ShellProvider";

export function NewChatButton(props: { id: string; variant: "round" | "row"; onDone?: () => void }) {
  const { newChat } = useShell();
  const click = () => {
    props.onDone?.();
    newChat();
  };
  if (props.variant === "round")
    return (
      <button
        id={props.id}
        type="button"
        aria-label="New chat"
        title="New chat"
        onClick={click}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-charcoal text-on-charcoal shadow-float transition hover:opacity-85"
      >
        <Plus id={`${props.id}-icon`} aria-hidden="true" size={18} strokeWidth={2} />
      </button>
    );
  return (
    <button
      id={props.id}
      type="button"
      onClick={click}
      className="flex h-12 w-full items-center gap-2.5 rounded-[14px] bg-charcoal px-3.5 text-[15px] font-medium text-on-charcoal transition hover:opacity-85"
    >
      <Plus id={`${props.id}-icon`} aria-hidden="true" size={18} strokeWidth={2} />
      New chat
    </button>
  );
}
