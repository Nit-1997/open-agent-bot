import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";

type Interaction = AuthInteraction & { signal: AbortSignal };
type Login = (providerId: string, interaction: Interaction) => Promise<void>;

type FlowState = {
  providerId: string;
  status: "running" | "done" | "error";
  authUrl?: string;
  instructions?: string;
  deviceCode?: { userCode: string; verificationUri: string };
  progress?: string;
  prompt?: { type: AuthPrompt["type"]; message: string; placeholder?: string };
  error?: string;
};

type Flow = {
  state: FlowState;
  createdAt: number;
  abort: AbortController;
  pending?: { resolve: (v: string) => void; reject: (e: Error) => void };
};

export class LoginFlows {
  private readonly flows = new Map<string, Flow>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly login: Login,
    opts: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  start(providerId: string): string {
    for (const id of this.flows.keys()) this.live(id);
    const id = randomUUID();
    const flow: Flow = { state: { providerId, status: "running" }, createdAt: this.now(), abort: new AbortController() };
    this.flows.set(id, flow);

    const interaction: Interaction = {
      signal: flow.abort.signal,
      notify: (e: AuthEvent) => {
        if (e.type === "auth_url") Object.assign(flow.state, { authUrl: e.url, ...(e.instructions && { instructions: e.instructions }) });
        else if (e.type === "device_code") flow.state.deviceCode = { userCode: e.userCode, verificationUri: e.verificationUri };
        else flow.state.progress = e.message;
      },
      prompt: (p: AuthPrompt) =>
        new Promise<string>((resolve, reject) => {
          const clear = () => {
            flow.pending = undefined;
            flow.state.prompt = undefined;
          };
          const fail = (message: string) => {
            clear();
            reject(new Error(message));
          };
          flow.state.prompt = {
            type: p.type,
            message: p.message,
            ...("placeholder" in p && p.placeholder && { placeholder: p.placeholder }),
          };
          flow.pending = {
            resolve: (v) => {
              clear();
              resolve(v);
            },
            reject: (e) => fail(e.message),
          };
          p.signal?.addEventListener("abort", () => fail("prompt no longer needed"), { once: true });
          flow.abort.signal.addEventListener("abort", () => fail("Sign-in cancelled"), { once: true });
        }),
    };

    this.login(providerId, interaction)
      .then(() => {
        flow.state.status = "done";
        flow.state.prompt = undefined;
      })
      .catch((err: unknown) => {
        flow.state.status = "error";
        flow.state.prompt = undefined;
        flow.state.error = flow.abort.signal.aborted ? "Sign-in cancelled" : err instanceof Error ? err.message : String(err);
        if (!flow.abort.signal.aborted) console.error(`[login] ${providerId} failed: ${flow.state.error}`);
      });
    return id;
  }

  private live(id: string): Flow | undefined {
    const flow = this.flows.get(id);
    if (flow && this.now() - flow.createdAt > this.ttlMs) {
      flow.abort.abort();
      this.flows.delete(id);
      return undefined;
    }
    return flow;
  }

  get(id: string): FlowState | undefined {
    const flow = this.live(id);
    return flow && { ...flow.state };
  }

  answer(id: string, value: string): void {
    const flow = this.live(id);
    if (!flow) throw new Error("This sign-in expired. Start it again.");
    if (!flow.pending) throw new Error("The sign-in isn't waiting for anything right now.");
    flow.pending.resolve(value.trim());
  }

  cancel(id: string): void {
    this.live(id)?.abort.abort();
  }
}
