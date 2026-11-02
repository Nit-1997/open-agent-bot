import { randomUUID } from "node:crypto";
import type { AuthUser } from "../auth/verify.js";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { log } from "../lib/log.js";
import { UserError } from "../lib/errors.js";

type Interaction = AuthInteraction & { signal: AbortSignal };
type Login = (user: AuthUser, providerId: string, interaction: Interaction) => Promise<void>;

const PROCESS_WIDE = new Set(["openai"]);
const EXPIRED = "This sign-in expired. Start it again.";

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
  userId: string;
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

  start(user: AuthUser, providerId: string): string {
    const userId = user.id;
    for (const id of [...this.flows.keys()]) this.live(id);
    for (const [id, f] of this.flows) {
      if (f.userId === userId && f.state.status === "running") {
        f.abort.abort();
        this.flows.delete(id);
      }
    }
    if (
      PROCESS_WIDE.has(providerId) &&
      [...this.flows.values()].some((f) => f.state.providerId === providerId && f.state.status === "running")
    )
      throw new UserError("Another sign-in is in progress. Try again in a minute.", "conflict", { code: "login_busy" });
    const id = randomUUID();
    const flow: Flow = { userId, state: { providerId, status: "running" }, createdAt: this.now(), abort: new AbortController() };
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

    this.login(user, providerId, interaction)
      .then(() => {
        flow.state.status = "done";
        flow.state.prompt = undefined;
      })
      .catch((err: unknown) => {
        flow.state.status = "error";
        flow.state.prompt = undefined;
        flow.state.error = flow.abort.signal.aborted ? "Sign-in cancelled" : err instanceof Error ? err.message : String(err);
        if (!flow.abort.signal.aborted) log.warn(`[login] ${providerId} failed: ${flow.state.error}`);
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

  private owned(userId: string, id: string): Flow | undefined {
    const flow = this.live(id);
    return flow?.userId === userId ? flow : undefined;
  }

  get(userId: string, id: string): FlowState | undefined {
    const flow = this.owned(userId, id);
    return flow && { ...flow.state };
  }

  answer(userId: string, id: string, value: string): void {
    const flow = this.owned(userId, id);
    if (!flow) throw new UserError(EXPIRED, "not_found");
    if (!flow.pending) throw new UserError("The sign-in isn't waiting for anything right now.", "conflict");
    flow.pending.resolve(value.trim());
  }

  cancel(userId: string, id: string): void {
    this.owned(userId, id)?.abort.abort();
  }

  cancelAll(userId: string): void {
    for (const [id, f] of this.flows) {
      if (f.userId !== userId) continue;
      f.abort.abort();
      this.flows.delete(id);
    }
  }
}
