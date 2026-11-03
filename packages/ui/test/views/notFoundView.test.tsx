import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotFoundView } from "../../src/views/NotFoundView.tsx";
import { expectUniqueIds } from "../support/ids";
import { nav } from "../support/navigation";
import { renderWithPlatform } from "../support/platform";

describe("NotFoundView", () => {
  it("renders the shell not-found markup with a link home", () => {
    nav.reset("/nope");
    const { container } = renderWithPlatform(<NotFoundView />);
    expect(document.getElementById("shell-not-found-title")).toHaveTextContent("This page doesn't exist.");
    const home = document.getElementById("shell-not-found-home");
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveTextContent("Back to chat");
    fireEvent.click(home!);
    expect(nav.push).toHaveBeenCalledWith("/");
    expectUniqueIds(container);
  });
});
