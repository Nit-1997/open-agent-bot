import { describe, expect, it, vi } from "vitest";
import { AccountMenuItems } from "../../src/components/shell/AccountMenuItems.tsx";
import { expectUniqueIds } from "../support/ids";
import { nav } from "../support/navigation";
import { shellPlatform, TEST_USER } from "../support/platform";
import { renderShell } from "../support/shell";

vi.mock("@copilotkit/react-core/v2", async () => (await import("../support/copilot")).copilotMock());

const platformWith = (user: { email: string; name: string }) => ({ ...shellPlatform(), user });

describe("AccountMenuItems email line", () => {
  it.each(["menu", "sheet"] as const)("%s shows the email when the user has one", (variant) => {
    nav.reset();
    const { container } = renderShell(<AccountMenuItems id="acct" variant={variant} onDone={() => {}} />);
    expect(document.getElementById("acct-email")).toHaveTextContent(TEST_USER.email);
    expect(document.getElementById("acct-email")).toHaveAttribute("title", TEST_USER.email);
    expectUniqueIds(container);
  });

  it.each(["menu", "sheet"] as const)("%s renders no email line when the email is empty", (variant) => {
    nav.reset();
    const { container } = renderShell(<AccountMenuItems id="acct" variant={variant} onDone={() => {}} />, {
      platform: platformWith({ email: "", name: "" }),
    });
    expect(document.getElementById("acct-email")).toBeNull();
    expect(document.getElementById("acct-who")).not.toBeNull();
    expect(document.getElementById("acct-name")).toHaveTextContent("Nitin Bhat");
    expect(document.getElementById("acct-profile")).not.toBeNull();
    expectUniqueIds(container);
  });
});
