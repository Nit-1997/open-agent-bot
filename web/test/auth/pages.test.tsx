import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmPage from "@/app/auth/confirm/page";
import LoginPage from "@/app/login/page";
import RequestAccessPage from "@/app/request-access/page";
import { getClaimsOrNull } from "@/lib/auth";
import { AUTH_ERROR_COPY } from "@/lib/authErrors";
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
    expect(container.querySelector<HTMLInputElement>("#login-google-next")?.value).toBe("/");
    expect(document.getElementById("login-email-input")).toHaveAttribute("type", "email");
    expect(document.getElementById("login-email-submit")).toHaveTextContent("Email me a sign-in link");
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
    vi.mocked(getClaimsOrNull).mockResolvedValueOnce({ id: "u", email: "a@b.test", isAdmin: false });
    await expect(LoginPage(params({}))).rejects.toThrow("/");
  });
});

describe("/request-access", () => {
  it("renders the form with a hidden honeypot and a signed form time", async () => {
    const { container } = render(await RequestAccessPage());
    const trap = container.querySelector<HTMLInputElement>("input[name=company_website]");
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(trap?.closest("[aria-hidden=true]")).not.toBeNull();
    const ts = container.querySelector<HTMLInputElement>("input[name=form_ts]")?.value;
    expect(checkFormTs(ts, Date.now() + 5_000)).toBe(true);
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    expectUniqueIds(container);
  });
});

describe("/auth/confirm", () => {
  it("asks for a click before using the token", async () => {
    const { container } = render(await ConfirmPage(params({ token_hash: "pkce_abcdef123456", type: "invite" })));
    expect(screen.getByRole("button", { name: "Continue to Open Agent" })).toHaveAttribute("id", "auth-confirm-continue");
    expect(container.querySelector<HTMLInputElement>("input[name=token_hash]")?.value).toBe("pkce_abcdef123456");
    expect(container.querySelector<HTMLInputElement>("input[name=type]")?.value).toBe("invite");
    expectUniqueIds(container);
  });

  it("explains an incomplete link instead of offering the button", async () => {
    const { container } = render(await ConfirmPage(params({ token_hash: "x", type: "recovery" })));
    expect(screen.getByRole("alert")).toHaveTextContent("This link is incomplete.");
    expect(screen.queryByRole("button")).toBeNull();
    expectUniqueIds(container);
  });
});
