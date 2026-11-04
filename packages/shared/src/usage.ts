export type Limits = { runningPerUser: number; perHour: number; perMonth: number; runningServer: number };

export type SignupMode = "invite" | "waitlist" | "open";

export type HumanCheckState = "off" | "required" | "done" | "unavailable";

export type UsageView = {
  month: { used: number; limit: number; resetsAt: string };
  hour: { used: number; limit: number; resetsAt: string | null };
  running: { mine: number; limit: number };
  humanCheck: HumanCheckState;
};

export type AdminUsageSummary = {
  month: { total: number; activeUsers: number; resetsAt: string };
  running: { now: number; limit: number; staleReleased: number };
  limits: Limits;
  signupMode: SignupMode | "unknown";
  signups: { lastHour: number; lastDay: number; capHour: number; capDay: number } | null;
};

export type AdminUsageRow = {
  id: string;
  email: string;
  monthUsed: number;
  monthLimit: number;
  lastAt: string | null;
  runningNow: boolean;
};

export function nextUtcMonth(at: number): Date {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
