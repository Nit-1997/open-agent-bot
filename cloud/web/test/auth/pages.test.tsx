import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmPage from "@/app/auth/confirm/page";
import LoginPage from "@/app/login/page";
import RequestAccessPage from "@/app/request-access/page";
import { getClaimsOrNull } from "@/lib/auth";
import { linkBinding } from "@/lib/authCookies";
import { AUTH_ERROR_COPY } from "@oab/ui/lib/authErrors.ts";
import { checkFormTs } from "@/lib/formToken";
import { stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getClaimsOrNull: vi.fn(async () => null),
}));
vi.mock("@/app/login/actions", () => ({ signInWithGoogle: vi.fn(), requestEmailLink: vi.fn() }));
vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: vi.fn() }));
vi.mock("@/app/auth/confirm/actions", () => ({ confirmEmailLink: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
}));

const byIdIn = (root: HTMLElement, id: string) => root.querySelector(`#${id}`);

class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const params = (p: Record<string, string>) => ({ searchParams: Promise.resolve(p) });

const expectUniqueIds = (root: HTMLElement) => {
  const ids = [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
};

beforeEach(stubAgentEnv);
afterEach(() => vi.unstubAllEnvs());

describe("/login", () => {
  it("shows the mapped error, the Google button with a safe next, the email form and the request link", async () => {
    const { container } = render(await LoginPage(params({ error: "not_invited", next: "//evil.com" })));
    expect(screen.getByRole("alert")).toHaveTextContent(AUTH_ERROR_COPY.not_invited);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveAttribute("id", "login-google");
    expect(document.querySelector("#login-google svg")).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>("#login-google-next")?.value).toBe("/");
    expect(document.getElementById("login-email-input")).toHaveAttribute("type", "email");
    expect(document.getElementById("login-email-submit")).toHaveTextContent("Email me a sign-in link");
    expect(screen.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    expectUniqueIds(container);
  });

  it("hides the email-link form behind an invited-only toggle and leads newcomers to Request access", async () => {
    const { container } = render(await LoginPage(params({})));
    expect(document.getElementById("login-email-input")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Invited, but no Google account/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(document.getElementById("login-email-input")).toHaveAttribute("type", "email");
    expect(screen.getByText(/This doesn't request access/)).toBeInTheDocument();
    expect(screen.getByText("New to Open Agent?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/request-access");
    expectUniqueIds(container);
  });

  it("never renders an unknown error value", async () => {
    render(await LoginPage(params({ error: "<img src=x onerror=alert(1)>" })));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps /admin as the next path", async () => {
    const { container } = render(await LoginPage(params({ next: "/admin" })));
    expect(container.querySelector<HTMLInputElement>("#login-google-next")?.value).toBe("/admin");
  });

  it("sends a signed-in visitor home", async () => {
    vi.mocked(getClaimsOrNull).mockResolvedValueOnce({ id: "u", email: "a@b.test", name: "", isAdmin: false });
    await expect(LoginPage(params({}))).rejects.toThrow("/");
  });
});

describe("site nav on the sign-in pages", () => {
  it("links /login back home and to the home page sections, with no Sign in button", async () => {
    const { container } = render(await LoginPage(params({})));
    expect(container.querySelector("#login-nav-logo")).toHaveAttribute("href", "/");
    expect(container.querySelector("#login-nav-how")).toHaveAttribute("href", "/#landing-demo");
    expect(container.querySelector("#login-nav-try")).toHaveAttribute("href", "/#landing-ways");
    expect(container.querySelector("#login-nav-signin")).toBeNull();
    expectUniqueIds(container);
  });

  it("links /request-access back home and offers Sign in", async () => {
    const { container } = render(await RequestAccessPage());
    expect(container.querySelector("#request-access-nav-logo")).toHaveAttribute("href", "/");
    expect(container.querySelector("#request-access-nav-signin")).toHaveAttribute("href", "/login");
    expectUniqueIds(container);
  });
});

describe("/request-access", () => {
  it("renders the form with a hidden honeypot and a signed form time", async () => {
    const { container } = render(await RequestAccessPage());
    const trap = container.querySelector<HTMLInputElement>("input[name=oab_trap]");
    expect(trap).toHaveAttribute("tabindex", "-1");
    const autofillHints = /company|organi[sz]ation|website|url|address|phone|name|email|city|zip/i;
    expect(trap?.name).not.toMatch(autofillHints);
    expect(trap?.id).not.toMatch(autofillHints);
    expect(container.querySelector(`label[for="${trap?.id}"]`)?.textContent).not.toMatch(autofillHints);
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(trap?.closest("[aria-hidden=true]")).not.toBeNull();
    const ts = container.querySelector<HTMLInputElement>("input[name=form_ts]")?.value;
    expect(checkFormTs(ts, Date.now() + 5_000)).toBe(true);
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    expectUniqueIds(container);
  });
});

describe("/auth/confirm", () => {
  it("shows the account and asks for a click before using the token", async () => {
    const { container } = render(
      await ConfirmPage(params({ token_hash: "pkce_abcdef123456", type: "invite", email: "new person@example.test" })),
    );
    expect(screen.getByRole("button", { name: "Continue to Open Agent" })).toHaveAttribute("id", "auth-confirm-continue");
    expect(byIdIn(container, "auth-confirm-account")).toHaveTextContent("Accept the invite for new+person@example.test");
    expect(container.querySelector<HTMLInputElement>("input[name=token_hash]")?.value).toBe("pkce_abcdef123456");
    expect(container.querySelector<HTMLInputElement>("input[name=type]")?.value).toBe("invite");
    expect(container.querySelector<HTMLInputElement>("input[name=email]")?.value).toBe("new+person@example.test");
    expect(screen.queryByRole("note")).toBeNull();
    expectUniqueIds(container);
  });

  it("warns when an email link wasn't requested from this browser, and not when it was", async () => {
    const link = { token_hash: "abcdefghijk", type: "email", email: "me@example.test" };
    const { container, unmount } = render(await ConfirmPage(params(link)));
    expect(byIdIn(container, "auth-confirm-account")).toHaveTextContent("Sign in as me@example.test");
    expect(screen.getByRole("note")).toHaveTextContent("wasn't requested from this browser");
    expectUniqueIds(container);
    unmount();
    jar.set("oab_link", linkBinding("me@example.test"));
    render(await ConfirmPage(params(link)));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains an incomplete link instead of offering the button", async () => {
    const { container } = render(await ConfirmPage(params({ token_hash: "x", type: "recovery" })));
    expect(screen.getByRole("alert")).toHaveTextContent("This link is incomplete.");
    expect(screen.queryByRole("button")).toBeNull();
    expectUniqueIds(container);
  });
});
