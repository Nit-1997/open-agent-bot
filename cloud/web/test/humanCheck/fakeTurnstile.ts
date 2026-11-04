import { vi } from "vitest";
import type { TurnstileApi } from "@/components/auth/Turnstile";

export const LOCAL_SUPABASE = "http://127.0.0.1:18741";
export const PASS_SITE_KEY = "1x00000000000000000000AA";

type Rendered = { el: HTMLElement; sitekey: string; action: string; callback: (t: string) => void; error: () => void; expired: () => void };

export function installFakeTurnstile() {
  const rendered: Rendered[] = [];
  const removed: string[] = [];
  const api: TurnstileApi = {
    render: vi.fn((el, opts) => {
      rendered.push({
        el,
        sitekey: opts.sitekey,
        action: opts.action,
        callback: opts.callback,
        error: opts["error-callback"],
        expired: opts["expired-callback"],
      });
      return `w${rendered.length}`;
    }),
    remove: vi.fn((id: string) => void removed.push(id)),
  };
  window.turnstile = api;
  return { api, rendered, removed, last: () => rendered.at(-1)! };
}

export function stubSiteKey(key = PASS_SITE_KEY, supabaseUrl = LOCAL_SUPABASE) {
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", key);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
}
