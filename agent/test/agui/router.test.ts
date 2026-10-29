import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { handleRun } from "../../src/agui/runHandler.js";
import { AREA_THRESHOLD, CORE_TOOLS, handoffText, isHandoff, type Route, type Router, route, skillNote, skillsFor, toolsFor } from "../../src/agui/router.js";
import { AREAS, type Area } from "../../src/judge/criteria/routeAreas.js";
import { type Judge, type MultiAnswer, noJudge } from "../../src/judge/index.js";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { loadRows } from "../../evals/route.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

type Seen = { state: Record<string, unknown>; questions: string[]; signal?: AbortSignal };

function fakeJudge(answer: (state: Record<string, unknown>) => Record<string, MultiAnswer> | null, seen: Seen[] = []): Judge {
  return {
    ...noJudge,
    available: true,
    classify: async (state, _c, questions, o) => {
      seen.push({ state, questions: Object.keys(questions), signal: o?.signal });
      return answer(state);
    },
  };
}

const answers = (yes: Partial<Record<Area, number>>, intent = "plan", intentP = 0.95, missing = 0.1): Record<string, MultiAnswer> => ({
  ...Object.fromEntries(AREAS.map((a) => [a, { type: "bool", yes: (yes[a] ?? 0.02) >= 0.5, p: yes[a] ?? 0.02 }])),
  missing: { type: "bool", yes: missing >= 0.5, p: missing },
  intent: { type: "choice", choice: intent, p: intentP },
});

const input = { message: "hotel in Rome", lastTurns: [{ role: "user" as const, text: "hi" }, { role: "assistant" as const, text: "hello" }], workspaceSummary: "Trip: Rome" };

describe("route", () => {
  it("asks one call with a bool per area, missing details and intent, over message, turns and workspace", async () => {
    const seen: Seen[] = [];
    const r = await route(fakeJudge(() => answers({ lodging: 0.9 }), seen), input);
    expect(seen).toHaveLength(1);
    expect(seen[0].questions).toEqual([...AREAS, "missing", "intent"]);
    expect(seen[0].state).toEqual({ message: "hotel in Rome", recent_turns: ["user: hi", "assistant: hello"], workspace: "Trip: Rome" });
    expect(r).toMatchObject({ intent: "plan", intentP: 0.95, missingDetails: 0.1, skills: ["trip-planning"] });
    expect(r?.areas.lodging).toBe(0.9);
  });

  it("flags areas at the threshold and no lower", async () => {
    const r = await route(fakeJudge(() => answers({ music: AREA_THRESHOLD, weather: AREA_THRESHOLD - 0.01 })), { ...input, message: "play something" });
    expect(r?.skills).toEqual(["music"]);
    expect(r?.tools).toEqual([...new Set([...CORE_TOOLS, "music", "image_search"])]);
  });

  it("gives no skills and no tool set when nothing is flagged", async () => {
    const r = await route(fakeJudge(() => answers({})), { ...input, message: "hi" });
    expect(r).toMatchObject({ skills: [], tools: null });
  });

  it("returns null when the judge fails, is unavailable, or answers badly", async () => {
    expect(await route(fakeJudge(() => null), input)).toBeNull();
    expect(await route(noJudge, input)).toBeNull();
    expect(await route(fakeJudge(() => answers({}, "sell")), input)).toBeNull();
    expect(await route(fakeJudge(() => answers({})), { ...input, message: "  " })).toBeNull();
  });

  it("passes a signal that aborts at the timeout", async () => {
    const seen: Seen[] = [];
    await route(fakeJudge(() => answers({}), seen), input, { timeoutMs: 10 });
    expect(seen[0].signal?.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen[0].signal?.aborted).toBe(true);
  });

  it("clips long turns and the workspace summary", async () => {
    const seen: Seen[] = [];
    await route(fakeJudge(() => answers({}), seen), { message: "x", lastTurns: [{ role: "user", text: "u".repeat(900) }], workspaceSummary: "w".repeat(5000) });
    expect((seen[0].state.recent_turns as string[])[0].length).toBe("user: ".length + 300);
    expect((seen[0].state.workspace as string).length).toBe(1200);
  });
});

describe("skill and tool hints", () => {
  it("maps areas to skills", () => {
    expect(skillsFor(["lodging", "flights"], "trip to Rome")).toEqual(["trip-planning"]);
    expect(skillsFor(["dining"], "ramen")).toEqual(["dining-out"]);
    expect(skillsFor(["research"], "heat pump")).toEqual(["research"]);
    expect(skillsFor(["music"], "jazz")).toEqual(["music"]);
    expect(skillsFor(["lodging", "dining", "weather"], "weekend in Tahoe")).toEqual(["trip-planning", "dining-out"]);
  });

  it("picks the shopping skill from the message", () => {
    expect(skillsFor(["shopping"], "birthday party for 12 kids")).toEqual(["party-planning"]);
    expect(skillsFor(["shopping"], "a gift for my dad")).toEqual(["gift-ideas"]);
    expect(skillsFor(["shopping"], "eggs and milk")).toEqual(["grocery-run"]);
  });

  it("loads trip planning for weather only when the message is about travelling", () => {
    expect(skillsFor(["weather"], "will it rain tomorrow?")).toEqual([]);
    expect(skillsFor(["weather"], "what to pack for my trip, forecast?")).toEqual(["trip-planning"]);
  });

  it("limits tools to the matched areas plus the core tools", () => {
    expect(toolsFor([])).toBeNull();
    expect(toolsFor(["flights", "weather"])).toEqual([...CORE_TOOLS, "flights", "weather"]);
    expect(toolsFor(["lodging"])).toContain("stays");
    expect(toolsFor(["lodging"])).not.toContain("shop");
  });

  it("wraps each skill body in a named tag", () => {
    expect(skillNote([])).toBeUndefined();
    expect(skillNote([{ name: "music", body: "Play it." }])).toContain('<skill name="music">\nPlay it.\n</skill>');
  });
});

describe("policy hand-off", () => {
  const r = (intent: Route["intent"], intentP: number) => ({ intent, intentP }) as Route;

  it("applies only to buy, book and login at 0.85 or more", () => {
    expect(isHandoff(r("buy", 0.85))).toBe(true);
    expect(isHandoff(r("book", 0.8))).toBe(false);
    expect(isHandoff(r("book", 0.95))).toBe(true);
    expect(isHandoff(r("login", 0.99))).toBe(true);
    expect(isHandoff(r("buy", 0.79))).toBe(false);
    expect(isHandoff(r("plan", 1))).toBe(false);
    expect(isHandoff(null)).toBe(false);
  });

  it("words each hand-off as one or two short sentences", () => {
    for (const intent of ["buy", "book", "login"] as const) {
      const text = handoffText(intent);
      expect(text.split(/(?<=\.)\s/).length).toBeLessThanOrEqual(2);
      expect(text).toMatch(/can't/);
    }
  });

  it("labels find-a-hotel and what-to-buy prompts as plan in the routing set", () => {
    const rows = loadRows();
    for (const prompt of ["Find a hotel I can book in Rome for the first week of September", "What should I buy for a new apartment kitchen?"]) {
      expect(rows.find((x) => x.prompt === prompt)?.intent).toBe("plan");
    }
    expect(rows.filter((x) => x.intent !== "plan").length).toBeGreaterThanOrEqual(10);
  });
});

describe("routing fixture", () => {
  it("has about a hundred labeled prompts, split into practice and test", () => {
    const rows = loadRows();
    expect(rows.length).toBeGreaterThanOrEqual(100);
    expect(loadRows(undefined, "practice").length).toBeGreaterThan(40);
    expect(loadRows(undefined, "test").length).toBeGreaterThan(40);
    for (const row of rows) {
      expect(row.areas.every((a) => (AREAS as readonly string[]).includes(a))).toBe(true);
      expect(["plan", "buy", "book", "login"]).toContain(row.intent);
    }
    expect(rows.some((x) => x.areas.length >= 3)).toBe(true);
    expect(rows.some((x) => x.lastTurns?.length)).toBe(true);
    expect(rows.some((x) => x.workspace)).toBe(true);
  });
});

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("done"));
  emit(ev.assistantEnd());
};

function runInput(message = "hello"): RunAgentInput {
  return { threadId: "t1", runId: "r1", messages: [{ id: "m1", role: "user", content: message }], tools: [], context: [], state: {}, forwardedProps: {} } as RunAgentInput;
}

async function collect(it: AsyncIterable<BaseEvent>) {
  const out: BaseEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const SKILLS = [
  { name: "trip-planning", body: "Trip body." },
  { name: "dining-out", body: "Dining body." },
];

function harness(result: Route | null, opts: { narrow?: boolean; script?: Script; order?: string[] } = {}) {
  const session = fakeSession(opts.script ?? say);
  const order = opts.order ?? [];
  const hints: (string | undefined)[] = [];
  const duringPrompt: { hint?: string; tools: string[] }[] = [];
  const original = session.prompt.bind(session);
  session.prompt = async (text: string) => {
    duringPrompt.push({ hint: hints.at(-1), tools: session.getActiveToolNames() });
    return original(text);
  };
  const store = new SessionStore({
    idleMs: 60000,
    create: async (): Promise<SessionEntry> => {
      order.push("create");
      await new Promise((r) => setTimeout(r, 5));
      return { session, busy: false, lastUsed: 0, dispose: async () => {}, setHints: (n) => hints.push(n) };
    },
  });
  const router: Router = {
    route: async (i) => {
      order.push("route");
      await new Promise((r) => setTimeout(r, 5));
      return i.message ? result : null;
    },
    skills: (names) => SKILLS.filter((s) => names.includes(s.name)),
    narrow: () => opts.narrow ?? false,
  };
  return { session, store, router, hints, duringPrompt, order };
}

const planRoute = (over: Partial<Route> = {}): Route => ({
  areas: Object.fromEntries(AREAS.map((a) => [a, 0])) as Record<Area, number>,
  missingDetails: 0,
  intent: "plan",
  intentP: 0.99,
  skills: ["trip-planning"],
  tools: [...CORE_TOOLS, "stays"],
  ...over,
});

describe("handleRun with the router", () => {
  it("starts routing and the session fetch together", async () => {
    const h = harness(planRoute());
    await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
    expect(h.order).toEqual(["route", "create"]);
  });

  it("answers a buy, book or login request from code without prompting the model", async () => {
    for (const intent of ["buy", "book", "login"] as const) {
      const h = harness(planRoute({ intent, intentP: 0.93 }));
      const out = await collect(handleRun(runInput("buy it"), h.store, new AbortController().signal, { router: h.router }));
      expect(h.session.prompts).toEqual([]);
      const types = out.map((e) => e.type);
      expect(types).toEqual([EventType.RUN_STARTED, EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.CUSTOM, EventType.RUN_FINISHED]);
      expect((out[2] as unknown as { delta: string }).delta).toBe(handoffText(intent));
      expect(out[4]).toMatchObject({ name: "run_stats", value: { toolCalls: 0, skills: [] } });
    }
  });

  it("prompts the model for plan intent and for hand-off intents below 0.85", async () => {
    for (const r of [planRoute(), planRoute({ intent: "buy", intentP: 0.6 })]) {
      const h = harness(r);
      const out = await collect(handleRun(runInput("find me a hotel I can book"), h.store, new AbortController().signal, { router: h.router }));
      expect(h.session.prompts).toEqual(["find me a hotel I can book"]);
      expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    }
  });

  it("preloads matched skills for the turn only and records them in run_stats", async () => {
    const h = harness(planRoute({ skills: ["trip-planning", "dining-out"] }));
    const out = await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
    expect(h.duringPrompt[0].hint).toContain('<skill name="trip-planning">\nTrip body.\n</skill>');
    expect(h.duringPrompt[0].hint).toContain('<skill name="dining-out">');
    expect(h.hints.at(-1)).toBeUndefined();
    const stats = out.find((e) => (e as { name?: string }).name === "run_stats") as unknown as { value: { skills: string[] } };
    expect(stats.value.skills).toEqual(["trip-planning", "dining-out"]);
  });

  it("changes nothing when there is no route or no matched skill", async () => {
    for (const r of [null, planRoute({ skills: [], tools: null })]) {
      const h = harness(r, { narrow: true });
      await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
      expect(h.hints).toEqual([]);
      expect(h.session.toolSets).toEqual([]);
      expect(h.session.prompts).toEqual(["hello"]);
    }
  });

  it("narrows the active tools for small models during the turn and restores them after", async () => {
    const h = harness(planRoute({ tools: [...CORE_TOOLS, "stays"] }), { narrow: true });
    const before = h.session.getActiveToolNames();
    await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
    expect(h.duringPrompt[0].tools.sort()).toEqual(["show_ui", "stays", "web_search"]);
    expect(h.session.getActiveToolNames()).toEqual(before);
  });

  it("restores the tools even when the model fails", async () => {
    const h = harness(planRoute(), { narrow: true, script: async (emit) => { emit(ev.assistantStart); emit(ev.assistantEnd("error", "boom")); } });
    const before = h.session.getActiveToolNames();
    const out = await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
    expect(out.at(-1)?.type).toBe(EventType.RUN_ERROR);
    expect(h.session.getActiveToolNames()).toEqual(before);
    expect(h.hints.at(-1)).toBeUndefined();
  });

  it("leaves the tools alone for models that are not small", async () => {
    const h = harness(planRoute(), { narrow: false });
    await collect(handleRun(runInput(), h.store, new AbortController().signal, { router: h.router }));
    expect(h.session.toolSets).toEqual([]);
    expect(h.duringPrompt[0].hint).toContain("trip-planning");
  });

  it("behaves as before without a router", async () => {
    const h = harness(planRoute());
    const out = await collect(handleRun(runInput(), h.store, new AbortController().signal));
    expect(h.order).toEqual(["create"]);
    expect(h.hints).toEqual([]);
    expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });
});
