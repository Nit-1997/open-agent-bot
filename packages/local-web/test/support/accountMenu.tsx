import { historyRouter } from "@oab/ui/platform";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { LocalApp } from "../../src/LocalApp.tsx";
import { mockViewport } from "./media.ts";

export async function openAccountMenu(): Promise<HTMLElement> {
  mockViewport(1440);
  window.history.replaceState(null, "", "/");
  render(<LocalApp router={historyRouter()} />);
  await waitFor(() => expect(document.getElementById("account-menu-button")).not.toBeNull());
  await act(async () => {
    fireEvent.click(document.getElementById("account-menu-button")!);
  });
  const items = document.getElementById("account-menu-items");
  if (!items) throw new Error("the account menu did not open");
  return items;
}
