"use client";

import { AGENT_NAME_MAX, AGENT_NAME_SUGGESTIONS } from "@shared/profile";

export function AgentNameField(props: { id: string; value: string; error: string | null; onChange: (raw: string) => void }) {
  const { id, error } = props;
  return (
    <div id={id} className="flex flex-col gap-2">
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="eyebrow text-text-muted">
        <span id={`${id}-label-prefix`} className="sr-only">
          {"Agent "}
        </span>
        Name
      </label>
      <input
        id={`${id}-input`}
        type="text"
        value={props.value}
        maxLength={AGENT_NAME_MAX}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
        className="h-12 rounded-[14px] border border-border bg-surface px-4 text-[16px] text-text-primary outline-none transition focus:border-mist-500 aria-invalid:border-danger-fg"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-danger-fg">
          {error}
        </p>
      )}
      <div id={`${id}-suggestions`} role="group" aria-label="Suggested agent names" className="flex flex-wrap gap-2">
        {AGENT_NAME_SUGGESTIONS.map((name) => (
          <button
            id={`${id}-suggestion-${name.toLowerCase()}`}
            key={name}
            type="button"
            onClick={() => props.onChange(name)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] text-text-secondary transition hover:border-border-strong hover:text-text-primary"
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
