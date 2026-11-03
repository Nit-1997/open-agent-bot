import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  historyRouter,
  Link,
  memoryRouter,
  nativeHistory,
  type PlatformRouter,
  useNavigate,
  usePathname,
  usePlatform,
  usePlatformHistory,
  useSearchParams,
} from "../../src/platform/index.ts";
import { expectUniqueIds } from "../support/ids.ts";
import { renderWithPlatform } from "../support/renderWithPlatform.tsx";

let navigate: ReturnType<typeof useNavigate>;
let history: ReturnType<typeof usePlatformHistory>;

function Probe() {
  navigate = useNavigate();
  history = usePlatformHistory();
  const params = useSearchParams();
  return (
    <div id="probe">
      <p id="probe-path">{usePathname()}</p>
      <p id="probe-search">{params.toString()}</p>
      <p id="probe-q">{params.get("q") ?? ""}</p>
    </div>
  );
}

const shown = () => ({
  path: document.getElementById("probe-path")?.textContent,
  search: document.getElementById("probe-search")?.textContent,
  q: document.getElementById("probe-q")?.textContent,
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

type Factory = Readonly<{ name: string; make: (initial: string) => PlatformRouter }>;

const factories: Factory[] = [
  { name: "memoryRouter", make: (initial) => memoryRouter(initial) },
  {
    name: "historyRouter",
    make: (initial) => {
      window.history.replaceState(null, "", initial);
      return historyRouter();
    },
  },
];

describe.each(factories)("$name", ({ name, make }) => {
  it("starts at the initial URL", () => {
    renderWithPlatform(<Probe />, { router: make("/search?q=big&scope=all") });
    expect(shown()).toEqual({ path: "/search", search: "q=big&scope=all", q: "big" });
  });

  it("reflects push and replace from useNavigate", () => {
    renderWithPlatform(<Probe />, { router: make("/") });
    act(() => navigate.push("/chats?page=2"));
    expect(shown()).toEqual({ path: "/chats", search: "page=2", q: "" });
    act(() => navigate.replace("/search?q=sur"));
    expect(shown()).toEqual({ path: "/search", search: "q=sur", q: "sur" });
  });

  it("reflects history.push, history.replace and history.back, and keeps the state", async () => {
    renderWithPlatform(<Probe />, { router: make("/chats/a") });
    act(() => history.push({ oaReport: "r1" }, "/chats/a?report=r1"));
    expect(shown()).toEqual({ path: "/chats/a", search: "report=r1", q: "" });
    expect(history.state()).toEqual({ oaReport: "r1" });
    act(() => history.replace(null, "/chats/a?report=r2"));
    expect(shown().search).toBe("report=r2");
    expect(history.state()).toBeNull();
    act(() => history.back());
    await waitFor(() => expect(shown()).toEqual({ path: "/chats/a", search: "", q: "" }));
  });

  it("reflects a back navigation as popstate", async () => {
    const router = make("/");
    renderWithPlatform(<Probe />, { router });
    act(() => navigate.push("/reports"));
    act(() => navigate.push("/search?q=abc"));
    if (name === "historyRouter") {
      act(() => {
        window.history.pushState(null, "", "/chats?page=3");
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
      });
      expect(shown()).toEqual({ path: "/chats", search: "page=3", q: "" });
    }
    act(() => history.back());
    await waitFor(() => expect(shown().path).toBe(name === "historyRouter" ? "/search" : "/reports"));
  });

  it("navigates on a plain left click of Link and leaves other clicks to the browser", () => {
    renderWithPlatform(
      <>
        <Link id="go" href="/reports?page=2" className="x">
          Reports
        </Link>
        <Link id="tab" href="/chats" target="_blank">
          New tab
        </Link>
        <Probe />
      </>,
      { router: make("/") },
    );
    const go = document.getElementById("go")!;
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      expect(fireEvent.click(go, init)).toBe(true);
      expect(shown().path).toBe("/");
    }
    expect(fireEvent.click(document.getElementById("tab")!)).toBe(true);
    expect(shown().path).toBe("/");
    expect(fireEvent.click(go)).toBe(false);
    expect(shown()).toEqual({ path: "/reports", search: "page=2", q: "" });
  });
});

describe("memoryRouter entries", () => {
  it("push appends, replace overwrites, back steps and a push after back drops the forward entries", () => {
    const router = memoryRouter("/");
    renderWithPlatform(<Probe />, { router });
    act(() => navigate.push("/a"));
    act(() => navigate.push("/b"));
    act(() => navigate.replace("/c"));
    expect(router.entries).toEqual(["/", "/a", "/c"]);
    act(() => history.back());
    act(() => navigate.push("/d"));
    expect(router.entries).toEqual(["/", "/a", "/d"]);
    expect(shown().path).toBe("/d");
  });
});

describe("historyRouter", () => {
  it("writes the browser history and patches nothing global", () => {
    const pushState = window.history.pushState;
    const replaceState = window.history.replaceState;
    const router = historyRouter();
    renderWithPlatform(<Probe />, { router });
    act(() => navigate.push("/reports"));
    expect(window.location.pathname).toBe("/reports");
    act(() => history.replace({ k: 1 }, "/reports?page=2"));
    expect(window.location.search).toBe("?page=2");
    expect(window.history.state).toEqual({ k: 1 });
    expect(window.history.pushState).toBe(pushState);
    expect(window.history.replaceState).toBe(replaceState);
  });
});

describe("nativeHistory", () => {
  it("calls window.history with exactly the arguments it is given", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    nativeHistory.push({ oaReport: "r1" }, "/chats/a?report=r1");
    expect(push).toHaveBeenCalledWith({ oaReport: "r1" }, "", "/chats/a?report=r1");
    nativeHistory.replace(null, "/chats/a");
    expect(replace).toHaveBeenCalledWith(null, "", "/chats/a");
    nativeHistory.back();
    expect(back).toHaveBeenCalledWith();
    window.history.replaceState({ s: 2 }, "", "/x");
    expect(nativeHistory.state()).toEqual({ s: 2 });
  });
});

describe("Link", () => {
  it("renders an anchor with its id, href and every other prop", () => {
    const onClick = vi.fn();
    const { container } = renderWithPlatform(
      <Link
        id="report-link"
        href="/reports/r1"
        className="rounded"
        title="Open"
        role="menuitem"
        aria-label="Open report"
        data-kind="report"
        target="_self"
        rel="noopener"
        onClick={onClick}
      >
        Open
      </Link>,
    );
    const a = screen.getByRole("menuitem", { name: "Open report" });
    expect(a.tagName).toBe("A");
    expect(Object.fromEntries([...a.attributes].map((x) => [x.name, x.value]))).toEqual({
      id: "report-link",
      href: "/reports/r1",
      class: "rounded",
      title: "Open",
      role: "menuitem",
      "aria-label": "Open report",
      "data-kind": "report",
      target: "_self",
      rel: "noopener",
    });
    fireEvent.click(a);
    expect(onClick).toHaveBeenCalledTimes(1);
    expectUniqueIds(container);
  });

  it("does not navigate when onClick prevents the default", () => {
    const router = memoryRouter("/");
    renderWithPlatform(
      <Link id="stay" href="/reports" onClick={(e) => e.preventDefault()}>
        Stay
      </Link>,
      { router },
    );
    fireEvent.click(document.getElementById("stay")!);
    expect(router.entries).toEqual(["/"]);
  });

  it("uses the platform's Link component", () => {
    const router = memoryRouter("/");
    const custom: PlatformRouter = { ...router, Link: (p) => <a {...p} data-custom="yes" /> };
    renderWithPlatform(
      <Link id="c" href="/x">
        X
      </Link>,
      { router: custom },
    );
    expect(document.getElementById("c")).toHaveAttribute("data-custom", "yes");
  });
});

describe("usePlatform", () => {
  it("fails without a PlatformProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      usePlatform();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("PlatformProvider");
  });
});
