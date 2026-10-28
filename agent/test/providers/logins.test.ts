import { describe, expect, it } from "vitest";
import { LoginFlows } from "../../src/providers/logins.js";

type Interaction = Parameters<ConstructorParameters<typeof LoginFlows>[0]>[1];

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("LoginFlows", () => {
  it("reports the sign-in URL and a paste prompt, then finishes when the user answers", async () => {
    let pasted = "";
    const flows = new LoginFlows(async (_id, ui: Interaction) => {
      ui.notify({ type: "auth_url", url: "https://auth.openai.com/authorize?x=1", instructions: "Finish in your browser" });
      pasted = await ui.prompt({ type: "manual_code", message: "Paste the final redirect URL", placeholder: "http://127.0.0.1:1455/auth/callback" });
      ui.notify({ type: "progress", message: "Exchanging code" });
    });
    const id = flows.start("openai");
    await tick();
    expect(flows.get(id)).toMatchObject({
      status: "running",
      authUrl: "https://auth.openai.com/authorize?x=1",
      prompt: { message: "Paste the final redirect URL", placeholder: "http://127.0.0.1:1455/auth/callback" },
    });
    flows.answer(id, "http://127.0.0.1:1455/auth/callback?code=abc&state=s");
    await tick();
    expect(pasted).toBe("http://127.0.0.1:1455/auth/callback?code=abc&state=s");
    expect(flows.get(id)).toMatchObject({ status: "done" });
    expect(flows.get(id)?.prompt).toBeUndefined();
  });

  it("finishes without a paste when the callback arrives on its own", async () => {
    const flows = new LoginFlows(async (_id, ui: Interaction) => {
      ui.notify({ type: "auth_url", url: "https://auth.example/a" });
      const pasted = ui.prompt({ type: "manual_code", message: "Paste", signal: AbortSignal.timeout(5) }).catch(() => "");
      await pasted;
    });
    const id = flows.start("openai");
    await new Promise((r) => setTimeout(r, 20));
    expect(flows.get(id)).toMatchObject({ status: "done" });
  });

  it("surfaces a failure in plain words", async () => {
    const flows = new LoginFlows(async () => {
      throw new Error("Port 1455 is in use");
    });
    const id = flows.start("openai");
    await tick();
    expect(flows.get(id)).toMatchObject({ status: "error", error: "Port 1455 is in use" });
  });

  it("can be cancelled, which aborts the pending prompt", async () => {
    let aborted = false;
    const flows = new LoginFlows(async (_id, ui: Interaction) => {
      ui.signal?.addEventListener("abort", () => (aborted = true));
      await ui.prompt({ type: "manual_code", message: "Paste" });
    });
    const id = flows.start("openai");
    await tick();
    flows.cancel(id);
    await tick();
    expect(aborted).toBe(true);
    expect(flows.get(id)).toMatchObject({ status: "error", error: "Sign-in cancelled" });
  });

  it("forgets unknown or expired flows", async () => {
    let now = 0;
    const flows = new LoginFlows(async () => {}, { ttlMs: 1000, now: () => now });
    const id = flows.start("openai");
    await tick();
    expect(flows.get("nope")).toBeUndefined();
    now = 2000;
    expect(flows.get(id)).toBeUndefined();
    expect(() => flows.answer(id, "x")).toThrow(/expired/);
  });
});
