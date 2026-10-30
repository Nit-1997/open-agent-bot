import { describe, expect, it } from "vitest";
import { dedupeSources, faviconUrl, linksIn, searchResults } from "@/lib/sources";
import { stepLabel, summarizeSteps } from "@/lib/steps";
import { buildTurns, type ChatMessage, withWorkflow } from "@/lib/turns";

const call = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

const SEARCH_RESULT = `1. Party City Sunnyvale — https://www.partycity.com/sunnyvale
   Costumes and decor.
2. Mummy Poppers — https://thecarefreekitchen.com/mummy-poppers/
   Easy appetizer.`;

const messages: ChatMessage[] = [
  { id: "u1", role: "user", content: "plan a halloween party" },
  {
    id: "a1",
    role: "assistant",
    content: "Let me look.",
    toolCalls: [
      call("t1", "web_search", { query: "halloween supplies sunnyvale" }),
      call("t2", "fetch_page", { url: "https://www.target.com/c/halloween" }),
    ],
  },
  { id: "r1", role: "tool", toolCallId: "t1", content: SEARCH_RESULT },
  { id: "r2", role: "tool", toolCallId: "t2", content: "page text" },
  {
    id: "a2",
    role: "assistant",
    content: "Here's the plan. See [Spirit](https://www.spirithalloween.com/stores).",
    toolCalls: [
      call("t3", "show_ui", { title: "x" }),
      call("t3-widget", "show_widget", { widget: { kind: "ui", title: "Plan", blocks: [] } }),
    ],
  },
  { id: "r3", role: "tool", toolCallId: "t3", content: "shown" },
  { id: "u2", role: "user", content: "make a pdf" },
  { id: "a3", role: "assistant", content: "", toolCalls: [call("t4", "create_artifact", { title: "Party plan", html: "<p/>" })] },
];

describe("buildTurns", () => {
  const turns = buildTurns(messages);

  it("starts a turn at each user message", () => {
    expect(turns.map((t) => t.user?.text)).toEqual(["plan a halloween party", "make a pdf"]);
  });

  it("orders text and cards as they arrived and hides render tools from steps", () => {
    expect(turns[0].items.map((i) => i.kind)).toEqual(["text", "text", "widget"]);
    expect(turns[0].steps.map((s) => s.name)).toEqual(["web_search", "fetch_page"]);
  });

  it("marks steps done once their result arrives and keeps search sites", () => {
    expect(turns[0].steps.every((s) => s.done)).toBe(true);
    expect(turns[0].steps[0].sites).toEqual(["partycity.com", "thecarefreekitchen.com"]);
    expect(turns[1].steps).toEqual([expect.objectContaining({ name: "create_artifact", done: false })]);
  });

  it("collects sources cited first, then pages opened, then search results, without duplicates", () => {
    expect(turns[0].sources.map((s) => s.host)).toEqual(["spirithalloween.com", "target.com", "partycity.com", "thecarefreekitchen.com"]);
    expect(turns[0].sources[2].title).toBe("Party City Sunnyvale");
  });

  it("turns create_artifact into an artifact item with its result", () => {
    expect(turns[1].items).toEqual([{ kind: "artifact", id: "t4", title: "Party plan", result: undefined }]);
  });
});

describe("sources", () => {
  it("parses search result lines", () => {
    expect(searchResults(SEARCH_RESULT)).toEqual([
      { url: "https://www.partycity.com/sunnyvale", title: "Party City Sunnyvale", host: "partycity.com" },
      { url: "https://thecarefreekitchen.com/mummy-poppers/", title: "Mummy Poppers", host: "thecarefreekitchen.com" },
    ]);
  });

  it("finds markdown and bare links", () => {
    expect(linksIn("See [Target](https://target.com/a) or https://walmart.com/b.").map((s) => [s.title, s.url])).toEqual([
      ["Target", "https://target.com/a"],
      ["walmart.com", "https://walmart.com/b"],
    ]);
  });

  it("keeps the opened page's position but takes a real title from search results", () => {
    const opened = [{ url: "https://a.com/x", title: "a.com", host: "a.com" }];
    const searched = [{ url: "https://www.a.com/x/", title: "A great guide", host: "a.com" }];
    expect(dedupeSources([opened, searched])).toEqual([{ url: "https://a.com/x", title: "A great guide", host: "a.com" }]);
  });

  it("builds favicon urls from the host", () => {
    expect(faviconUrl("target.com")).toBe("https://icons.duckduckgo.com/ip3/target.com.ico");
  });
});

describe("steps", () => {
  it("labels steps in plain words", () => {
    expect(stepLabel("web_search", { query: "diyas" })).toBe("Searched “diyas”");
    expect(stepLabel("image_search", { query: "Abbey Road cover" })).toBe("Found pictures of “Abbey Road cover”");
    expect(stepLabel("image_search", { query: "Abbey Road cover" }, false)).toBe("Finding pictures of “Abbey Road cover”");
    expect(stepLabel("image_search", { queries: ["Rumours", "Abbey Road", "Blue"] })).toBe("Found pictures of 3 things");
    expect(stepLabel("music", { queries: ["Rumours", "Abbey Road"] })).toBe("Looked up 2 albums");
    expect(stepLabel("music", { queries: ["Hey Jude"], kind: "song" }, false)).toBe("Looking up 1 song");
    expect(stepLabel("wikipedia", { queries: ["Kinkaku-ji"] })).toBe("Read Wikipedia on Kinkaku-ji");
    expect(stepLabel("shop", { stores: ["shipt"], items: [{ query: "rice" }, { query: "beans" }] })).toBe("Shopped 2 items at Shipt");
    expect(stepLabel("shop", { stores: ["amazon", "bestbuy"], items: [{ query: "headphones" }] }, false)).toBe(
      "Shopping 1 item at Amazon, Bestbuy",
    );
    expect(stepLabel("wikipedia", { queries: ["Kinkaku-ji", "Ryoan-ji"] }, false)).toBe("Reading Wikipedia on 2 topics");
    expect(stepLabel("fetch_page", { url: "https://www.target.com/x" })).toBe("Read target.com");
    expect(stepLabel("weather", { location: "Pune" })).toBe("Checked weather in Pune");
  });

  it("summarizes a finished turn", () => {
    const steps = buildTurns(messages)[0].steps;
    expect(summarizeSteps(steps)).toBe("1 search · 1 page read");
    expect(summarizeSteps([])).toBe("");
  });
});

describe("research workflow", () => {
  const msgs: ChatMessage[] = [
    { id: "u1", role: "user", content: "heat pump report" },
    { id: "a1", role: "assistant", content: "", toolCalls: [call("r1", "research", { question: "heat pump or furnace?" })] },
  ];
  const ev = (phase: "research" | "plan" | "implement" | "verify", status: "start" | "done", detail?: object) => ({
    workflow: "research" as const,
    phase,
    status,
    detail,
  });

  it("shows the research tool as an artifact once its result arrives", () => {
    const done = buildTurns([
      ...msgs,
      { id: "t1", role: "tool", toolCallId: "r1", content: "artifact abcdefghijkl created: Heat pump vs furnace\nRead 4 sources." },
    ]);
    expect(done[0].items).toEqual([expect.objectContaining({ kind: "artifact", title: "Heat pump vs furnace" })]);
    expect(buildTurns(msgs)[0].items).toEqual([expect.objectContaining({ kind: "artifact", result: undefined })]);
  });

  it("replaces the research call with its phases, labeled in order", () => {
    const turns = withWorkflow(buildTurns(msgs), {
      u1: [
        ev("research", "start"),
        ev("research", "done", { sources: 4 }),
        ev("plan", "start"),
        ev("plan", "done"),
        ev("implement", "start"),
        ev("implement", "done"),
        ev("verify", "start"),
        ev("verify", "done", { supported: 9, total: 11 }),
      ],
    });
    expect(turns[0].steps.map((s) => stepLabel(s.name, s.args, s.done))).toEqual([
      "Researching sources",
      "Planning the report",
      "Writing the report",
      "Checking claims (9 of 11 supported)",
    ]);
    expect(turns[0].steps.every((s) => s.done)).toBe(true);
    expect(new Set(turns[0].steps.map((s) => s.id)).size).toBe(4);
  });

  it("marks only started phases and leaves the active one running", () => {
    const turns = withWorkflow(buildTurns(msgs), { u1: [ev("research", "start"), ev("research", "done"), ev("plan", "start")] });
    expect(turns[0].steps.map((s) => [s.args.phase, s.done])).toEqual([
      ["research", true],
      ["plan", false],
    ]);
    expect(stepLabel("workflow_step", { phase: "verify" }, false)).toBe("Checking claims");
  });

  it("keeps the research step when no workflow events arrived", () => {
    expect(withWorkflow(buildTurns(msgs), {})[0].steps.map((s) => s.name)).toEqual(["research"]);
    expect(stepLabel("research", { question: "q" }, false)).toBe("Researching “q”");
  });
});
