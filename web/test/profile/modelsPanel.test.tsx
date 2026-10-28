import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsPanel } from "@/components/profile/ModelsPanel";
import type { ProviderView } from "@/lib/providers";

const base = (over: Partial<ProviderView>): ProviderView => ({
  id: "x",
  label: "X",
  kind: "cloud",
  site: "x.com",
  methods: ["api_key"],
  configured: false,
  enabled: [],
  modelCount: 3,
  ...over,
});

let providers: ProviderView[];
let calls: Array<{ url: string; method: string; body?: unknown }>;
let loginState: Record<string, unknown>;

beforeEach(() => {
  providers = [
    base({ id: "openai", label: "OpenAI", site: "openai.com", keyUrl: "https://platform.openai.com/api-keys", methods: ["api_key", "oauth"], oauthLabel: "Sign in with ChatGPT" }),
    base({ id: "groq", label: "Groq", site: "groq.com", configured: true, source: "key", enabled: ["llama-3.3-70b-versatile"] }),
    base({ id: "ollama", label: "Ollama", kind: "local", site: "ollama.com", methods: [], defaultBaseUrl: "http://host.docker.internal:11434/v1", modelCount: 0 }),
  ];
  calls = [];
  loginState = {
    status: "running",
    providerId: "openai",
    authUrl: "https://auth.openai.com/authorize?x=1",
    prompt: { type: "manual_code", message: "Paste the final redirect URL", placeholder: "http://127.0.0.1:1455/auth/callback" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url === "/api/providers" && method === "GET") return ok({ providers });
      if (url === "/api/providers/openai/key") {
        if (!body.apiKey.trim()) return new Response(JSON.stringify({ error: "the key is empty" }), { status: 400 });
        providers[0] = { ...providers[0], configured: true, source: "key", enabled: ["gpt-5.5"] };
        return ok({ ok: true });
      }
      if (url === "/api/providers/groq/models" && method === "GET")
        return ok({
          models: [
            { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", contextWindow: 131072, note: "$0.59 in · $0.79 out per 1M tokens", enabled: true },
            { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", contextWindow: 131072, enabled: false },
          ],
        });
      if (url === "/api/providers/groq/models" && method === "PUT") return ok({ ok: true });
      if (url === "/api/providers/test") return ok({ ok: true, toolCall: true, latencyMs: 1234, cost: 0.0001 });
      if (url === "/api/providers/groq" && method === "DELETE") {
        providers[1] = { ...providers[1], configured: false, source: undefined, enabled: [] };
        return ok({ ok: true });
      }
      if (url === "/api/providers/openai/login") return ok({ flow: "11111111-2222-3333-4444-555555555555" });
      if (url === "/api/providers/logins/11111111-2222-3333-4444-555555555555/answer") {
        loginState = { status: "done", providerId: "openai" };
        providers[0] = { ...providers[0], configured: true, source: "signin", enabled: ["gpt-5.5"] };
        return ok({ ok: true });
      }
      if (url === "/api/providers/logins/11111111-2222-3333-4444-555555555555") return ok(loginState);
      if (url === "/api/providers/local") {
        providers[2] = { ...providers[2], configured: true, source: "server", baseUrl: body.baseUrl, enabled: ["qwen3.5:35b"], modelCount: 1 };
        return ok({ provider: providers[2] });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const row = (name: string) => screen.getByRole("listitem", { name });

describe("ModelsPanel", () => {
  it("shows cloud providers and local servers with their status", async () => {
    render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByRole("listitem", { name: "OpenAI" })).toHaveTextContent("Not connected");
    expect(row("Groq")).toHaveTextContent("Connected");
    expect(within(row("OpenAI")).getByRole("link", { name: /get a key/i })).toHaveAttribute("href", "https://platform.openai.com/api-keys");
    expect(within(row("Ollama")).getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("saves a key from a password field and refreshes", async () => {
    const onChanged = vi.fn();
    render(<ModelsPanel onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "OpenAI" })).getByRole("button", { name: "Add key" }));
    const input = screen.getByLabelText("OpenAI API key");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "sk-abc" } });
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(row("OpenAI")).toHaveTextContent("Connected"));
    expect(calls.find((c) => c.url === "/api/providers/openai/key")?.body).toEqual({ apiKey: "sk-abc" });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByDisplayValue("sk-abc")).toBeNull();
  });

  it("shows the agent's error when a key is rejected", async () => {
    render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "OpenAI" })).getByRole("button", { name: "Add key" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), { target: { value: " " } });
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Save key" }));
    expect(await within(row("OpenAI")).findByRole("alert")).toHaveTextContent("the key is empty");
  });

  it("chooses which of a provider's models appear in the menu", async () => {
    const onChanged = vi.fn();
    render(<ModelsPanel onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Groq" })).getByRole("button", { name: /Models/ }));
    const gptOss = await screen.findByRole("checkbox", { name: /GPT OSS 120B/ });
    expect(screen.getByRole("checkbox", { name: /Llama 3.3 70B/ })).toBeChecked();
    expect(screen.getByText("$0.59 in · $0.79 out per 1M tokens")).toBeInTheDocument();
    fireEvent.click(gptOss);
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ enabled: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("tests a provider's first model and shows the result", async () => {
    render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Groq" })).getByRole("button", { name: "Test" }));
    expect(await within(row("Groq")).findByText(/Tool calls work · 1.2s/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/providers/test")?.body).toEqual({ model: "groq/llama-3.3-70b-versatile" });
  });

  it("asks before removing a provider's key", async () => {
    render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Groq" })).getByRole("button", { name: "Remove" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(row("Groq")).getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(row("Groq")).toHaveTextContent("Not connected"));
  });

  it("connects a local server at its usual address", async () => {
    render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Ollama" })).getByRole("button", { name: "Connect" }));
    expect(screen.getByLabelText("Ollama server URL")).toHaveValue("http://host.docker.internal:11434/v1");
    fireEvent.click(within(row("Ollama")).getByRole("button", { name: "Connect server" }));
    await waitFor(() => expect(row("Ollama")).toHaveTextContent("http://host.docker.internal:11434/v1"));
    expect(calls.find((c) => c.url === "/api/providers/local")?.body).toEqual({ kind: "ollama", baseUrl: "http://host.docker.internal:11434/v1" });
  });

  it("signs in with ChatGPT: opens OpenAI's page, accepts a pasted redirect, then shows signed in", async () => {
    const onChanged = vi.fn();
    render(<ModelsPanel onClose={() => {}} onChanged={onChanged} pollMs={5} />);
    fireEvent.click(within(await screen.findByRole("listitem", { name: "OpenAI" })).getByRole("button", { name: "Sign in with ChatGPT" }));
    const open = await within(row("OpenAI")).findByRole("link", { name: /Open ChatGPT sign-in/ });
    expect(open).toHaveAttribute("href", "https://auth.openai.com/authorize?x=1");
    expect(open).toHaveAttribute("target", "_blank");
    const paste = within(row("OpenAI")).getByLabelText("Paste the final redirect URL");
    fireEvent.change(paste, { target: { value: "http://127.0.0.1:1455/auth/callback?code=c" } });
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Finish sign-in" }));
    await waitFor(() => expect(row("OpenAI")).toHaveTextContent("Connected · signed in"));
    expect(calls.find((c) => c.url.endsWith("/answer"))?.body).toEqual({ value: "http://127.0.0.1:1455/auth/callback?code=c" });
    expect(onChanged).toHaveBeenCalled();
  });

  it("gives every element a unique id", async () => {
    const { container } = render(<ModelsPanel onClose={() => {}} onChanged={() => {}} />);
    await screen.findByRole("listitem", { name: "OpenAI" });
    const ids = [...container.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
