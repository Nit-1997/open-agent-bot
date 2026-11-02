import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlightList } from "@/components/widgets/FlightList";
import { UiCard } from "@/components/widgets/UiCard";
import { WeatherCard } from "@/components/widgets/WeatherCard";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";
import { ReportCard } from "@/components/reports/ReportCard";
import { expectUniqueIds } from "../support/ids";
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

  it("FlightList shows the airline's logo", () => {
    const { container } = render(<FlightList toolCallId="f4" widget={validWidgets.flight_list} locale="en-US" />);
    expect(container.querySelector("img[src*='airindia.com']")).not.toBeNull();
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
    const clean = { ...validWidgets.ui, unverified: undefined, removedLinks: undefined };
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

  it("UiCard shows products as a row of picture cards", () => {
    const widget = {
      kind: "ui" as const,
      title: "Turf boots under $150",
      unverified: ["$95"],
      blocks: [
        {
          type: "cards" as const,
          items: [
            {
              title: "Mercurial Vapor 17 Academy TF",
              price: "$100",
              image: "https://static.nike.com/vapor.png",
              url: "https://www.nike.com/t/vapor",
              source: "Nike",
              badge: "Best pick",
            },
            { title: "Tiempo Maestro Academy TF", price: "$95", source: "Nike", note: "Touch and control" },
          ],
        },
      ],
    };
    const { container } = render(<UiCard toolCallId="p1" widget={widget} />);
    const row = screen.getByRole("list", { name: "Turf boots under $150" });
    expect(row.className).toMatch(/overflow-x-auto/);
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Mercurial Vapor 17 Academy TF/ })).toHaveAttribute("href", "https://www.nike.com/t/vapor");
    expect(screen.getByRole("img", { name: "Mercurial Vapor 17 Academy TF" })).toHaveAttribute("src", "https://static.nike.com/vapor.png");
    expect(cards[0]).toHaveTextContent("Best pick");
    expect(cards[1]).toHaveTextContent("Touch and control");
    expect(screen.getByTitle("Not found in the sources I read")).toHaveTextContent("$95");
    expect(cards[1].querySelector("img")).toBeNull();
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("UiCard falls back to a placeholder when a product image fails to load", () => {
    const widget = {
      kind: "ui" as const,
      title: "Boots",
      blocks: [{ type: "cards" as const, items: [{ title: "Phantom 6 Low", image: "https://x.com/broken.png" }] }],
    };
    render(<UiCard toolCallId="p2" widget={widget} />);
    fireEvent.error(screen.getByRole("img", { name: "Phantom 6 Low" }));
    expect(screen.queryByRole("img", { name: "Phantom 6 Low" })).toBeNull();
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("UiCard shows wide place cards with a rating and a map link", () => {
    const widget = {
      kind: "ui" as const,
      title: "Lisbon hotels",
      blocks: [
        {
          type: "cards" as const,
          shape: "wide" as const,
          items: [
            {
              title: "Memmo Alfama",
              subtitle: "Boutique · Alfama",
              rating: "4.7",
              price: "$310/night",
              place: "Memmo Alfama, Lisbon",
              image: "https://img.com/m.jpg",
              url: "https://memmo.com/alfama",
            },
          ],
        },
      ],
    };
    render(<UiCard toolCallId="p3" widget={widget} />);
    expect(screen.getByRole("img", { name: "Memmo Alfama" }).parentElement?.className).toMatch(/aspect-\[16\/10\]/);
    expect(screen.getByText("★ 4.7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=Memmo%20Alfama%2C%20Lisbon",
    );
    expect(screen.getByRole("link", { name: /Memmo Alfama/ })).toHaveAttribute("href", "https://memmo.com/alfama");
  });

  it("UiCard shows an image block with its caption", () => {
    const widget = {
      kind: "ui" as const,
      title: "Belém",
      blocks: [
        { type: "image" as const, url: "https://upload.wikimedia.org/belem.jpg", caption: "Belém Tower at sunset", source: "Wikipedia" },
      ],
    };
    render(<UiCard toolCallId="p4" widget={widget} />);
    expect(screen.getByRole("img", { name: "Belém Tower at sunset" })).toHaveAttribute("src", "https://upload.wikimedia.org/belem.jpg");
    expect(screen.getByText("Wikipedia")).toBeInTheDocument();
  });

  it("GroundingNote lists the claims", () => {
    render(<WidgetRenderer idPrefix="t" toolCallId="g1" args={{ widget: validWidgets.grounding_note }} locale="en-US" />);
    expect(screen.getByText(/\$7\.49, In Stock/)).toBeInTheDocument();
  });

  it("WidgetRenderer renders nothing for invalid payload", () => {
    const { container } = render(<WidgetRenderer idPrefix="t" toolCallId="x" args={{ widget: { kind: "weather_card" } }} locale="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("WidgetRenderer dispatches on kind", () => {
    render(<WidgetRenderer idPrefix="t" toolCallId="x" args={{ widget: validWidgets.ui }} locale="en-US" />);
    expect(screen.getByText("Diwali party for 25")).toBeInTheDocument();
  });

  it("all rendered elements have unique ids", () => {
    const { container } = render(
      <div id="t-root">
        {Object.values(validWidgets).map((w, i) => (
          <WidgetRenderer key={i} idPrefix="t" toolCallId={`tc${i}`} args={{ widget: w }} locale="en-IN" />
        ))}
      </div>,
    );
    const els = [...container.querySelectorAll("*")];
    const ids = els.map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("prefixes widget and report card ids with the pane, so two panes never collide", () => {
    const cart = {
      kind: "cart",
      stores: [
        {
          name: "Trader Joe's",
          total: 3,
          url: "https://www.traderjoes.com/",
          missing: [],
          items: [{ query: "tortillas", qty: 1, picks: [{ title: "Tortillas", price: 3, url: "https://www.traderjoes.com/t" }] }],
        },
      ],
    };
    const plan = { kind: "plan", entity: "event", id: "main", version: 1, value: { title: "Party", guests: 4 } };
    const all = [...Object.values(validWidgets), cart, plan];
    const pane = (prefix: string) => (
      <section id={prefix} key={prefix}>
        {all.map((w, i) => (
          <WidgetRenderer key={i} idPrefix={prefix} toolCallId={`tc${i}`} args={{ widget: w }} locale="en-US" />
        ))}
        <ReportCard
          idPrefix={prefix}
          toolCallId="tc-report"
          title="Guide"
          result="artifact abcdefghijkl created"
          current={false}
          hint="right"
          onOpen={() => {}}
        />
      </section>
    );
    const { container } = render(<div id="t-panes">{[pane("chat-pane-a"), pane("chat-pane-b")]}</div>);
    expectUniqueIds(container);
    for (const id of ["weather-card-tc0", "cart-tc4", "plan-tc5", "artifact-card-tc-report"])
      expect(document.getElementById(`chat-pane-b-${id}`)).not.toBeNull();
    for (const prefix of ["chat-pane-a", "chat-pane-b"]) {
      const inside = [...document.getElementById(prefix)!.querySelectorAll("[id]")].map((e) => e.id);
      expect(inside.filter((id) => !id.startsWith(`${prefix}-`))).toEqual([]);
    }
  });
});
