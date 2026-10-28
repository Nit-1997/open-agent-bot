import type { Profile } from "./profile";

export type UserContext = {
  timeZone: string;
  locale: string;
  localTime: string;
  model?: string;
  viewport?: { width: number; height: number };
  profile?: Pick<Profile, "name" | "home" | "interests" | "notes">;
};

const pad = (n: number) => String(n).padStart(2, "0");

type Extras = { model?: string; profile?: Profile };

export function withChat(base: UserContext, { model, profile: p }: Extras): UserContext {
  return {
    ...base,
    ...(model && { model }),
    ...(p && { profile: { name: p.name, home: p.home, interests: p.interests, notes: p.notes } }),
  };
}

export function getUserContext(now: Date = new Date(), extras: Extras = {}): UserContext {
  return withChat(
    {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      localTime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    extras,
  );
}
