import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlightList } from "@/components/widgets/FlightList";
import { UiCard } from "@/components/widgets/UiCard";
import { WeatherCard } from "@/components/widgets/WeatherCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { validWidgets } from "./fixtures";

const twoDays = {
  ...validWidgets.weather_card,
  days: [...validWidgets.weather_card.days, { date: "2026-11-01", high: 30, low: 18, condition: "Rain" }],
};

describe("widgets", () => {
  it("WeatherCard renders location and N days", () => {
    render(<WeatherCard toolCallId="w1" widget={twoDays} />);
    expect(screen.getByText("Pune, India")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("28°C")).toBeInTheDocument();
  });

  it("FlightList always renders searchUrl link", () => {
    render(<FlightList toolCallId="f1" widget={{ ...validWidgets.flight_list, flights: [] }} locale="en-US" />);
    const link = screen.getByRole("link", { name: "Search & book yourself" });
    expect(link).toHaveAttribute("href", validWidgets.flight_list.searchUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("FlightList shows duration text as given", () => {
    render(<FlightList toolCallId="f2" widget={validWidgets.flight_list} locale="en-US" />);
    expect(screen.getByText("20h 0m")).toBeInTheDocument();
    expect(screen.getByText("Nonstop")).toBeInTheDocument();
  });

  it("FlightList badges the cheapest option", () => {
    const f = validWidgets.flight_list;
    const widget = {
      ...f,
      flights: [
        { ...f.flights[0], airline: "Delta", price: 177 },
        { ...f.flights[0], airline: "Frontier", price: 133 },
      ],
    };
    render(<FlightList toolCallId="f3" widget={widget} locale="en-US" />);
    const badge = screen.getByText("Cheapest");
    expect(badge.closest("li")).toHaveTextContent("Frontier");
  });

  it("UiCard renders every block type", () => {
    render(<UiCard toolCallId="u1" widget={validWidgets.ui} />);
    expect(screen.getByRole("heading", { name: "Diwali party for 25" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByText("₹15,000")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Diya set/ })).toHaveAttribute("href", "https://amazon.in/x");
    expect(screen.getByRole("checkbox", { name: /Clean the house/ })).not.toBeChecked();
    expect(screen.getByRole("link", { name: "Amazon" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Prices change often.")).toBeInTheDocument();
    expect(screen.getByText("Have fun!")).toBeInTheDocument();
  });

  it("UiCard marks every unverified value and explains removed links", () => {
    render(<UiCard toolCallId="u2" widget={validWidgets.ui} />);
    const marks = screen.getAllByTitle("Not found in the sources I read");
    expect(marks.map((m) => m.textContent)).toEqual(["₹350", "₹350"]);
    expect(screen.getByText(/weren't found in the sources/)).toBeInTheDocument();
    expect(screen.getByText(/1 link that didn't come from a source was removed/)).toBeInTheDocument();
  });

  it("UiCard without flags shows no grounding footer", () => {
    const { unverified: _u, removedLinks: _r, ...clean } = validWidgets.ui;
    render(<UiCard toolCallId="u3" widget={clean} />);
    expect(screen.queryByTitle("Not found in the sources I read")).toBeNull();
    expect(screen.queryByText(/weren't found in the sources/)).toBeNull();
  });

  it("UiCard shows the first five list items and reveals the rest on demand", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i + 1}` }));
    render(<UiCard toolCallId="u5" widget={{ kind: "ui", title: "Shopping", blocks: [{ type: "list", items }] }} />);
    expect(screen.getByText("Item 5")).toBeInTheDocument();
    expect(screen.queryByText("Item 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(screen.getByText("Item 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("UiCard collapses long checklists and tables the same way", () => {
    const checklist = { type: "checklist" as const, items: Array.from({ length: 9 }, (_, i) => ({ text: `Task ${i + 1}` })) };
    const table = { type: "table" as const, columns: ["A"], rows: Array.from({ length: 8 }, (_, i) => [`Row ${i + 1}`]) };
    render(<UiCard toolCallId="u6" widget={{ kind: "ui", title: "Plan", blocks: [checklist, table] }} />);
    expect(screen.queryByText("Task 6")).toBeNull();
    expect(screen.queryByText("Row 6")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 3 more" })).toBeInTheDocument();
  });

  it("GroundingNote lists the claims", () => {
    render(<WidgetRenderer toolCallId="g1" args={{ widget: validWidgets.grounding_note }} locale="en-US" />);
    expect(screen.getByText(/\$7\.49, In Stock/)).toBeInTheDocument();
  });

  it("WidgetRenderer renders nothing for invalid payload", () => {
    const { container } = render(<WidgetRenderer toolCallId="x" args={{ widget: { kind: "weather_card" } }} locale="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("WidgetRenderer dispatches on kind", () => {
    render(<WidgetRenderer toolCallId="x" args={{ widget: validWidgets.ui }} locale="en-US" />);
    expect(screen.getByText("Diwali party for 25")).toBeInTheDocument();
  });

  it("all rendered elements have unique ids", () => {
    const { container } = render(
      <div id="t-root">
        {Object.values(validWidgets).map((w, i) => (
          <WidgetRenderer key={i} toolCallId={`tc${i}`} args={{ widget: w }} locale="en-IN" />
        ))}
      </div>,
    );
    const els = [...container.querySelectorAll("*")];
    const ids = els.map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
