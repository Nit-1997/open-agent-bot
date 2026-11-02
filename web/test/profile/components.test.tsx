import { emptyProfile, type Profile } from "@shared/profile";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { Onboarding } from "@/components/profile/onboarding/Onboarding";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import type { ModelList } from "@/lib/models";
import type { ProviderView } from "@/lib/providers";

const models: ModelList = {
  default: null,
  models: [
    { id: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "OpenRouter", note: "$0.09 in" },
    { id: "openrouter/anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "OpenRouter" },
    { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq" },
  ],
};

const options = {
  country: "US",
  currency: "USD",
  units: "imperial",
  airports: ["OAK", "SFO", "SJC"],
  groceriesNearby: true,
  rows: {
    airlines: ["Southwest", "United"],
    hotelChains: ["Marriott", "Independent"],
    sites: [
      { label: "Google Flights", access: "searched" },
      { label: "Airbnb", access: "searched" },
      { label: "Expedia", access: "linked" },
    ],
    groceries: ["Trader Joe's", "Safeway"],
    retail: ["Amazon", "Target"],
    delivery: ["Instacart", "DoorDash"],
  },
};

const place = {
  label: "555 California Street, San Francisco, California, United States",
  city: "San Francisco",
  region: "California",
  country: "US",
  lat: 37.79,
  lon: -122.4,
};

let providers: Array<Partial<ProviderView>>;
let calls: Array<{ url: string; method: string; body?: unknown }>;

beforeEach(() => {
  providers = [
    {
      id: "openrouter",
      label: "OpenRouter",
      kind: "cloud",
      configured: false,
      methods: ["api_key"],
      enabled: [],
      modelCount: 300,
      site: "openrouter.ai",
    },
    {
      id: "typesafe",
      label: "TypeSafe",
      kind: "cloud",
      configured: false,
      methods: ["api_key"],
      enabled: [],
      modelCount: 0,
      site: "typesafe.ai",
    },
  ];
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url === "/api/providers") return ok({ providers });
      if (url.startsWith("/api/onboarding/options")) return ok(options);
      if (url.startsWith("/api/places")) return ok({ places: url.includes("555") ? [place] : [] });
      if (url.endsWith("/key")) {
        const id = url.split("/")[3];
        providers = providers.map((p) => (p.id === id ? { ...p, configured: true } : p));
        return ok({ ok: true });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const chip = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

async function pastAgent() {
  fireEvent.click(await screen.findByRole("button", { name: "Next: about you" }));
  return screen.findByRole("heading", { name: "Let's start with you" });
}

function setup(over: { models?: ModelList; profile?: Profile } = {}) {
  const onDone = vi.fn(async () => {});
  const utils = render(
    <Onboarding profile={over.profile ?? emptyProfile()} models={over.models ?? models} onModelsChanged={() => {}} onDone={onDone} />,
  );
  return { onDone, ...utils };
}

describe("Onboarding", () => {
  it("walks You → Travel → Shopping → Jev → Model → summary with taps, then saves the profile and the starter", async () => {
    const { onDone } = setup();
    expect(await screen.findByText(/01 \/ 07 · Your agent/)).toBeInTheDocument();
    expect(await pastAgent()).toBeInTheDocument();
    expect(screen.getByText(/02 \/ 07 · You/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Nitin" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "555 Cali" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /555 California Street/ }));
    expect(await screen.findByText("✓ San Francisco · USD · °F · airports OAK, SFO, SJC")).toBeInTheDocument();
    chip("Married / partner");
    chip("Kids");
    chip("4–8");
    chip("Vegetarian");
    chip("Nut allergy");
    next();
    expect(title()).toBe("How do you like to travel?");
    expect(screen.getByText("flying from OAK / SFO / SJC")).toBeInTheDocument();
    chip("Comfort");
    chip("Southwest");
    chip("Hotels");
    chip(/^Airbnb/);
    expect(screen.getByRole("button", { name: /Expedia/ })).toHaveTextContent("linked");
    next();
    expect(title()).toBe("Where do you shop?");
    expect(screen.getByText("popular near you")).toBeInTheDocument();
    chip("Balanced");
    chip("Trader Joe's");
    chip("Instacart");
    next();
    expect(title()).toBe("Turn on Jev for better picks");
    next();
    expect(title()).toBe("Choose your model");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /DeepSeek V4 Flash/ }));
    next();
    expect(title()).toBe("Here's what I know about you");
    const summary = screen.getByRole("list");
    expect(summary).toHaveTextContent("Juno · warm · mist look");
    expect(summary).toHaveTextContent("Nitin · San Francisco, California");
    expect(summary).toHaveTextContent("partner, kids 4–8 · vegetarian · nut allergy");
    expect(summary).toHaveTextContent("comfort · Southwest · hotels · books on Airbnb");
    expect(summary).toHaveTextContent("balanced · Trader Joe's · delivers with Instacart");
    chip("Veggie taco night at Trader Joe's");
    expect(screen.getByRole("button", { name: "Weekend trip from OAK for the 3 of us" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start chatting" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved, starter] = onDone.mock.calls[0] as unknown as [Profile, string];
    expect(starter).toBe("Veggie taco night at Trader Joe's");
    expect(saved).toMatchObject({
      name: "Nitin",
      home: { city: "San Francisco", country: "US", lat: 37.79, lon: -122.4 },
      household: { partner: true, kids: ["4–8"], pets: [], other: [] },
      food: ["Vegetarian", "Nut allergy"],
      travel: { style: "comfort", airlines: ["Southwest"], stays: ["hotel"], sites: ["Airbnb"] },
      shopping: { style: "balanced", groceries: ["Trader Joe's"], delivery: ["Instacart"] },
      defaultModel: "openrouter/deepseek/deepseek-v4-flash",
      skipped: [],
    });
    expect(saved.onboardedAt).toBeTruthy();
  });

  it("stores the agent on Next and keeps the defaults on Skip for now", async () => {
    const { onDone, unmount } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Milo" }));
    fireEvent.click(screen.getByRole("button", { name: "Moss" }));
    await pastAgent();
    fireEvent.click(screen.getByRole("button", { name: "Skip this section" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip travel" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip shopping" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip, use without Jev" }));
    fireEvent.click(screen.getByRole("radio", { name: /Llama/ }));
    next();
    expect(screen.getByRole("list")).toHaveTextContent("Milo · warm · moss look");
    fireEvent.click(screen.getByRole("button", { name: /Your agent/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, I'm Milo.");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(title()).toBe("Let's start with you");
    unmount();
    const second = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Sage" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    for (const skip of ["Skip this section", "Skip travel", "Skip shopping", "Skip, use without Jev"])
      fireEvent.click(screen.getByRole("button", { name: skip }));
    fireEvent.click(screen.getByRole("radio", { name: /Llama/ }));
    next();
    expect(screen.getByRole("list")).toHaveTextContent("Juno · warm · mist look");
    fireEvent.click(screen.getByRole("button", { name: "Start chatting" }));
    await waitFor(() => expect(second.onDone).toHaveBeenCalled());
    const [saved] = second.onDone.mock.calls[0] as unknown as [Profile];
    expect(saved.agent).toBeUndefined();
    expect(saved.skipped).toContain("agent");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("enables Next again after a bad agent name is skipped and the step is revisited", async () => {
    setup();
    fireEvent.change(await screen.findByLabelText("Agent Name"), { target: { value: "!!" } });
    expect(screen.getByRole("button", { name: "Next: about you" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(title()).toBe("Let's start with you");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, I'm Juno.");
    expect(screen.getByRole("button", { name: "Next: about you" })).toBeEnabled();
  });

  it("puts the model step first when no provider is set up, and it can't be skipped", async () => {
    setup({ models: { default: null, models: [] } });
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Add a model to start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(await screen.findByRole("listitem", { name: "OpenRouter" })).toBeInTheDocument();
  });

  it("skips a section, clearing it and remembering it was skipped", async () => {
    const { onDone } = setup();
    await pastAgent();
    chip("Vegan");
    fireEvent.click(screen.getByRole("button", { name: "Skip this section" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip travel" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip shopping" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip, use without Jev" }));
    fireEvent.click(screen.getByRole("radio", { name: /Llama/ }));
    next();
    expect(screen.getByRole("list")).toHaveTextContent("skipped");
    fireEvent.click(screen.getByRole("button", { name: "Start chatting" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = onDone.mock.calls[0] as unknown as [Profile];
    expect(saved.food).toEqual([]);
    expect(saved.skipped).toEqual(["you", "travel", "shopping", "jev"]);
  });

  it("adds the user's own tag with + add, and exclusive chips clear the others", async () => {
    setup();
    await pastAgent();
    const food = screen.getByRole("group", { name: "Food" });
    chip("Vegan");
    fireEvent.click(within(food).getByRole("button", { name: "add" }));
    const field = within(food).getByRole("textbox", { name: "Add your own" });
    fireEvent.change(field, { target: { value: "  low   sodium " } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(within(food).getByRole("button", { name: "low sodium" })).toHaveAttribute("aria-pressed", "true");
    chip("No restrictions");
    expect(within(food).getByRole("button", { name: "Vegan" })).toHaveAttribute("aria-pressed", "false");
    expect(within(food).queryByRole("button", { name: "low sodium" })).toBeNull();
  });

  it("hides the Jev slide when a Jev provider is already configured", async () => {
    providers[0].configured = true;
    setup();
    await pastAgent();
    await waitFor(() => expect(screen.getByText(/02 \/ 06 · You/)).toBeInTheDocument());
  });

  it("saves a Jev key through the provider endpoint", async () => {
    setup();
    await pastAgent();
    next();
    next();
    next();
    fireEvent.change(screen.getByLabelText("Or a TypeSafe key key"), { target: { value: "ts-1" } });
    fireEvent.click(within(document.getElementById("onboarding-jev-typesafe") as HTMLElement).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Key saved/)).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/providers/typesafe/key")?.body).toEqual({ apiKey: "ts-1" });
    expect(title()).toBe("Turn on Jev for better picks");
  });

  it("debounces the address typeahead and keeps free text that matches nothing", async () => {
    vi.useFakeTimers();
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: about you" }));
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "Zz" } });
    fireEvent.change(box, { target: { value: "Zzq Lane" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(calls.filter((c) => c.url.startsWith("/api/places"))).toHaveLength(1);
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText(/keep what you typed/)).toBeInTheDocument();
  });

  it("has unique ids on every element of every slide", async () => {
    const { container } = setup();
    await pastAgent();
    const check = () => {
      const ids = [...container.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
      expect(ids.filter((id) => !id)).toEqual([]);
      expect(new Set(ids).size).toBe(ids.length);
    };
    chip("Kids");
    chip("Pets");
    for (let i = 0; i < 5; i++) {
      check();
      if (i === 4) fireEvent.click(screen.getByRole("radio", { name: /Llama/ }));
      next();
    }
    check();
  });
});

describe("ProfileDrawer", () => {
  const profile: Profile = { ...emptyProfile(), name: "Nitin", defaultModel: "groq/llama-3.3-70b-versatile", onboardedAt: "2026-10-30" };

  it("edits the same data as the slides and saves it", async () => {
    const onSave = vi.fn(async () => {});
    render(<ProfileDrawer profile={profile} models={models} onSave={onSave} onClose={() => {}} onRestart={() => {}} onClear={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Nitin B" } });
    chip("Vegetarian");
    fireEvent.click(await screen.findByRole("button", { name: "Southwest" }));
    fireEvent.click(screen.getByRole("radio", { name: /Claude Sonnet 5.5/ }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]).toEqual([
      expect.objectContaining({
        name: "Nitin B",
        food: ["Vegetarian"],
        travel: expect.objectContaining({ airlines: ["Southwest"] }),
        defaultModel: "openrouter/anthropic/claude-sonnet-5.5",
      }),
    ]);
  });

  it("edits the agent in the drawer, focuses its name when asked, and blocks Save on a bad name", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <ProfileDrawer
        profile={profile}
        models={models}
        focus="agent"
        onSave={onSave}
        onClose={() => {}}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText("Agent Name")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "{x}" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Agent Name"), { target: { value: "Ivy" } });
    fireEvent.click(screen.getByRole("button", { name: "Brief" }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]).toEqual([expect.objectContaining({ agent: { name: "Ivy", look: "mist", tone: "brief" } })]);
  });

  it("shows a save error instead of closing", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("that profile isn't valid");
    });
    render(<ProfileDrawer profile={profile} models={models} onSave={onSave} onClose={() => {}} onRestart={() => {}} onClear={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("that profile isn't valid");
  });

  it("asks before clearing the profile", () => {
    const onClear = vi.fn();
    render(
      <ProfileDrawer profile={profile} models={models} onSave={async () => {}} onClose={() => {}} onRestart={() => {}} onClear={onClear} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear profile/i }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /yes, clear/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows the agent group and a sign-out-on-all-devices form, with unique ids, and no recent chats", () => {
    const { container } = render(
      <ProfileDrawer
        profile={profile}
        models={models}
        onSave={async () => {}}
        onClose={() => {}}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent chats" })).toBeNull();
    const signOut = screen.getByRole("button", { name: "Sign out on all devices" });
    expect(signOut).toHaveAttribute("id", "profile-signout-all");
    const form = signOut.closest("form") as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(form).toHaveAttribute("method", "post");
    expect(new FormData(form).get("scope")).toBe("global");
    const ids = [...container.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <ProfileDrawer profile={profile} models={models} onSave={async () => {}} onClose={onClose} onRestart={() => {}} onClear={() => {}} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

const menuModels: ModelList = {
  default: "litellm/chat-default",
  models: [
    { id: "litellm/chat-default", label: "Qwen 3.5 (local)", provider: "LiteLLM gateway", note: "Free and private" },
    { id: "litellm/chat-sonnet-5.5", label: "Sonnet 5.5", provider: "LiteLLM gateway", note: "Best quality" },
    { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq" },
  ],
};

describe("ModelMenu", () => {
  it("shows the chat's model, grouped by provider, and switches it", () => {
    const onChange = vi.fn();
    render(<ModelMenu id="mm" models={menuModels} value="litellm/chat-default" onChange={onChange} onManage={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Qwen 3.5/ }));
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["LiteLLM gateway", "Groq"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Llama 3.3 70B/ }));
    expect(onChange).toHaveBeenCalledWith("groq/llama-3.3-70b-versatile");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the profile's default when the chat has no model of its own", () => {
    render(<ModelMenu id="mm" models={menuModels} value={undefined} onChange={() => {}} onManage={() => {}} />);
    expect(screen.getByRole("button", { name: /Qwen 3.5/ })).toBeInTheDocument();
  });

  it("opens model management from the menu", () => {
    const onManage = vi.fn();
    render(<ModelMenu id="mm" models={menuModels} value={undefined} onChange={() => {}} onManage={onManage} />);
    fireEvent.click(screen.getByRole("button", { name: /Qwen 3.5/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Manage models/ }));
    expect(onManage).toHaveBeenCalled();
  });

  it("renders nothing until models load", () => {
    const { container } = render(<ModelMenu id="mm" models={null} value={undefined} onChange={() => {}} onManage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
