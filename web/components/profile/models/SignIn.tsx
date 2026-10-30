"use client";

import { useEffect, useState } from "react";
import { type LoginState, type ProviderView, providersApi } from "@/lib/providers";
import { input, solid } from "./styles";

export function SignIn({ p, pollMs, onDone, onCancel }: { p: ProviderView; pollMs: number; onDone: () => void; onCancel: () => void }) {
  const id = `provider-${p.id}-signin`;
  const [flow, setFlow] = useState<string | null>(null);
  const [state, setState] = useState<LoginState | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    providersApi
      .startLogin(p.id)
      .then((f) => alive && setFlow(f))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [p.id]);

  useEffect(() => {
    if (!flow) return;
    let alive = true;
    const poll = async () => {
      try {
        const s = await providersApi.loginState(flow);
        if (!alive) return;
        setState(s);
        if (s.status === "done") onDone();
        else if (s.status === "running") timer = setTimeout(poll, pollMs);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    let timer = setTimeout(poll, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [flow, pollMs, onDone]);

  const cancel = () => {
    if (flow && state?.status === "running") void providersApi.cancelLogin(flow).catch(() => {});
    onCancel();
  };

  const failure = error ?? (state?.status === "error" ? state.error : null);
  return (
    <div id={id} className="mt-3 space-y-2.5 rounded-xl bg-surface p-3">
      {!state?.authUrl && !failure && (
        <p id={`${id}-starting`} className="text-xs text-text-muted">
          Starting sign-in…
        </p>
      )}
      {state?.authUrl && (
        <div id={`${id}-open`} className="space-y-1.5">
          <a id={`${id}-link`} href={state.authUrl} target="_blank" rel="noopener noreferrer" className={`${solid} inline-block`}>
            Open ChatGPT sign-in ↗
          </a>
          <p id={`${id}-hint`} className="text-[11px] text-text-muted">
            Sign in on OpenAI&apos;s page. It uses your ChatGPT plan&apos;s included usage. This usually finishes on its own.
          </p>
        </div>
      )}
      {state?.prompt && (
        <form
          id={`${id}-answer-form`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!flow) return;
            providersApi.answerLogin(flow, answer).catch((err: Error) => setError(err.message));
          }}
          className="space-y-1.5"
        >
          <label id={`${id}-answer-label`} htmlFor={`${id}-answer`} className="block text-[11px] text-text-muted">
            {state.prompt.message}
          </label>
          <div id={`${id}-answer-row`} className="flex gap-2">
            <input
              id={`${id}-answer`}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={state.prompt.placeholder}
              className={input}
            />
            <button id={`${id}-answer-submit`} type="submit" disabled={!answer.trim()} className={solid}>
              Finish sign-in
            </button>
          </div>
        </form>
      )}
      {state?.progress && !failure && (
        <p id={`${id}-progress`} className="text-[11px] text-text-muted">
          {state.progress}
        </p>
      )}
      {failure && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-fg">
          {failure}
        </p>
      )}
      <button id={`${id}-cancel`} type="button" onClick={cancel} className="text-[11px] text-text-muted underline underline-offset-2">
        {failure ? "Close" : "Cancel"}
      </button>
    </div>
  );
}
