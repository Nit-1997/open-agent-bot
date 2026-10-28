import { describe, expect, it } from "vitest";
import type { UiWidget } from "../../../shared/widgets.js";
import { Evidence } from "../../src/grounding/evidence.js";
import { groundUi } from "../../src/grounding/groundUi.js";

const evidence = () => {
  const e = new Evidence();
  e.add("Target Diwali Diya 12ct $6.99 In stock https://www.target.com/p/diya/-/A-84311898");
  return e;
};

const card = (blocks: UiWidget["blocks"]): UiWidget => ({ kind: "ui", title: "Diwali shopping", blocks });

describe("groundUi", () => {
  it("leaves a fully sourced card untouched", () => {
    const w = card([{ type: "list", items: [{ title: "Diya 12ct", value: "$6.99", badge: "In stock", url: "https://www.target.com/p/diya/-/A-84311898" }] }]);
    expect(groundUi(w, evidence())).toEqual(w);
  });

  it("lists unsourced claims from every block", () => {
    const w = card([
      { type: "table", columns: ["Item", "Price"], rows: [["Lantern", "$5.99"]] },
      { type: "stats", items: [{ label: "Rating", value: "4.8 stars" }] },
      { type: "list", items: [{ title: "Rangoli kit", value: "$7.49", badge: "Sold out" }] },
    ]);
    expect(groundUi(w, evidence()).unverified).toEqual(["$5.99", "4.8 stars", "$7.49", "Sold out"]);
  });

  it("removes links that no source contained", () => {
    const w = card([
      { type: "list", items: [{ title: "Made-up product", url: "https://www.target.com/p/fake/-/A-1" }] },
      { type: "links", items: [{ label: "Target", url: "https://www.target.com/p/diya/-/A-84311898" }, { label: "Fake", url: "https://fake.example/x" }] },
      { type: "links", items: [{ label: "Fake 2", url: "https://fake.example/y" }] },
    ]);
    const g = groundUi(w, evidence());
    expect(g.blocks[0]).toEqual({ type: "list", items: [{ title: "Made-up product" }] });
    expect(g.blocks[1]).toEqual({ type: "links", items: [{ label: "Target", url: "https://www.target.com/p/diya/-/A-84311898" }] });
    expect(g.blocks).toHaveLength(2);
    expect(g.removedLinks).toBe(3);
  });

  it("drops product images and links that no source contained, keeping the item", () => {
    const e = evidence();
    e.add("img: Diya 12ct — https://target.scene7.com/is/image/Target/diya?wid=400");
    const w = card([
      {
        type: "products",
        items: [
          { title: "Diya 12ct", price: "$6.99", image: "https://target.scene7.com/is/image/Target/diya?wid=800", url: "https://www.target.com/p/diya/-/A-84311898" },
          { title: "Lantern", price: "$5.99", image: "https://cdn.fake.example/lantern.jpg", url: "https://www.target.com/p/fake/-/A-2" },
        ],
      },
    ]);
    const g = groundUi(w, e);
    expect(g.blocks[0]).toEqual({
      type: "products",
      items: [
        { title: "Diya 12ct", price: "$6.99", image: "https://target.scene7.com/is/image/Target/diya?wid=800", url: "https://www.target.com/p/diya/-/A-84311898" },
        { title: "Lantern", price: "$5.99" },
      ],
    });
    expect(g.removedLinks).toBe(1);
    expect(g.unverified).toEqual(["$5.99"]);
  });

  it("does not trust claims the card itself would add to evidence", () => {
    const e = evidence();
    groundUi(card([{ type: "text", text: "$9.99" }]), e);
    expect(groundUi(card([{ type: "text", text: "$9.99" }]), e).unverified).toEqual(["$9.99"]);
  });
});
