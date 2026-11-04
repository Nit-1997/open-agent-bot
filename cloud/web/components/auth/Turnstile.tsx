"use client";

import { useEffect, useRef } from "react";
import { TURNSTILE_SCRIPT } from "@/lib/turnstile";

export type TurnstileAction = "human_check" | "email_link";

type RenderOptions = {
  sitekey: string;
  action: TurnstileAction;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "refresh-expired": "auto" | "manual" | "never";
};

export type TurnstileApi = {
  render(el: HTMLElement, opts: RenderOptions): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "turnstile-api-script";
let loading: Promise<TurnstileApi> | undefined;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    loading = undefined;
    document.getElementById(SCRIPT_ID)?.remove();
    throw err;
  });
  return loading;
}

export type TurnstileProps = {
  id: string;
  siteKey: string;
  action: TurnstileAction;
  onToken: (token: string) => void;
  onError: () => void;
  onExpire?: () => void;
};

export function Turnstile({ id, siteKey, action, onToken, onError, onExpire }: TurnstileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onToken, onError, onExpire });
  useEffect(() => {
    handlers.current = { onToken, onError, onExpire };
  });

  useEffect(() => {
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    let gone = false;
    loadTurnstile()
      .then((t) => {
        if (gone || !ref.current) return;
        api = t;
        widget = t.render(ref.current, {
          sitekey: siteKey,
          action,
          callback: (token) => handlers.current.onToken(token),
          "error-callback": () => handlers.current.onError(),
          "expired-callback": () => handlers.current.onExpire?.(),
          "refresh-expired": "auto",
        });
      })
      .catch(() => {
        if (!gone) handlers.current.onError();
      });
    return () => {
      gone = true;
      if (api && widget !== undefined) api.remove(widget);
    };
  }, [siteKey, action]);

  return <div id={id} ref={ref} data-action={action} className="flex min-h-[65px] justify-center" />;
}
