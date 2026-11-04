import type { RunRefusal } from "@oab/shared/runRefusals";
import { nextUtcMonth } from "@oab/shared/usage";

export const DESKTOP_URL = "https://github.com/Nit-1997/open-agent-bot/releases/latest";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const utcParts = (iso: string) => {
  const d = new Date(iso);
  return { day: d.getUTCDate(), month: MONTHS[d.getUTCMonth()] };
};

export function shortUtcDay(iso: string): string {
  const { day, month } = utcParts(iso);
  return `${day} ${month.slice(0, 3)}`;
}

export function longUtcDay(iso: string): string {
  const { day, month } = utcParts(iso);
  return `${day} ${month}`;
}

const requests = (n: number) => (n === 1 ? "request" : "requests");
const seconds = (n: number) => `${n} ${n === 1 ? "second" : "seconds"}`;

export const METER_COPY = Object.freeze({
  label: "This month",
  reset: (resetsAt: string) => `resets ${shortUtcDay(resetsAt)}`,
  resetHint: "00:00 UTC",
  barLabel: "Requests used this month",
  count: (used: number, limit: number) => `${used} of ${limit} requests used`,
  low: (left: number) => `${left} ${requests(left)} left this month.`,
  macLead: "Want no limits? ",
  macLink: "Run Open Agent on your own Mac",
  macTail: ". It's free and open source.",
  exhausted: (resetsAt: string) => `Requests open again on ${longUtcDay(resetsAt)}.`,
  check: "One quick check before your first message",
  unavailable: "Usage unavailable",
  retry: "Retry",
});

export type MeterLevel = "normal" | "low" | "exhausted";

export function meterLevel(used: number, limit: number): MeterLevel {
  const left = limit - used;
  if (left <= 0) return "exhausted";
  return left * 5 <= limit ? "low" : "normal";
}

export const NOTICE_COPY = Object.freeze({ sendAgain: "Send again", dismiss: "Dismiss", macLink: "Run it on your Mac" });

export type NoticeCopy = {
  title: string;
  body: string;
  countdown: boolean;
  sendAgain: "countdown" | "now" | "none";
  macLink: boolean;
};

export function secondsUntil(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function retryDeadline(refusal: RunRefusal, receivedAt: number): number {
  const at = refusal.retryAt ? Date.parse(refusal.retryAt) : Number.NaN;
  if (Number.isFinite(at)) return at;
  return receivedAt + (refusal.retryAfter ?? 0) * 1000;
}

export const countdownText = (left: number) => (left > 0 ? `You can send again in ${seconds(left)}.` : "You can send again now.");

const waitThenSend = (title: string, body: string): NoticeCopy => ({
  title,
  body,
  countdown: true,
  sendAgain: "countdown",
  macLink: false,
});

function runningBody(limit: number): string {
  return limit === 1
    ? "You can run one chat at a time. Wait for the other one to finish or stop it."
    : `You can run ${limit} chats at a time. Wait for one of the others to finish or stop it.`;
}

export function refusalCopy(refusal: RunRefusal, secondsAtReceipt: number, now: number): NoticeCopy {
  switch (refusal.code) {
    case "limit_monthly": {
      const cap = refusal.limit;
      const opens = refusal.retryAt ?? nextUtcMonth(now).toISOString();
      return {
        title: cap === undefined ? "You've used this month's requests" : `You've used this month's ${cap} ${requests(cap)}`,
        body: `Your chats and reports are still here. Requests open again on ${longUtcDay(opens)}.`,
        countdown: false,
        sendAgain: "none",
        macLink: true,
      };
    }
    case "limit_hourly":
    case "limit_attempts":
      return waitThenSend("Slow down", `You're sending messages quickly. Try again in ${seconds(secondsAtReceipt)}.`);
    case "server_busy":
      return waitThenSend("Busy", "The demo server is at capacity right now. Try again in a minute.");
    case "limit_running":
      return { title: "Still working", body: runningBody(refusal.limit ?? 1), countdown: false, sendAgain: "now", macLink: false };
    case "usage_unavailable":
    case "human_check_unavailable":
      return waitThenSend("Can't send right now", refusal.message);
    case "human_check_required":
      return {
        title: "One quick check",
        body: "Confirm you're human before your first message.",
        countdown: false,
        sendAgain: "none",
        macLink: false,
      };
  }
}
