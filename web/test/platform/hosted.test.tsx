import { Link, nativeHistory, useNavigate, usePathname, useSearchParams } from "@oab/ui/platform";
import { api, configureApi, createApiClient } from "@oab/ui/platform/api";
import { act, fireEvent, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedPlatform, nextRouter } from "@/lib/platform/hosted";
import { expectUniqueIds } from "../support/ids";
import { nav } from "../support/navigation";
import { renderWithPlatform } from "../support/platform";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const handles = {} as { navigate: ReturnType<typeof useNavigate> };

function Probe() {
  const navigate = useNavigate();
  const params = useSearchParams();
  useEffect(() => {
    handles.navigate = navigate;
  }, [navigate]);
  return (
    <div id="probe">
      <p id="probe-path">{usePathname()}</p>
      <p id="probe-q">{params.get("q") ?? ""}</p>
    </div>
  );
}

beforeEach(() => nav.reset("/"));

describe("hosted platform", () => {
  it("reads the path and query from Next", () => {
    nav.reset("/search?q=big");
    renderWithPlatform(<Probe />);
    expect(document.getElementById("probe-path")).toHaveTextContent("/search");
    expect(document.getElementById("probe-q")).toHaveTextContent("big");
    act(() => nav.go("/reports"));
    expect(document.getElementById("probe-path")).toHaveTextContent("/reports");
  });

  it("navigates with the Next router", () => {
    renderWithPlatform(<Probe />);
    act(() => handles.navigate.push("/chats?page=2"));
    expect(nav.push).toHaveBeenCalledWith("/chats?page=2");
    act(() => handles.navigate.replace("/search?q=sur"));
    expect(nav.replace).toHaveBeenCalledWith("/search?q=sur");
    expect(document.getElementById("probe-path")).toHaveTextContent("/search");
  });

  it("renders Link through next/link with every prop", () => {
    const onClick = vi.fn();
    const { container } = renderWithPlatform(
      <Link id="go" href="/reports/r1" className="pill" role="menuitem" aria-label="Open report" title="Open" onClick={onClick}>
        Open
      </Link>,
    );
    const a = screen.getByRole("menuitem", { name: "Open report" });
    expect(Object.fromEntries([...a.attributes].map((x) => [x.name, x.value]))).toEqual({
      id: "go",
      href: "/reports/r1",
      class: "pill",
      role: "menuitem",
      "aria-label": "Open report",
      title: "Open",
    });
    fireEvent.click(a);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith("/reports/r1");
    expectUniqueIds(container);
  });

  it("uses native history, the given user and no slots", () => {
    const platform = hostedPlatform({ email: "a@b.test", name: "A" });
    expect(platform.router).toBe(nextRouter);
    expect(platform.router.history).toBe(nativeHistory);
    expect(platform.user).toEqual({ email: "a@b.test", name: "A" });
    expect(platform.slots).toEqual({});
  });

  it("configures the API client for /api once", () => {
    expect(api().url("/chats")).toBe("/api/chats");
    expect(() => configureApi(createApiClient({ baseUrl: "/elsewhere" }))).toThrow();
    expect(api().url("/artifacts/r1?format=pdf")).toBe("/api/artifacts/r1?format=pdf");
  });
});
