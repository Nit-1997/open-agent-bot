import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StayList as StayListWidget } from "@shared/widgets";
import { StayList } from "@/components/widgets/StayList";
import { stepLabel } from "@/lib/steps";

const widget: StayListWidget = {
  kind: "stay_list",
  location: "Las Vegas",
  checkin: "2026-11-12",
  checkout: "2026-11-15",
  nights: 3,
  adults: 2,
  currency: "USD",
  sources: [
    {
      id: "google_hotels",
      label: "Google Hotels",
      site: "google.com",
      url: "https://www.google.com/travel/search?q=hotels",
      status: "ok",
      stays: [{ title: "Bellagio", url: "https://www.google.com/travel/search?q=Bellagio", nightly: 131, total: 393, rating: 4.7, ratingScale: 5, reviews: 144300, kind: "5-star hotel", badge: "24% off usual" }],
    },
    {
      id: "booking",
      label: "Booking.com",
      site: "booking.com",
      url: "https://www.booking.com/searchresults.html",
      status: "ok",
      stays: [{ title: "Flamingo", url: "https://www.booking.com/hotel/us/flamingo.html", nightly: 98, total: 294, rating: 7.8, ratingScale: 10 }],
    },
    { id: "airbnb", label: "Airbnb", site: "airbnb.com", url: "https://www.airbnb.com/s/Las%20Vegas/homes", status: "blocked", stays: [] },
    { id: "expedia", label: "Expedia", site: "expedia.com", url: "https://www.expedia.com/Hotel-Search", status: "link", stays: [] },
  ],
};

describe("StayList", () => {
  it("opens on all sites sorted by nightly price, with site labels", () => {
    const { container } = render(<StayList toolCallId="s1" widget={widget} />);
    expect(screen.getByText("Stays in Las Vegas")).toBeInTheDocument();
    expect(screen.getByText("Nov 12 – Nov 15 · 3 nights · 2 guests")).toBeInTheDocument();
    const titles = [...container.querySelectorAll('[id$="-title"]')].map((e) => e.textContent).filter((t) => t !== "Stays in Las Vegas");
    expect(titles).toEqual(["Flamingo", "Bellagio"]);
    expect(screen.getByText("7.8/10")).toBeInTheDocument();
    expect(container.querySelector("#stays-s1-all-0-source")?.textContent).toBe("Booking.com");
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("switches to one site and links out to the sites it couldn't read", () => {
    render(<StayList toolCallId="s2" widget={widget} />);
    fireEvent.click(screen.getByRole("tab", { name: "Google Hotels" }));
    expect(screen.queryByText("Flamingo")).toBeNull();
    expect(screen.getByText("24% off usual")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Blocked us · open Airbnb/ })).toHaveAttribute("href", "https://www.airbnb.com/s/Las%20Vegas/homes");
    expect(screen.getByRole("link", { name: /Search on Expedia/ })).toHaveAttribute("href", "https://www.expedia.com/Hotel-Search");
  });

  it("folds a long list on narrow screens until asked for more", () => {
    const many: StayListWidget = {
      ...widget,
      sources: [{ ...widget.sources[0], stays: Array.from({ length: 6 }, (_, i) => ({ title: `Hotel ${i}`, url: `https://www.google.com/travel/search?q=h${i}`, nightly: 100 + i })) }],
    };
    const { container } = render(<StayList toolCallId="s3" widget={many} />);
    const folded = () => [...container.querySelectorAll("li")].filter((li) => li.className.includes("hidden sm:block")).length;
    expect(folded()).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(folded()).toBe(0);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });

  it("labels the step", () => {
    expect(stepLabel("stays", { location: "Las Vegas" }, false)).toBe("Searching stays in Las Vegas");
  });
});
