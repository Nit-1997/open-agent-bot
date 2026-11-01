import { NO_FOOD_RULES } from "@shared/onboarding";
import type { Profile } from "@shared/profile";

const SUMMARY_MAX = 40;
const TRAVEL_SHORT = { budget: "budget trips", comfort: "comfort trips", luxury: "luxury trips" } as const;
const TRAVEL_CLAUSE = {
  budget: "that you travel on a budget",
  comfort: "that you travel for comfort",
  luxury: "that you like to travel in luxury",
} as const;

export const isolate = (name: string) => `⁨${name}⁩`;

const homeOf = (p: Profile) => p.home?.city?.trim() || p.home?.label?.trim() || undefined;
const foodOf = (p: Profile) => p.food.find((f) => f !== NO_FOOD_RULES)?.toLowerCase();

export function knowsSummary(p: Profile | null | undefined): { text: string; full: string } | null {
  if (!p) return null;
  const facts = [homeOf(p), foodOf(p), p.travel.style && TRAVEL_SHORT[p.travel.style]].filter((x): x is string => !!x);
  if (!facts.length) return null;
  const full = facts.join(", ");
  const chars = Array.from(full);
  return {
    text:
      chars.length > SUMMARY_MAX
        ? `${chars
            .slice(0, SUMMARY_MAX - 1)
            .join("")
            .trimEnd()}…`
        : full,
    full,
  };
}

function foodClause(food: string): string {
  if (/allerg/.test(food)) return `about your ${food}`;
  if (/^(vegetarian|vegan|pescatarian)$/.test(food)) return `that you're ${food}`;
  return `that you eat ${food}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function rememberClauses(p: Profile | null | undefined): string | null {
  if (!p) return null;
  const home = homeOf(p);
  const food = foodOf(p);
  const parts = [home && `your home in ${home}`, food && foodClause(food), p.travel.style && TRAVEL_CLAUSE[p.travel.style]].filter(
    (x): x is string => !!x,
  );
  return parts.length ? joinClauses(parts) : null;
}

export function rememberLine(p: Profile | null | undefined, name: string): string | null {
  const clauses = rememberClauses(p);
  return clauses ? `${name} remembers ${clauses}.` : null;
}
