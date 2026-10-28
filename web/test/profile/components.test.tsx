import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { Onboarding } from "@/components/profile/Onboarding";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { EMPTY_PROFILE } from "@/lib/profile";

const models = {
  default: "litellm/chat-default",
  models: [
    { id: "litellm/chat-default", label: "Qwen 3.5 (local)", provider: "LiteLLM gateway", note: "Free and private" },
    { id: "litellm/chat-sonnet-5.5", label: "Sonnet 5.5", provider: "LiteLLM gateway", note: "Best quality" },
    { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq" },
  ],
};

const next = () => fireEvent.click(screen.getByRole("button", { name: /continue/i }));

describe("Onboarding", () => {
  it("walks through name, home, interests and model, then saves", () => {
    const onDone = vi.fn();
    render(<Onboarding models={models} onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/what should i call you/i), { target: { value: "Nitin" } });
    next();
    fireEvent.change(screen.getByLabelText(/where's home/i), { target: { value: "Sunnyvale, CA 94087" } });
    next();
    fireEvent.click(screen.getByRole("button", { name: "Has pets" }));
    fireEvent.change(screen.getByLabelText(/anything else/i), { target: { value: "Two cats" } });
    next();
    expect(screen.getByRole("radio", { name: /Qwen 3.5/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Sonnet 5.5/ }));
    fireEvent.click(screen.getByRole("button", { name: /start chatting/i }));
    expect(onDone).toHaveBeenCalledWith({
      name: "Nitin",
      home: "Sunnyvale, CA 94087",
      interests: ["Has pets"],
      notes: "Two cats",
      defaultModel: "litellm/chat-sonnet-5.5",
      onboarded: true,
    });
  });

  it("can be skipped, which still counts as onboarded", () => {
    const onDone = vi.fn();
    render(<Onboarding models={models} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    expect(onDone).toHaveBeenCalledWith({ ...EMPTY_PROFILE, onboarded: true });
  });

  it("has unique ids on every element", () => {
    const { container } = render(<Onboarding models={models} onDone={() => {}} />);
    const ids = [...container.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ProfileDrawer", () => {
  const profile = { ...EMPTY_PROFILE, name: "Nitin", home: "94087", onboarded: true, defaultModel: "litellm/chat-default" };

  it("saves edits", () => {
    const onSave = vi.fn();
    render(<ProfileDrawer profile={profile} models={models} onSave={onSave} onClose={() => {}} onRestart={() => {}} onClear={() => {}} />);
    fireEvent.change(screen.getByLabelText(/what should i call you/i), { target: { value: "Nitin B" } });
    fireEvent.click(screen.getByRole("button", { name: "Vegetarian" }));
    fireEvent.click(screen.getByRole("radio", { name: /Sonnet 5.5/ }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith({ ...profile, name: "Nitin B", interests: ["Vegetarian"], defaultModel: "litellm/chat-sonnet-5.5" });
  });

  it("asks before clearing the profile", () => {
    const onClear = vi.fn();
    render(<ProfileDrawer profile={profile} models={models} onSave={() => {}} onClose={() => {}} onRestart={() => {}} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /clear profile/i }));
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /yes, clear/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ProfileDrawer profile={profile} models={models} onSave={() => {}} onClose={onClose} onRestart={() => {}} onClear={() => {}} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ModelMenu", () => {
  it("shows the chat's model, grouped by provider, and switches it", () => {
    const onChange = vi.fn();
    render(<ModelMenu models={models} value="litellm/chat-default" onChange={onChange} onManage={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Qwen 3.5/ }));
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["LiteLLM gateway", "Groq"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Llama 3.3 70B/ }));
    expect(onChange).toHaveBeenCalledWith("groq/llama-3.3-70b-versatile");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("understands old saved model names without a provider", () => {
    render(<ModelMenu models={models} value="chat-sonnet-5.5" onChange={() => {}} onManage={() => {}} />);
    expect(screen.getByRole("button", { name: /Sonnet 5.5/ })).toBeInTheDocument();
  });

  it("opens model management from the menu", () => {
    const onManage = vi.fn();
    render(<ModelMenu models={models} value={undefined} onChange={() => {}} onManage={onManage} />);
    fireEvent.click(screen.getByRole("button", { name: /Qwen 3.5/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Manage models/ }));
    expect(onManage).toHaveBeenCalled();
  });

  it("renders nothing until models load", () => {
    const { container } = render(<ModelMenu models={null} value={undefined} onChange={() => {}} onManage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
