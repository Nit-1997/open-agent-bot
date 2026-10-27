import type { PiEvent } from "../../src/agui/translate.js";
import type { PiSession } from "../../src/pi/createPiSession.js";

export type Script = (emit: (e: PiEvent) => void, ctl: { aborted: () => boolean }) => Promise<void>;

export function fakeSession(script: Script) {
  const listeners = new Set<(e: PiEvent) => void>();
  let aborted = false;
  let release: (() => void) | undefined;
  const fake = {
    prompts: [] as string[],
    abortCalls: 0,
    subscribe(l: (e: PiEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async prompt(text: string) {
      fake.prompts.push(text);
      aborted = false;
      await script((e) => listeners.forEach((l) => l(e)), { aborted: () => aborted });
    },
    async abort() {
      fake.abortCalls++;
      aborted = true;
      release?.();
    },
    waitForAbort() {
      return new Promise<void>((r) => {
        release = r;
      });
    },
  };
  return fake as typeof fake & PiSession;
}

export const ev = {
  assistantStart: { type: "message_start", message: { role: "assistant" } } as unknown as PiEvent,
  assistantEnd: (stopReason = "stop", errorMessage?: string) =>
    ({ type: "message_end", message: { role: "assistant", stopReason, errorMessage } }) as unknown as PiEvent,
  delta: (d: string) =>
    ({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: d } }) as unknown as PiEvent,
};
