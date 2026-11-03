export type UserContext = {
  timeZone: string;
  locale: string;
  localTime: string;
  model?: string;
  viewport?: { width: number; height: number };
};

const pad = (n: number) => String(n).padStart(2, "0");

export function withChat(base: UserContext, { model }: { model?: string }): UserContext {
  return { ...base, ...(model && { model }) };
}

export function getUserContext(now: Date = new Date(), extras: { model?: string } = {}): UserContext {
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
