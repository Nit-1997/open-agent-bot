import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivitySteps } from "@/components/chat/ActivitySteps";
import { Markdown } from "@/components/chat/Markdown";
import { SourcesRow } from "@/components/chat/SourcesRow";
import { AccessDisabled, SignedOutBanner } from "@/components/SessionNotices";
import { noteAuthFailure, resetAuthState, useAuthState } from "@/lib/authState";
import type { Step } from "@/lib/turns";

import { expectUniqueIds, htmlIds } from "../support/ids";

describe("Markdown", () => {
  it("gives every element a unique id and opens links in a new tab", () => {
    const { container } = render(
      <Markdown id="m1" text={"# Plan\n\n- **one** [Target](https://target.com)\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |"} />,
    );
    const ids = htmlIds(container);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getByRole("link", { name: "Target" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("drops images the model writes", () => {
    const { container } = render(<Markdown id="m2" text="![x](https://tracker.example/p.gif)" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("SourcesRow", () => {
  const sources = [
    { url: "https://target.com/a", title: "Target diyas", host: "target.com" },
    { url: "https://walmart.com/b", title: "Walmart lanterns", host: "walmart.com" },
  ];

  it("shows a compact count and expands into the list", () => {
    render(<SourcesRow id="s1" sources={sources} />);
    expect(screen.queryByRole("link", { name: /Target diyas/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 sources/ }));
    expect(screen.getByRole("link", { name: /Target diyas/ })).toHaveAttribute("href", "https://target.com/a");
  });

  it("renders nothing without sources", () => {
    const { container } = render(<SourcesRow id="s2" sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ActivitySteps", () => {
  const steps: Step[] = [
    { id: "a", name: "web_search", args: { query: "diyas" }, done: true, sites: ["target.com"] },
    { id: "b", name: "fetch_page", args: { url: "https://walmart.com/x" }, done: false, sites: [] },
  ];

  it("shows the live step while running", () => {
    render(<ActivitySteps id="a1" steps={steps} running startedAt={0} now={5000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Reading walmart.com");
    expect(screen.getByText("5s")).toBeInTheDocument();
  });

  it("collapses to a summary when done and expands to the steps", () => {
    render(
      <ActivitySteps id="a2" steps={steps.map((s) => ({ ...s, done: true }))} running={false} startedAt={0} endedAt={12000} now={0} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Worked for 12s");
    expect(screen.getByText("1 search · 1 page read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Worked for 12s/ }));
    expect(screen.getByText("Searched “diyas”")).toBeInTheDocument();
    expect(screen.getByText("Read walmart.com")).toBeInTheDocument();
  });

  it("says it's thinking before any step starts", () => {
    render(<ActivitySteps id="a3" steps={[]} running now={0} />);
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
  });
});

function AuthProbe() {
  return <p id="probe">{useAuthState()}</p>;
}

describe("session notices", () => {
  afterEach(() => resetAuthState());

  it("render unique ids", () => {
    const { container } = render(
      <>
        <SignedOutBanner />
        <AccessDisabled />
      </>,
    );
    expectUniqueIds(container);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText("Your access has been turned off.")).toBeInTheDocument();
  });

  it("tracks signed_out and account_disabled from API answers, and never downgrades disabled", () => {
    render(<AuthProbe />);
    act(() => noteAuthFailure(401, "unauthorized"));
    expect(screen.getByText("active")).toBeInTheDocument();
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByText("signed_out")).toBeInTheDocument();
    act(() => noteAuthFailure(403, "account_disabled"));
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByText("account_disabled")).toBeInTheDocument();
  });
});
