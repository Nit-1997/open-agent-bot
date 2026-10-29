import type { Judge, MultiQuestion, Usage } from "../judge/index.js";
import { AREAS, type Area, type Intent, routeAreas } from "../judge/criteria/routeAreas.js";

export type { Area, Intent };

export type RouteInput = { message: string; lastTurns: { role: "user" | "assistant"; text: string }[]; workspaceSummary?: string };

export type Route = {
  areas: Record<Area, number>;
  missingDetails: number;
  intent: Intent;
  intentP: number;
  skills: string[];
  tools: string[] | null;
};

export const AREA_THRESHOLD = 0.5;
export const POLICY_THRESHOLD = 0.8;
export const ROUTE_TIMEOUT_MS = 2500;

const TURN_CLIP = 300;
const MESSAGE_CLIP = 1500;
const SUMMARY_CLIP = 1200;

export const CORE_TOOLS = ["show_ui", "suggest_replies", "ask_user", "load_skill", "plan", "web_search", "fetch_page"];

const AREA_TOOLS: Record<Area, string[]> = {
  lodging: ["stays", "image_search"],
  flights: ["flights"],
  shopping: ["shop", "image_search"],
  dining: ["browse", "image_search"],
  research: ["create_artifact", "wikipedia", "browse", "image_search"],
  music: ["music", "image_search"],
  weather: ["weather"],
};

const PARTY = /\b(party|parties|birthday|event|guests?|kids?|wedding|bbq|barbecue|shower|cookout|dinner for)\b/i;
const GIFT = /\b(gifts?|presents?)\b/i;
const TRAVEL = /\b(trip|travel|travell?ing|visit|vacation|holiday|weekend|pack|itinerary|flying|getaway)\b/i;

const INTENTS = Object.keys(routeAreas.intent.options) as Intent[];

export function skillsFor(areas: Area[], message: string): string[] {
  const out = new Set<string>();
  const has = (a: Area) => areas.includes(a);
  if (has("lodging") || has("flights") || (has("weather") && TRAVEL.test(message))) out.add("trip-planning");
  if (has("shopping")) out.add(PARTY.test(message) ? "party-planning" : GIFT.test(message) ? "gift-ideas" : "grocery-run");
  if (has("dining")) out.add("dining-out");
  if (has("research")) out.add("research");
  if (has("music")) out.add("music");
  return [...out];
}

export function toolsFor(areas: Area[]): string[] | null {
  return areas.length ? [...new Set([...CORE_TOOLS, ...areas.flatMap((a) => AREA_TOOLS[a])])] : null;
}

export function flaggedAreas(areas: Record<Area, number>): Area[] {
  return AREAS.filter((a) => areas[a] >= AREA_THRESHOLD);
}

const questions: Record<string, MultiQuestion> = {
  ...Object.fromEntries(AREAS.map((a): [string, MultiQuestion] => [a, { type: "bool", ...routeAreas.areas[a] }])),
  missing: { type: "bool", ...routeAreas.missing },
  intent: { type: "choice", question: routeAreas.intent.question, options: routeAreas.intent.options },
};

export async function route(judge: Judge, input: RouteInput, o: { signal?: AbortSignal; sink?: Usage; timeoutMs?: number } = {}): Promise<Route | null> {
  if (!judge.available || !input.message.trim()) return null;
  const signal = AbortSignal.any([...(o.signal ? [o.signal] : []), AbortSignal.timeout(o.timeoutMs ?? ROUTE_TIMEOUT_MS)]);
  const state = {
    message: input.message.slice(0, MESSAGE_CLIP),
    recent_turns: input.lastTurns.map((t) => `${t.role}: ${t.text.slice(0, TURN_CLIP)}`),
    ...(input.workspaceSummary && { workspace: input.workspaceSummary.slice(0, SUMMARY_CLIP) }),
  };
  const answers = await judge.classify(state, routeAreas, questions, { signal, ...(o.sink && { sink: o.sink }) });
  if (!answers) return null;
  const pOf = (key: string) => {
    const a = answers[key];
    return a?.type === "bool" ? a.p : 0;
  };
  const intent = answers.intent;
  if (intent?.type !== "choice" || !INTENTS.includes(intent.choice as Intent)) return null;
  const areas = Object.fromEntries(AREAS.map((a) => [a, pOf(a)])) as Record<Area, number>;
  const flagged = flaggedAreas(areas);
  return {
    areas,
    missingDetails: pOf("missing"),
    intent: intent.choice as Intent,
    intentP: intent.p,
    skills: skillsFor(flagged, input.message),
    tools: toolsFor(flagged),
  };
}

export const isHandoff = (r: Route | null): r is Route & { intent: Exclude<Intent, "plan"> } => !!r && r.intent !== "plan" && r.intentP >= POLICY_THRESHOLD;

const HANDOFF: Record<Exclude<Intent, "plan">, string> = {
  buy: "I can't buy or check out for you myself. Use the product links from our chat to finish the purchase on the store's site, and I'm happy to keep comparing options in the meantime.",
  book: "I can't make bookings or reservations myself. Use the links from our chat to book on the provider's site, and I can keep looking at options with you.",
  login: "I can't sign in or use your accounts myself. You can log in directly on the site, and I can keep helping with the search and comparison here.",
};

export const handoffText = (intent: Exclude<Intent, "plan">): string => HANDOFF[intent];

export function skillNote(skills: { name: string; body: string }[]): string | undefined {
  return skills.length ? `Skills already loaded for this turn; follow them without calling load_skill:\n\n${skills.map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n\n")}` : undefined;
}

export type Router = {
  route(input: RouteInput, o?: { signal?: AbortSignal; sink?: Usage }): Promise<Route | null>;
  skills(names: string[]): { name: string; body: string }[];
  narrow(modelRef: string | undefined): boolean;
};
