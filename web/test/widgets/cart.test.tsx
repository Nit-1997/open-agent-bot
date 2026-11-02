import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Cart } from "@shared/widgets";
import { CartCard } from "@/components/widgets/CartCard";

const pick = (title: string, price: number, size?: string) => ({
  title,
  price,
  priceText: `$${price.toFixed(2)}`,
  url: `https://www.shipt.com/p/${encodeURIComponent(title)}`,
  image: `https://img.shipt.com/${encodeURIComponent(title)}.webp`,
  ...(size && { size }),
});

const cart: Cart = {
  kind: "cart",
  stores: [
    {
      name: "Target (Shipt)",
      total: 4.37,
      url: "https://www.shipt.com/",
      missing: ["cilantro"],
      items: [
        { query: "rice", qty: 1, picks: [pick("Good & Gather Rice 32oz", 2.39, "32 oz"), pick("Instant Rice 14oz", 1.89)] },
        { query: "black beans", qty: 2, picks: [pick("Good & Gather Black Beans", 0.99)] },
        { query: "cilantro", qty: 1, picks: [] },
      ],
    },
    {
      name: "Safeway (Shipt)",
      total: 6.5,
      url: "https://www.shipt.com/",
      missing: [],
      items: [{ query: "rice", qty: 1, picks: [pick("Signature Rice 2 lb", 3.5)] }],
    },
  ],
};

const subtotal = () => screen.getByTestId("cart-subtotal").textContent;

describe("CartCard", () => {
  it("shows the best-value store's items like a store cart, with a hand-off link", () => {
    const { container } = render(<CartCard toolCallId="c1" widget={cart} onEdit={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Target (Shipt)$4.37Best value", "Safeway (Shipt)$6.50"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "Good & Gather Rice 32oz" })).toHaveAttribute(
      "href",
      "https://www.shipt.com/p/Good%20%26%20Gather%20Rice%2032oz",
    );
    expect(screen.getByRole("img", { name: "Good & Gather Rice 32oz" })).toBeInTheDocument();
    expect(screen.getByText("Not found: cilantro")).toBeInTheDocument();
    expect(subtotal()).toBe("$4.37");
    expect(screen.getByRole("link", { name: /Continue on Shipt/ })).toHaveAttribute("href", "https://www.shipt.com/");
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("updates the subtotal as quantities change or items are removed", () => {
    render(<CartCard toolCallId="c2" widget={cart} onEdit={() => {}} />);
    const beans = screen.getByRole("listitem", { name: "black beans" });
    fireEvent.click(within(beans).getByRole("button", { name: "Increase quantity" }));
    expect(within(beans).getByText("3")).toBeInTheDocument();
    expect(subtotal()).toBe("$5.36");
    fireEvent.click(within(screen.getByRole("listitem", { name: "rice" })).getByRole("button", { name: "Remove" }));
    expect(subtotal()).toBe("$2.97");
    fireEvent.click(screen.getByRole("button", { name: "Add back rice" }));
    expect(subtotal()).toBe("$5.36");
  });

  it("swaps an item for another match from the same store", () => {
    render(<CartCard toolCallId="c3" widget={cart} onEdit={() => {}} />);
    const rice = screen.getByRole("listitem", { name: "rice" });
    fireEvent.click(within(rice).getByRole("button", { name: "Swap" }));
    fireEvent.click(within(rice).getByRole("button", { name: /Instant Rice 14oz/ }));
    expect(within(rice).getByRole("link", { name: "Instant Rice 14oz" })).toBeInTheDocument();
    expect(subtotal()).toBe("$3.87");
  });

  it("switches to another store's cart", () => {
    render(<CartCard toolCallId="c4" widget={cart} onEdit={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Safeway/ }));
    expect(screen.getByRole("link", { name: "Signature Rice 2 lb" })).toBeInTheDocument();
    expect(subtotal()).toBe("$3.50");
  });
});

describe("CartCard match labels", () => {
  const labeled: Cart = {
    kind: "cart",
    stores: [
      {
        name: "Target (Shipt)",
        total: 2.39,
        url: "https://www.shipt.com/",
        missing: [],
        items: [
          { query: "rice", qty: 1, picks: [{ ...pick("Good & Gather Rice 32oz", 2.39), match: "exact", why: "exact, 94%" }] },
          { query: "sour cream", qty: 1, picks: [{ ...pick("Greek Yogurt 16oz", 3.2), match: "substitute", why: "substitute, 71%" }] },
        ],
      },
    ],
  };

  it("badges substitutes with the reason on hover, and gives exact picks a quiet reason marker", () => {
    const { container } = render(<CartCard toolCallId="m1" widget={labeled} />);
    const row = screen.getByRole("listitem", { name: "sour cream" });
    const badge = within(row).getByText("Substitute");
    expect(badge).toHaveAttribute("title", "substitute, 71%");
    expect(within(screen.getByRole("listitem", { name: "rice" })).queryByText("Substitute")).toBeNull();
    expect(within(row).getByText(/not in total/)).toBeInTheDocument();
    expect(subtotal()).toBe("$2.39");
    expect(screen.getByText("1 substitute is not in this total")).toBeInTheDocument();
    expect(screen.getByLabelText("Match: exact, 94%")).toHaveAttribute("title", "exact, 94%");
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows no badge when the picks carry no match label", () => {
    render(<CartCard toolCallId="m2" widget={cart} />);
    expect(screen.queryByText("Substitute")).toBeNull();
  });
});

describe("CartCard edits", () => {
  it("treats the list as one cart: quantities and removals carry across store tabs", () => {
    render(<CartCard toolCallId="c5" widget={cart} onEdit={() => {}} />);
    fireEvent.click(within(screen.getByRole("listitem", { name: "rice" })).getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(screen.getByRole("tab", { name: /Safeway/ }));
    expect(within(screen.getByRole("listitem", { name: "rice" })).getByText("2")).toBeInTheDocument();
    expect(subtotal()).toBe("$7.00");
  });

  it("reports the user's edits so the next message can carry them", () => {
    const onEdit = vi.fn();
    render(<CartCard toolCallId="c6" widget={cart} onEdit={onEdit} />);
    fireEvent.click(within(screen.getByRole("listitem", { name: "black beans" })).getByRole("button", { name: "Remove" }));
    const rice = screen.getByRole("listitem", { name: "rice" });
    fireEvent.click(within(rice).getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(within(rice).getByRole("button", { name: "Swap" }));
    fireEvent.click(within(rice).getByRole("button", { name: /Instant Rice 14oz/ }));
    expect(onEdit).toHaveBeenLastCalledWith({
      removed: ["black beans"],
      qty: { rice: 2 },
      picks: { "Target (Shipt)": { rice: "Instant Rice 14oz" } },
    });
  });

  it("marks an older cart as replaced and locks it", () => {
    render(<CartCard toolCallId="c7" widget={cart} stale />);
    expect(screen.getByText("Updated cart below")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "rice" })).getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  });
});

describe("CartCard currency", () => {
  it("shows totals in the store's currency", () => {
    const inr: Cart = {
      kind: "cart",
      stores: [
        {
          name: "Amazon",
          total: 350,
          currency: "INR",
          url: "https://www.amazon.in/",
          missing: [],
          items: [{ query: "rice", qty: 1, picks: [{ title: "Rice 1kg", price: 350, priceText: "₹350", url: "https://www.amazon.in/r" }] }],
        },
      ],
    };
    render(<CartCard toolCallId="inr" widget={inr} locale="en-IN" />);
    expect(screen.getAllByRole("tab")[0].textContent).toContain("₹350.00");
    expect(screen.getByTestId("cart-subtotal").textContent).toBe("₹350.00");
  });
});

describe("CartCard without edits", () => {
  it("is read-only: no swap or remove, steppers disabled, store tabs still switch, unsafe links render as text", () => {
    const unsafe = {
      ...cart,
      stores: cart.stores.map((st, n) =>
        n === 0
          ? {
              ...st,
              items: st.items.map((i, k) => (k === 0 ? { ...i, picks: i.picks.map((p) => ({ ...p, url: "javascript:alert(1)" })) } : i)),
            }
          : st,
      ),
    };
    const { container } = render(<CartCard toolCallId="ro" widget={unsafe} />);
    expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    for (const b of screen.getAllByRole("button", { name: /quantity/ })) expect(b).toBeDisabled();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });
});

describe("CartCard from an earlier session", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const note = (tc: string) => document.getElementById(`cart-${tc}-locked-note`)?.textContent;

  it("is live with edits: steppers, swap and remove enabled, and no dated note", () => {
    render(<CartCard toolCallId="live" widget={cart} onEdit={() => {}} agentName="Sage" now={now} />);
    const rice = screen.getByRole("listitem", { name: "rice" });
    expect(within(rice).getByRole("button", { name: "Increase quantity" })).toBeEnabled();
    expect(within(rice).getByRole("button", { name: "Swap" })).toBeEnabled();
    expect(within(rice).getByRole("button", { name: "Remove" })).toBeEnabled();
    expect(note("live")).toBeUndefined();
  });

  it("is locked and dated: steppers disabled, no swap, remove or alternatives, store tabs still switch", () => {
    render(<CartCard toolCallId="old" widget={cart} lockedAt="2026-11-01T12:00:00Z" agentName="Sage" now={now} />);
    expect(note("old")).toBe("Prices from Nov 1 · ask Sage to refresh");
    for (const b of screen.getAllByRole("button", { name: /quantity/ })) expect(b).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Swap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("says the prices may be out of date when the date is unknown or invalid", () => {
    const { rerender } = render(<CartCard toolCallId="nodate" widget={cart} lockedAt={null} agentName="Sage" now={now} />);
    expect(note("nodate")).toBe("Prices may be out of date · ask Sage to refresh");
    rerender(<CartCard toolCallId="nodate" widget={cart} lockedAt="yesterday" agentName="Sage" now={now} />);
    expect(note("nodate")).toBe("Prices may be out of date · ask Sage to refresh");
  });

  it("keeps a replaced card's header and gives it no dated note", () => {
    render(<CartCard toolCallId="gone" widget={cart} stale agentName="Sage" now={now} />);
    expect(screen.getByText("Updated cart below")).toBeInTheDocument();
    expect(note("gone")).toBeUndefined();
  });

  it("renders unsafe pick and hand-off links as text when locked", () => {
    const unsafe: Cart = {
      kind: "cart",
      stores: [
        {
          ...cart.stores[1],
          url: "javascript:alert(1)",
          items: [{ query: "rice", qty: 1, picks: [{ ...pick("Signature Rice 2 lb", 3.5), url: "javascript:alert(2)" }] }],
        },
      ],
    };
    const { container } = render(<CartCard toolCallId="js" widget={unsafe} lockedAt="2026-11-01T12:00:00Z" agentName="Sage" now={now} />);
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText("Signature Rice 2 lb")).toBeInTheDocument();
  });
});
