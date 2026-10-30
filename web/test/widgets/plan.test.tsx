import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Plan } from "@shared/widgets";
import { PlanCard } from "@/components/widgets/PlanCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { stepLabel } from "@/lib/steps";
import { hasEdits, withCartEdits, withPlanEdits, workspaceContextValue } from "@/lib/workspaceEdits";

const event: Plan = {
  kind: "plan",
  entity: "event",
  id: "main",
  version: 1,
  value: { title: "8th birthday", date: "2026-11-14", guests: 12, budget: 300, currency: "USD", menu: ["pizza", "cake"], timeline: [{ when: "Day of", what: "Set up" }] },
};

const trip: Plan = {
  kind: "plan",
  entity: "trip",
  id: "main",
  version: 2,
  value: { destination: "Tahoe", start: "2026-12-01", end: "2026-12-04", travelers: 2, stays: [{ name: "Lodge", url: "https://lodge.example/" }], days: [{ date: "2026-12-01", items: ["Ski"] }] },
};

const ids = (c: HTMLElement) => [...c.querySelectorAll("[id]")].map((e) => e.id);

describe("PlanCard event", () => {
  it("shows the event with editable guests, date and budget and unique ids", () => {
    const { container } = render(<PlanCard toolCallId="p1" widget={event} onEdit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "8th birthday" })).toBeInTheDocument();
    expect(screen.getByLabelText("Guests")).toHaveValue(12);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-11-14");
    expect(screen.getByLabelText("Budget (USD)")).toHaveValue(300);
    expect(screen.getByText("pizza")).toBeInTheDocument();
    expect(ids(container).every((i) => i.startsWith("plan-p1"))).toBe(true);
    expect(new Set(ids(container)).size).toBe(ids(container).length);
  });

  it("reports only the fields the user changed, cumulatively, and nothing before an edit", () => {
    const onEdit = vi.fn();
    render(<PlanCard toolCallId="p2" widget={event} onEdit={onEdit} />);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Increase guests" }));
    expect(onEdit).toHaveBeenLastCalledWith({ event: { guests: 13 } });
    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-21" } });
    fireEvent.change(screen.getByLabelText("Budget (USD)"), { target: { value: "350" } });
    expect(onEdit).toHaveBeenLastCalledWith({ event: { guests: 16, date: "2026-11-21", budget: 350 } });
    fireEvent.change(screen.getByLabelText("Guests"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-14" } });
    fireEvent.change(screen.getByLabelText("Budget (USD)"), { target: { value: "300" } });
    expect(onEdit).toHaveBeenLastCalledWith({ event: {} });
  });

  it("ignores guest counts below one", () => {
    render(<PlanCard toolCallId="p3" widget={{ ...event, value: { ...event.value, guests: 1 } } as Plan} onEdit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Decrease guests" })).toBeDisabled();
  });

  it("locks an older card", () => {
    render(<PlanCard toolCallId="p4" widget={event} stale onEdit={vi.fn()} />);
    expect(screen.getByText("Updated plan below")).toBeInTheDocument();
    expect(screen.getByLabelText("Guests")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Increase guests" })).toBeDisabled();
  });

  it("shows a free-text date as plain text", () => {
    render(<PlanCard toolCallId="p5" widget={{ ...event, value: { ...event.value, date: "Nov 14" } } as Plan} onEdit={vi.fn()} />);
    expect(screen.getByText("Nov 14")).toBeInTheDocument();
  });
});

describe("PlanCard trip and shortlist", () => {
  it("edits travelers and dates and reports them under trip", () => {
    const onEdit = vi.fn();
    const { container } = render(<PlanCard toolCallId="t1" widget={trip} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase travelers" }));
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-12-05" } });
    expect(onEdit).toHaveBeenLastCalledWith({ trip: { travelers: 3, end: "2026-12-05" } });
    expect(screen.getByRole("link", { name: "Lodge" })).toHaveAttribute("href", "https://lodge.example/");
    expect(new Set(ids(container)).size).toBe(ids(container).length);
  });

  it("lists a shortlist without edit controls", () => {
    const list: Plan = { kind: "plan", entity: "shortlist", id: "gifts", version: 1, value: { title: "Gifts", items: [{ name: "Lego", price: 20, note: "ages 8+" }] } };
    render(<PlanCard toolCallId="s1" widget={list} onEdit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Gifts" })).toBeInTheDocument();
    expect(screen.getByText("Lego")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});

describe("WidgetRenderer plan", () => {
  it("renders a plan widget and passes edits up unless it is stale", () => {
    const onPlanEdit = vi.fn();
    const { rerender } = render(<WidgetRenderer toolCallId="w1" args={{ widget: event }} locale="en-US" onPlanEdit={onPlanEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase guests" }));
    expect(onPlanEdit).toHaveBeenCalledWith({ event: { guests: 13 } });
    rerender(<WidgetRenderer toolCallId="w1" args={{ widget: event }} locale="en-US" onPlanEdit={onPlanEdit} stalePlan />);
    expect(screen.getByLabelText("Guests")).toBeDisabled();
  });

  it("renders nothing for an invalid plan", () => {
    const { container } = render(<WidgetRenderer toolCallId="w2" args={{ widget: { kind: "plan", entity: "event", id: "x", version: 1, value: { title: "x", guests: 0 } } }} locale="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("workspace edits queue", () => {
  it("merges cart and plan edits, replacing an entity's edits and dropping it when emptied", () => {
    let e = withCartEdits({}, { removed: ["a"], qty: {}, picks: {} });
    e = withPlanEdits(e, { event: { guests: 16 } });
    e = withPlanEdits(e, { trip: { travelers: 3 } });
    e = withPlanEdits(e, { event: { guests: 16, budget: 350 } });
    expect(e).toEqual({ cart: { removed: ["a"], qty: {}, picks: {} }, event: { guests: 16, budget: 350 }, trip: { travelers: 3 } });
    e = withPlanEdits(e, { event: {} });
    expect(e.event).toBeUndefined();
    expect(withPlanEdits(e, { trip: { travelers: 3 } }).cart).toBeDefined();
  });

  it("serializes the edits and stays empty when there are none", () => {
    expect(workspaceContextValue({})).toBe("");
    const e = withPlanEdits(withCartEdits({}, { removed: [], qty: { rice: 2 }, picks: {} }), { event: { guests: 16 } });
    expect(JSON.parse(workspaceContextValue(e))).toEqual({ cart: { removed: [], qty: { rice: 2 }, picks: {} }, event: { guests: 16 } });
    expect(hasEdits(e)).toBe(true);
  });
});

describe("plan step label", () => {
  it("says saved or read", () => {
    expect(stepLabel("plan", { action: "set", kind: "event" })).toBe("Saved the event");
    expect(stepLabel("plan", { action: "patch", kind: "event" }, false)).toBe("Saving the event");
    expect(stepLabel("plan", { action: "get", kind: "trip" })).toBe("Read the trip");
  });
});
