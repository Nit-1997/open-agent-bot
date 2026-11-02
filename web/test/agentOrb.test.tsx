import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentOrb } from "@/components/agent/AgentOrb";

const classes = (el: Element | null) => new Set((el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));

describe("AgentOrb display", () => {
  it("defaults to inline-block for the orb and inline-flex for the avatar", () => {
    const { container } = render(
      <>
        <AgentOrb id="orb" look="mist" size={44} />
        <AgentOrb id="dp" look="mist" size={28} name="Juno" />
      </>,
    );
    expect(classes(container.querySelector("#orb")).has("inline-block")).toBe(true);
    expect(classes(container.querySelector("#dp")).has("inline-flex")).toBe(true);
  });

  it("drops its default display when the caller hides it on small screens", () => {
    const { container } = render(
      <>
        <AgentOrb id="orb" look="mist" size={72} className="hidden sm:inline-block" />
        <AgentOrb id="dp" look="mist" size={28} name="Juno" className="mt-0.5 hidden sm:inline-flex" />
      </>,
    );
    const orb = classes(container.querySelector("#orb"));
    const dp = classes(container.querySelector("#dp"));
    expect(orb.has("hidden")).toBe(true);
    expect(orb.has("inline-block")).toBe(false);
    expect(dp.has("hidden")).toBe(true);
    expect(dp.has("inline-flex")).toBe(false);
  });

  it("keeps its default display when the caller only hides it on larger screens", () => {
    const { container } = render(<AgentOrb id="orb" look="mist" size={44} className="sm:hidden" />);
    const orb = classes(container.querySelector("#orb"));
    expect(orb.has("inline-block")).toBe(true);
    expect(orb.has("sm:hidden")).toBe(true);
  });
});
