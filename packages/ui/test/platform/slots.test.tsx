import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessEnded, SessionEnded } from "../../src/components/shell/SessionFallbacks.tsx";
import { expectUniqueIds } from "../support/ids.ts";

describe("fallback session notices", () => {
  it("say the session ended in plain text, with unique ids and no links", () => {
    const { container } = render(
      <>
        <SessionEnded />
        <AccessEnded />
      </>,
    );
    expectUniqueIds(container);
    expect(container.querySelector("a, form, button")).toBeNull();
    expect(container.querySelector("#session-ended")).toHaveAttribute("role", "alert");
    expect(container.querySelector("#session-ended")).toHaveTextContent("Your session has ended. Reload the page to sign in again.");
    expect(container.querySelector("#access-ended-title")).toHaveAttribute("role", "alert");
    expect(container.querySelector("#access-ended-title")).toHaveTextContent("Your access has been turned off.");
  });
});
