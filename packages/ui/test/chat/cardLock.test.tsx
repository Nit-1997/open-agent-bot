import { AbstractAgent, type BaseEvent, type Message } from "@ag-ui/client";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { act, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { EMPTY, type Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ChatSession } from "../../src/components/chat/ChatSession.tsx";

class RealAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

const mounted: { agent?: RealAgent } = {};

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => {
    const [agent] = useState(() => new RealAgent());
    mounted.agent = agent;
    return { agent };
  },
  useCopilotKit: () => ({ copilotkit: { addContext: () => "ctx", removeContext: () => {}, runAgent: vi.fn(), stopAgent: vi.fn() } }),
}));

const cart = (name: string) => ({
  kind: "cart",
  stores: [
    {
      name,
      total: 9.5,
      url: "https://www.traderjoes.com/",
      missing: [],
      items: [{ query: "avocados", qty: 2, picks: [{ title: "Avocados", price: 4.75, url: "https://www.traderjoes.com/a" }] }],
    },
  ],
});

const plan = (id: string, guests: number) => ({
  kind: "plan",
  entity: "event",
  id,
  version: 1,
  value: { title: `Party ${id}`, guests },
});

const trip = {
  kind: "plan",
  entity: "trip",
  id: "main",
  version: 1,
  value: { destination: "Tahoe", start: "2026-12-01", end: "2026-12-04", travelers: 2, stays: [], days: [] },
};

const card = (n: string, widget: object): Message[] => [
  {
    id: `a-${n}`,
    role: "assistant",
    content: "",
    toolCalls: [{ id: `${n}-widget`, type: "function", function: { name: "show_widget", arguments: JSON.stringify({ widget }) } }],
  },
  { id: `t-${n}`, role: "tool", toolCallId: `${n}-widget`, content: "rendered" },
];

const history: Message[] = [
  { id: "u1", role: "user", content: "taco night" },
  ...card("h1", cart("Trader Joe's")),
  ...card("hp", plan("main", 12)),
  ...card("hq", plan("other", 4)),
];
const shownAt = { "h1-widget": "2026-11-01T12:00:00Z", "hp-widget": "2026-11-01T12:00:00Z", "hq-widget": "2026-11-01T12:00:00Z" };

const persona = { ...DEFAULT_AGENT, name: "Sage" };
const el = (id: string) => document.getElementById(id);

function mount() {
  return render(
    <ChatSession
      id="lock"
      agentId="openagent"
      threadId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      locale="en-US"
      persona={persona}
      history={history as never}
      shownAt={shownAt}
      composerPlaceholder="Ask"
      composerLabel="Message"
      autoFocus={false}
      emptyHeading="h1"
      memory={null}
      onOpenProfile={() => {}}
      onRunningChange={() => {}}
      onClaimed={() => {}}
      onRunEnd={() => {}}
    />,
  );
}

async function stream(n: string, widget: object) {
  const agent = mounted.agent!;
  await act(async () => {
    for (const s of agent.subscribers)
      await s.onToolCallStartEvent?.({ event: { toolCallId: `${n}-widget`, toolCallName: "show_widget" } } as never);
    agent.addMessages(card(n, widget));
  });
}

const inc = (cardId: string) => el(cardId)?.querySelector<HTMLButtonElement>("[id$='-inc']");

describe("cards in a chat pane", () => {
  it("locks and dates the newest cart from history", async () => {
    mount();
    await waitFor(() => expect(el("lock-cart-h1-widget")).not.toBeNull());
    expect(el("lock-cart-h1-widget-locked-note")?.textContent).toMatch(/^Prices from .+ · ask Sage to refresh$/);
    expect(inc("lock-cart-h1-widget")).toBeDisabled();
    expect(el("lock-cart-h1-widget")?.querySelector("[id$='-swap'], [id$='-remove']")).toBeNull();
  });

  it("makes a cart streamed into the pane live and the history cart replaced, then replaced again by the next one", async () => {
    mount();
    await waitFor(() => expect(el("lock-cart-h1-widget")).not.toBeNull());
    await stream("r1", cart("Trader Joe's"));
    await waitFor(() => expect(el("lock-cart-r1-widget")).not.toBeNull());
    expect(inc("lock-cart-r1-widget")).toBeEnabled();
    expect(el("lock-cart-r1-widget-locked-note")).toBeNull();
    expect(el("lock-cart-h1-widget-count")?.textContent).toBe("Updated cart below");
    expect(el("lock-cart-h1-widget-locked-note")).toBeNull();

    await stream("r2", cart("Safeway"));
    await waitFor(() => expect(el("lock-cart-r2-widget")).not.toBeNull());
    expect(inc("lock-cart-r2-widget")).toBeEnabled();
    expect(el("lock-cart-r1-widget-count")?.textContent).toBe("Updated cart below");
    expect(inc("lock-cart-r1-widget")).toBeDisabled();
  });

  it("locks the formerly live card again after the pane remounts with history", async () => {
    const first = mount();
    await waitFor(() => expect(el("lock-cart-h1-widget")).not.toBeNull());
    await stream("r1", cart("Trader Joe's"));
    await waitFor(() => expect(inc("lock-cart-r1-widget")).toBeEnabled());
    first.unmount();
    mount();
    await waitFor(() => expect(el("lock-cart-h1-widget")).not.toBeNull());
    expect(el("lock-cart-r1-widget")).toBeNull();
    expect(el("lock-cart-h1-widget-locked-note")).not.toBeNull();
  });

  it("keeps only the newest plan card of each kind live, so an edit can't reach the wrong plan", async () => {
    mount();
    await waitFor(() => expect(el("lock-plan-hp-widget")).not.toBeNull());
    expect(el("lock-plan-hq-widget-locked-note")?.textContent).toMatch(/^From .+ · ask Sage to update it$/);
    expect(el("lock-plan-hp-widget-kind")?.textContent).toBe("Updated plan below");
    expect(el("lock-plan-hp-widget-locked-note")).toBeNull();

    await stream("rp", plan("main", 16));
    await waitFor(() => expect(inc("lock-plan-rp-widget")).toBeEnabled());
    expect(el("lock-plan-rp-widget-locked-note")).toBeNull();
    expect(el("lock-plan-hq-widget-kind")?.textContent).toBe("Updated plan below");
    expect(el("lock-plan-hq-widget-locked-note")).toBeNull();

    await stream("rq", plan("other", 5));
    await waitFor(() => expect(inc("lock-plan-rq-widget")).toBeEnabled());
    expect(inc("lock-plan-rp-widget")).toBeDisabled();
    expect(el("lock-plan-rp-widget-kind")?.textContent).toBe("Updated plan below");

    await stream("rt", trip);
    await waitFor(() => expect(inc("lock-plan-rt-widget")).toBeEnabled());
    expect(inc("lock-plan-rq-widget")).toBeEnabled();
  });
});
