import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StayList as StayListWidget, UiWidget } from "@oab/shared/widgets";
import { SourcesRow } from "@/components/chat/SourcesRow";
import { CartCard } from "@/components/widgets/CartCard";
import { StayList } from "@/components/widgets/StayList";
import { UiCard } from "@/components/widgets/UiCard";
import { expectUniqueIds } from "../support/ids";

const BAD = ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example/x"];

function expectNoUnsafeUrls(root: HTMLElement) {
  const hrefs = [...root.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
  const srcs = [...root.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
  for (const v of [...hrefs, ...srcs]) expect(v).toMatch(/^https?:\/\//);
}

describe("widgets never link to or load a non-http URL", () => {
  it.each(BAD)("ui cards and image blocks drop %s", (bad) => {
    const widget = {
      kind: "ui",
      title: "Picks",
      blocks: [
        {
          type: "cards",
          items: [
            { title: "Bad", url: bad, image: bad },
            { title: "Good", url: "https://shop.example/a", image: "https://img.example/a.png" },
          ],
        },
        { type: "image", url: bad, caption: "bad" },
        { type: "image", url: "https://img.example/b.png", caption: "good" },
      ],
    } as unknown as UiWidget;
    const { container } = render(<UiCard toolCallId="u1" widget={widget} />);
    expectNoUnsafeUrls(container);
    expect(container.querySelectorAll("a[href='https://shop.example/a']")).toHaveLength(1);
    expect(container.querySelectorAll("img[src='https://img.example/b.png']")).toHaveLength(1);
    expectUniqueIds(container);
  });

  it.each(BAD)("stays and their other sources drop %s", (bad) => {
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
          url: bad,
          status: "ok",
          stays: [{ title: "Bellagio", url: bad, image: bad, nightly: 131, total: 393 }],
        },
        { id: "airbnb", label: "Airbnb", site: "airbnb.com", url: bad, status: "blocked", stays: [] },
      ],
    };
    const { container } = render(<StayList toolCallId="s1" widget={widget} />);
    expectNoUnsafeUrls(container);
    expect(container).toHaveTextContent("Bellagio");
    expectUniqueIds(container);
  });

  it.each(BAD)("cart picks drop %s as an image", (bad) => {
    const cart = {
      kind: "cart" as const,
      stores: [
        {
          name: "Target",
          total: 2,
          url: "https://www.target.com/",
          missing: [],
          items: [{ query: "rice", qty: 1, picks: [{ title: "Rice", price: 2, url: bad, image: bad }] }],
        },
      ],
    };
    const { container } = render(<CartCard toolCallId="c1" widget={cart} />);
    expectNoUnsafeUrls(container);
  });

  it.each(BAD)("sources drop %s", (bad) => {
    const { container, getByRole } = render(
      <SourcesRow
        id="src"
        sources={[
          { url: bad, title: "Bad", host: "evil.example" },
          { url: "https://good.example/a", title: "Good", host: "good.example" },
        ]}
      />,
    );
    fireEvent.click(getByRole("button"));
    expectNoUnsafeUrls(container);
    expect(container).toHaveTextContent("Bad");
    expectUniqueIds(container);
  });
});
