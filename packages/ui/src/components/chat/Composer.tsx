"use client";

import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

export function Composer(props: {
  id: string;
  placeholder: string;
  label: string;
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  autoFocus?: boolean;
  initialText?: string;
  accessory?: ReactNode;
}) {
  const [text, setText] = useState(props.initialText ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || props.running) return;
    props.onSend(t);
    setText("");
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const id = props.id;
  return (
    <form
      id={id}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex flex-col gap-1 rounded-[20px] border border-border bg-paper p-2 pl-3.5 shadow-float transition focus-within:border-mist-500 focus-within:ring-2 focus-within:ring-mist-300/60 sm:rounded-[22px] sm:pl-4"
    >
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="sr-only">
        {props.label}
      </label>
      <textarea
        id={`${id}-input`}
        ref={ref}
        rows={1}
        value={text}
        autoFocus={props.autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={props.placeholder}
        className="max-h-[200px] w-full resize-none bg-transparent pt-1.5 pr-1.5 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted sm:pt-2 sm:text-[15px]"
      />
      <div id={`${id}-toolbar`} className="flex items-center justify-end gap-1.5">
        {props.accessory}
        {props.running ? (
          <button
            id={`${id}-stop`}
            type="button"
            onClick={props.onStop}
            aria-label="Stop"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-on-charcoal transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500"
          >
            <Square id={`${id}-stop-icon`} aria-hidden="true" size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            id={`${id}-send`}
            type="submit"
            aria-label="Send"
            disabled={!text.trim()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-on-charcoal transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 disabled:bg-surface-accent disabled:text-text-faint"
          >
            <ArrowUp id={`${id}-send-icon`} aria-hidden="true" size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
