import { render, screen, within } from "@testing-library/react";
import type { FlightList as FlightListData } from "@shared/widgets";
import { describe, expect, it } from "vitest";
import { FlightList } from "@/components/widgets/FlightList";

const widget: FlightListData = {
  kind: "flight_list",
  from: "SJC · SFO · OAK",
  to: "LAS",
  date: "2026-11-25",
  returnDate: "2026-11-29",
  currency: "USD",
  priceNote: "Round-trip total for 2 adults, incl. taxes and fees",
  flights: [
    { airline: "Frontier", departTime: "3:10 pm", arriveTime: "8:57 pm", duration: "5 hrs 47 min", stops: 1, price: 543, origin: "SFO" },
    { airline: "Southwest", departTime: "8:00 am", arriveTime: "9:35 am", duration: "1 hr 35 min", stops: 0, price: 600, origin: "SJC" },
  ],
  airports: [
    { code: "SJC", name: "San Jose", miles: 6, ground: 45, bestFare: 600, total: 645, status: "ok", searchUrl: "https://g/sjc", closest: true, cheapest: true, recommended: true },
    { code: "SFO", name: "San Francisco", miles: 26, ground: 135, bestFare: 543, total: 678, status: "ok", searchUrl: "https://g/sfo" },
    { code: "OAK", name: "Oakland", status: "failed", searchUrl: "https://g/oak" },
  ],
  searchUrl: "https://g/sjc",
  source: "Google Flights",
};

describe("FlightList comparing airports", () => {
  it("ranks the airports with ride estimates, totals and badges", () => {
    render(<FlightList toolCallId="fc1" widget={widget} locale="en-US" />);
    const rows = screen.getAllByRole("listitem").filter((li) => li.id.includes("-airport-"));
    expect(rows.map((r) => r.id.split("-airport-")[1])).toEqual(["0", "1", "2"]);
    const sjc = within(rows[0]);
    expect(sjc.getByText("SJC")).toBeInTheDocument();
    expect(sjc.getByText("Recommended")).toBeInTheDocument();
    expect(sjc.getByText("6 mi · ~$45 ride")).toBeInTheDocument();
    expect(sjc.getByText("$645 all-in")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("link", { name: /couldn't load/i })).toHaveAttribute("href", "https://g/oak");
  });

  it("tags each flight with its airport and states what the prices cover", () => {
    render(<FlightList toolCallId="fc2" widget={widget} locale="en-US" />);
    expect(screen.getAllByText("SFO", { selector: "[id*='-flight-'][id$='-origin']" })).toHaveLength(1);
    expect(screen.getByText("Round-trip total for 2 adults, incl. taxes and fees")).toBeInTheDocument();
    expect(screen.getByText(/Nov 25 → .*Nov 29/)).toBeInTheDocument();
    expect(screen.getByText(/rides are rough estimates/i)).toBeInTheDocument();
  });
});
