"use client";

import { useState } from "react";
import { providersApi } from "@/lib/providers";

const input =
  "mt-2 w-full rounded-xl border border-border bg-paper px-3.5 py-2.5 text-[14px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-mist-300";

function KeyBox(props: { id: string; provider: string; title: string; body: string; placeholder: string; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await providersApi.saveKey(props.provider, key);
      setSaved(true);
      setKey("");
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      id={props.id}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="rounded-2xl border border-border bg-paper p-3.5"
    >
      <p id={`${props.id}-title`} className="text-[15px] font-medium text-text-primary">
        {props.title}
      </p>
      <p id={`${props.id}-body`} className="text-[13px] text-text-muted">
        {props.body}
      </p>
      {saved ? (
        <p id={`${props.id}-saved`} className="mt-2 text-xs text-success-fg">
          ✓ Key saved. Jev turns on within a minute.
        </p>
      ) : (
        <div id={`${props.id}-row`} className="flex items-end gap-2">
          <input
            id={`${props.id}-input`}
            type="password"
            autoComplete="off"
            aria-label={`${props.title} key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={props.placeholder}
            className={input}
          />
          <button
            id={`${props.id}-save`}
            type="submit"
            disabled={busy || !key.trim()}
            className="rounded-full bg-charcoal px-4 py-2.5 text-sm font-medium text-on-charcoal transition hover:opacity-85 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
      {error && (
        <p id={`${props.id}-error`} role="alert" className="mt-2 text-xs text-danger-fg">
          {error}
        </p>
      )}
    </form>
  );
}

export function JevSlide({ id, onSaved }: { id: string; onSaved: () => void }) {
  return (
    <div id={id} className="space-y-2.5">
      <KeyBox
        id={`${id}-openrouter`}
        provider="openrouter"
        title="Use OpenRouter (easiest)"
        body="One key also unlocks chat models like Claude and DeepSeek."
        placeholder="sk-or-…"
        onSaved={onSaved}
      />
      <KeyBox
        id={`${id}-typesafe`}
        provider="typesafe"
        title="Or a TypeSafe key"
        body="Calls Jev directly."
        placeholder="ts-…"
        onSaved={onSaved}
      />
      <p id={`${id}-legend`} className="text-[11px] text-text-muted">
        Keys stay on this computer. Skipping still works; picks are just less precise.
      </p>
    </div>
  );
}
