import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlightList } from "@/components/widgets/FlightList";
import { PlanChecklist } from "@/components/widgets/PlanChecklist";
import { ProductComparison } from "@/components/widgets/ProductComparison";
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

  it("ProductComparison renders blocked row with link", () => {
    render(<ProductComparison toolCallId="p1" widget={validWidgets.product_comparison} locale="en-IN" />);
    expect(screen.getByText("Site blocked automated access — open link")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Flipkart/ })).toHaveAttribute("href", "https://flipkart.com/x");
    expect(screen.getByText("₹26,990.00")).toBeInTheDocument();
  });

  it("FlightList always renders searchUrl link", () => {
    render(<FlightList toolCallId="f1" widget={{ ...validWidgets.flight_list, flights: [] }} locale="en-US" />);
    const link = screen.getByRole("link", { name: "Search & book yourself" });
    expect(link).toHaveAttribute("href", validWidgets.flight_list.searchUrl);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("PlanChecklist renders sections and items", () => {
    render(<PlanChecklist toolCallId="c1" widget={validWidgets.plan_checklist} />);
    expect(screen.getByText("Sweets")).toBeInTheDocument();
    expect(screen.getByText("Kaju katli")).toBeInTheDocument();
    expect(screen.getByText("1.5 kg")).toBeInTheDocument();
  });

  it("WidgetRenderer renders nothing for invalid payload", () => {
    const { container } = render(<WidgetRenderer toolCallId="x" args={{ widget: { kind: "weather_card" } }} locale="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("WidgetRenderer dispatches on kind", () => {
    render(<WidgetRenderer toolCallId="x" args={{ widget: validWidgets.plan_checklist }} locale="en-US" />);
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
