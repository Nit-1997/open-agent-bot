import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Cart } from "@shared/widgets";
import { CartCard } from "@/components/widgets/CartCard";

const pick = (title: string, price: number, size?: string) => ({ title, price, priceText: `$${price.toFixed(2)}`, url: `https://www.shipt.com/p/${encodeURIComponent(title)}`, image: `https://img.shipt.com/${encodeURIComponent(title)}.webp`, ...(size && { size }) });

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
    { name: "Safeway (Shipt)", total: 6.5, url: "https://www.shipt.com/", missing: [], items: [{ query: "rice", qty: 1, picks: [pick("Signature Rice 2 lb", 3.5)] }] },
  ],
};

const subtotal = () => screen.getByTestId("cart-subtotal").textContent;

describe("CartCard", () => {
  it("shows the best-value store's items like a store cart, with a hand-off link", () => {
    const { container } = render(<CartCard toolCallId="c1" widget={cart} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Target (Shipt)$4.37Best value", "Safeway (Shipt)$6.50"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("link", { name: "Good & Gather Rice 32oz" })).toHaveAttribute("href", "https://www.shipt.com/p/Good%20%26%20Gather%20Rice%2032oz");
    expect(screen.getByRole("img", { name: "Good & Gather Rice 32oz" })).toBeInTheDocument();
    expect(screen.getByText("Not found: cilantro")).toBeInTheDocument();
    expect(subtotal()).toBe("$4.37");
    expect(screen.getByRole("link", { name: /Continue on Shipt/ })).toHaveAttribute("href", "https://www.shipt.com/");
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("updates the subtotal as quantities change or items are removed", () => {
    render(<CartCard toolCallId="c2" widget={cart} />);
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
    render(<CartCard toolCallId="c3" widget={cart} />);
    const rice = screen.getByRole("listitem", { name: "rice" });
    fireEvent.click(within(rice).getByRole("button", { name: "Swap" }));
    fireEvent.click(within(rice).getByRole("button", { name: /Instant Rice 14oz/ }));
    expect(within(rice).getByRole("link", { name: "Instant Rice 14oz" })).toBeInTheDocument();
    expect(subtotal()).toBe("$3.87");
  });

  it("switches to another store's cart", () => {
    render(<CartCard toolCallId="c4" widget={cart} />);
    fireEvent.click(screen.getByRole("tab", { name: /Safeway/ }));
    expect(screen.getByRole("link", { name: "Signature Rice 2 lb" })).toBeInTheDocument();
    expect(subtotal()).toBe("$3.50");
  });
});

describe("CartCard edits", () => {
  it("treats the list as one cart: quantities and removals carry across store tabs", () => {
    render(<CartCard toolCallId="c5" widget={cart} />);
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
    expect(onEdit).toHaveBeenLastCalledWith({ removed: ["black beans"], qty: { rice: 2 }, picks: { "Target (Shipt)": { rice: "Instant Rice 14oz" } } });
  });

  it("marks an older cart as replaced and locks it", () => {
    render(<CartCard toolCallId="c7" widget={cart} stale />);
    expect(screen.getByText("Updated cart below")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "rice" })).getByRole("button", { name: "Increase quantity" })).toBeDisabled();
  });
});
