import type { Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type Complete = (o: { system: string; user: string; maxTokens?: number; signal?: AbortSignal }) => Promise<string>;

const MAX_OUTPUT = 16000;
const CALL_TIMEOUT_MS = 150_000;

export function completeWith(runtime: Pick<ModelRuntime, "completeSimple">, model: () => Model<any>): Complete {
  return async ({ system, user, maxTokens, signal }) => {
    const m = model();
    const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
    const reply = await runtime.completeSimple(
      m,
      { systemPrompt: system, messages: [{ role: "user", content: user, timestamp: Date.now() }] },
      {
        maxTokens: Math.min(maxTokens ?? MAX_OUTPUT, m.maxTokens || MAX_OUTPUT),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    const error = (reply as { errorMessage?: string }).errorMessage;
    const text = (reply.content ?? [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (reply.stopReason === "error" || (error && !text)) throw new Error(error ?? "the model returned an error");
    if (!text) throw new Error("the model returned nothing");
    return text;
  };
}
