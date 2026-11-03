import { fireEvent, render, screen } from "@testing-library/react";
import type { AskWidget } from "@oab/shared/widgets";
import { describe, expect, it, vi } from "vitest";
import { AskCard, formatAnswers } from "../../src/components/widgets/AskCard.tsx";
import { WeatherCard } from "../../src/components/widgets/WeatherCard.tsx";

const widget: AskWidget = {
  kind: "ask",
  question: "Which dates should I plan around?",
  fields: [
    { type: "date_range", label: "Travel dates", start: "2026-11-25", end: "2026-11-29" },
    { type: "number", label: "Travelers", value: 1, min: 1, max: 9 },
    { type: "choice", label: "Budget", options: ["Saver", "Comfort", "Splurge"], value: "Comfort" },
    { type: "text", label: "Flying from", value: "SJC" },
  ],
};

describe("AskCard", () => {
  it("shows the agent's guesses prefilled", () => {
    render(<AskCard toolCallId="q1" widget={widget} locale="en-US" />);
    expect(screen.getByLabelText("Travel dates from")).toHaveValue("2026-11-25");
    expect(screen.getByLabelText("Travel dates to")).toHaveValue("2026-11-29");
    expect(screen.getByText("4 nights")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Comfort" })).toBeChecked();
    expect(screen.getByLabelText("Flying from")).toHaveValue("SJC");
  });

  it("sends the confirmed answers as one readable message", () => {
    const onAnswer = vi.fn();
    render(<AskCard toolCallId="q2" widget={widget} locale="en-US" onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText("Travel dates to"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "More Travelers" }));
    fireEvent.click(screen.getByRole("radio", { name: "Saver" }));
    fireEvent.click(screen.getByRole("button", { name: /looks good/i }));
    expect(onAnswer).toHaveBeenCalledWith(
      "Travel dates: Wed, Nov 25 – Mon, Nov 30, 2026 (5 nights)\nTravelers: 2\nBudget: Saver\nFlying from: SJC",
    );
  });

  it("won't send an end date before the start date", () => {
    render(<AskCard toolCallId="q3" widget={widget} locale="en-US" onAnswer={() => {}} />);
    fireEvent.change(screen.getByLabelText("Travel dates to"), { target: { value: "2026-11-20" } });
    expect(screen.getByRole("button", { name: /looks good/i })).toBeDisabled();
  });

  it("locks once answered", () => {
    render(<AskCard toolCallId="q4" widget={widget} locale="en-US" answered />);
    expect(screen.getByLabelText("Flying from")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /looks good/i })).toBeNull();
    expect(screen.getByText("Quick check answered")).toBeInTheDocument();
    expect(screen.queryByText("Which dates should I plan around?")).toBeNull();
  });

  it("formats a single-day range without nights", () => {
    expect(
      formatAnswers([{ type: "date_range", label: "Date", start: "2026-11-26", end: "2026-11-26" }], ["2026-11-26|2026-11-26"], "en-US"),
    ).toBe("Date: Thu, Nov 26, 2026");
  });
});

describe("WeatherCard typical mode", () => {
  it("labels typical weather as not a forecast and drops current conditions", () => {
    render(
      <WeatherCard
        toolCallId="w9"
        widget={{
          kind: "weather_card",
          mode: "typical",
          basis: "2023–2025",
          location: "Las Vegas, United States",
          units: "imperial",
          days: [{ date: "2026-11-26", high: 64, low: 44, condition: "Clear", precipChance: 0 }],
          source: "https://open-meteo.com",
        }}
      />,
    );
    expect(screen.getByText("Typical, not a forecast")).toBeInTheDocument();
    expect(screen.getByText(/Averaged over 2023–2025/)).toBeInTheDocument();
    expect(screen.getByText("44–64°F")).toBeInTheDocument();
    expect(screen.getByText(/0% of past years/)).toBeInTheDocument();
  });
});
