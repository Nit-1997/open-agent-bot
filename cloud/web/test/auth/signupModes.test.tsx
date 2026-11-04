import type { SignupMode } from "@oab/shared/usage";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailLinkForm } from "@/app/login/EmailLinkForm";
import LoginPage from "@/app/login/page";
import RequestAccessPage from "@/app/request-access/page";
import { signupMode } from "@/lib/signupMode";
import { expectUniqueIds } from "../../../../packages/ui/test/support/ids.ts";
import { installFakeTurnstile, PASS_SITE_KEY, stubSiteKey } from "../humanCheck/fakeTurnstile";
import { stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/signupMode", () => ({ signupMode: vi.fn(async () => "waitlist") }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getClaimsOrNull: vi.fn(async () => null),
}));
vi.mock("@/app/login/actions", () => ({ signInWithGoogle: vi.fn(), requestEmailLink: vi.fn(async () => ({ status: "idle" })) }));
vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: vi.fn() }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const el = (id: string) => document.getElementById(id);
const asMode = (mode: SignupMode) => vi.mocked(signupMode).mockResolvedValue(mode);
const login = async () => render(await LoginPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  stubAgentEnv();
  stubSiteKey();
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe("/login by signup mode", () => {
  it("waitlist (also the unknown fallback) is today's page: invite-only, the request link, no Terms line, no widget", async () => {
    asMode("waitlist");
    const { container } = await login();
    expect(container.textContent).toContain("Open Agent is invite-only.");
    expect(el("login-request-link")).toHaveAttribute("href", "/request-access");
    expect(el("login-legal")).toBeNull();
    fireEvent.click(el("login-email-toggle")!);
    expect(el("login-email-label")).toHaveTextContent("Already invited? Get a sign-in link by email. This doesn't request access.");
    expect(el("login-email-turnstile")).toBeNull();
    expect(el("login-email-submit")).not.toBeDisabled();
  });

  it("invite drops the request link", async () => {
    asMode("invite");
    const { container } = await login();
    expect(container.textContent).toContain("Open Agent is invite-only.");
    expect(el("login-request")).toBeNull();
  });

  it("open says Google creates accounts, shows the Terms/Privacy line and puts Turnstile (email_link) on the email form", async () => {
    asMode("open");
    const t = installFakeTurnstile();
    const { container } = await login();
    expect(container.textContent).toContain("Continue with Google to sign in or create an account.");
    expect(el("login-request")).toBeNull();
    expect(el("login-legal")).toHaveTextContent("By continuing you agree to the Terms and the Privacy Policy.");
    expect(el("login-legal-terms")).toHaveAttribute("href", "/terms");
    expect(el("login-legal-privacy")).toHaveAttribute("href", "/privacy");
    fireEvent.click(el("login-email-toggle")!);
    await waitFor(() => expect(t.rendered).toHaveLength(1));
    expect([t.last().action, t.last().sitekey]).toEqual(["email_link", PASS_SITE_KEY]);
    expect(t.last().el).toBe(el("login-email-turnstile"));
    expect(el("login-email-submit")).toBeDisabled();
    act(() => t.last().callback("tok-email"));
    expect(el("login-email-captcha")).toHaveValue("tok-email");
    expect(el("login-email-submit")).not.toBeDisabled();
    act(() => t.last().expired());
    expect(el("login-email-submit")).toBeDisabled();
    expectUniqueIds(container);
  });
});

describe("/request-access by signup mode", () => {
  it("waitlist shows the form", async () => {
    asMode("waitlist");
    render(await RequestAccessPage());
    expect(el("request-access-closed")).toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("invite says requests are closed and links to sign in", async () => {
    asMode("invite");
    const { container } = render(await RequestAccessPage());
    expect(el("request-access-closed")).toHaveTextContent("We're not taking requests right now.");
    expect(container.querySelector("form")).toBeNull();
    expect(el("request-access-login-link")).toHaveAttribute("href", "/login");
    expectUniqueIds(container);
  });

  it("open redirects to /login", async () => {
    asMode("open");
    await expect(RequestAccessPage()).rejects.toThrow("/login");
  });
});

describe("EmailLinkForm without a site key in open mode", () => {
  it("renders no widget and lets the agent answer (503 → can't send links)", () => {
    render(<EmailLinkForm startOpen open siteKey={undefined} />);
    expect(el("login-email-turnstile")).toBeNull();
    expect(el("login-email-submit")).not.toBeDisabled();
  });
});
