import { fireEvent, render, screen, within } from "@testing-library/react";
import type { FlightList as FlightListData } from "@oab/shared/widgets";
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
    {
      airline: "Frontier",
      departTime: "3:10 PM",
      arriveTime: "8:57 PM",
      duration: "5 hr 47 min",
      stops: 1,
      layoverMinutes: 400,
      layoverAt: "DEN",
      price: 543,
      origin: "SFO",
    },
    { airline: "Frontier", departTime: "10:30 PM", arriveTime: "11:59 PM", duration: "1 hr 29 min", stops: 0, price: 596, origin: "SFO" },
    { airline: "Southwest", departTime: "4:15 PM", arriveTime: "5:48 PM", duration: "1 hr 33 min", stops: 0, price: 623, origin: "SJC" },
  ],
  airports: [
    { code: "SJC", name: "San Jose", miles: 7.5, driveMinutes: 14, rideOneWay: 26, status: "ok", searchUrl: "https://g/sjc" },
    { code: "SFO", name: "San Francisco", miles: 33, driveMinutes: 38, rideOneWay: 85, status: "ok", searchUrl: "https://g/sfo" },
    { code: "OAK", name: "Oakland", status: "failed", searchUrl: "https://g/oak" },
  ],
  searchUrl: "https://g/sjc",
  source: "Google Flights",
};

const airportRows = () => screen.getAllByRole("listitem").filter((li) => /-airport-\d+$/.test(li.id));
const flightRows = () => screen.getAllByRole("listitem").filter((li) => /-flight-\d+$/.test(li.id));

describe("FlightList comparing airports", () => {
  it("ranks airports by fare plus a round-trip ride", () => {
    render(<FlightList toolCallId="fc1" widget={widget} locale="en-US" />);
    const rows = airportRows();
    expect(rows.map((r) => within(r).getByText(/^(SJC|SFO|OAK)$/).textContent)).toEqual(["SJC", "SFO", "OAK"]);
    expect(within(rows[0]).getByText("Best value")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Closest")).toBeInTheDocument();
    expect(within(rows[0]).getByText("~$26 each way · 14 min drive")).toBeInTheDocument();
    expect(within(rows[0]).getByText("$675 all-in")).toBeInTheDocument();
    expect(within(rows[1]).getByText("$713 all-in")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("link", { name: /couldn't load/i })).toHaveAttribute("href", "https://g/oak");
  });

  it("filters flights and re-ranks airports when a preference changes", () => {
    render(<FlightList toolCallId="fc2" widget={widget} locale="en-US" />);
    expect(flightRows()).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: "Up to 5h" }));
    expect(flightRows()).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: /Late night/ }));
    expect(flightRows()).toHaveLength(1);
    const rows = airportRows();
    expect(within(rows[0]).getByText("SFO")).toBeInTheDocument();
    expect(within(rows[0]).getByText("$766 all-in")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No flights match these filters")).toBeInTheDocument();
  });

  it("starts from the preferences the user gave", () => {
    render(<FlightList toolCallId="fc3" widget={{ ...widget, prefs: { maxLayover: "nonstop", times: ["evening"] } }} locale="en-US" />);
    expect(screen.getByRole("radio", { name: "Nonstop" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Evening/ })).toBeChecked();
    expect(flightRows()).toHaveLength(1);
  });

  it("shows layovers, airport tags and what the prices cover", () => {
    render(<FlightList toolCallId="fc4" widget={widget} locale="en-US" />);
    expect(screen.getByText("1 stop · 6h 40m in DEN")).toBeInTheDocument();
    expect(screen.getAllByText("SFO", { selector: "[id$='-origin']" })).toHaveLength(2);
    expect(screen.getByText("Round-trip total for 2 adults, incl. taxes and fees")).toBeInTheDocument();
    expect(screen.getByText(/Nov 25 → .*Nov 29/)).toBeInTheDocument();
    expect(screen.getByText(/rides are estimates/i)).toBeInTheDocument();
  });
});
