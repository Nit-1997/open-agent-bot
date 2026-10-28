"use client";

import { ArrowUp, Square } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

export function Composer(props: { running: boolean; onSend: (text: string) => void; onStop: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
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

  return (
    <form
      id="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="flex items-end gap-2 rounded-[20px] border border-border bg-paper p-1.5 pl-3.5 shadow-float transition focus-within:border-mist-500 focus-within:ring-2 focus-within:ring-mist-300/60 sm:rounded-[22px] sm:p-2 sm:pl-4"
    >
      <label id="composer-label" htmlFor="composer-input" className="sr-only">
        Message
      </label>
      <textarea
        id="composer-input"
        ref={ref}
        rows={1}
        value={text}
        autoFocus={props.autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Ask me to research, compare, or plan…"
        className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-6 text-text-primary outline-none placeholder:text-text-muted sm:py-2 sm:text-[15px]"
      />
      {props.running ? (
        <button id="composer-stop" type="button" onClick={props.onStop} aria-label="Stop" className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-on-charcoal transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500">
          <Square id="composer-stop-icon" aria-hidden="true" size={12} fill="currentColor" />
        </button>
      ) : (
        <button
          id="composer-send"
          type="submit"
          aria-label="Send"
          disabled={!text.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-charcoal text-on-charcoal transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 disabled:bg-surface-accent disabled:text-text-faint"
        >
          <ArrowUp id="composer-send-icon" aria-hidden="true" size={18} />
        </button>
      )}
    </form>
  );
}
