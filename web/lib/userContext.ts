export type UserContext = { timeZone: string; locale: string; localTime: string };

const pad = (n: number) => String(n).padStart(2, "0");

export function getUserContext(now: Date = new Date()): UserContext {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    localTime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
}
