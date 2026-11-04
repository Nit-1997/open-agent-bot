import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureApi, createApiClient } from "../../src/platform/api.ts";
import { ChatRuntime } from "../../src/platform/ChatRuntime.tsx";

const provider = vi.fn();

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: (props: { children: React.ReactNode } & Record<string, unknown>) => {
    provider(props);
    return props.children;
  },
}));

afterEach(() => provider.mockClear());

describe("ChatRuntime", () => {
  it("never shows CopilotKit's developer console, even on localhost", () => {
    expect(window.location.hostname).toBe("localhost");
    configureApi(createApiClient({ baseUrl: "/api" }));
    render(
      <ChatRuntime>
        <p id="chat-runtime-child">child</p>
      </ChatRuntime>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(provider).toHaveBeenCalled();
    expect(provider.mock.calls.at(-1)?.[0]).toMatchObject({
      runtimeUrl: "/api/copilotkit",
      useSingleEndpoint: false,
      showDevConsole: false,
    });
  });
});
